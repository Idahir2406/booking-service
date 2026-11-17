import type { Site } from "@/src/types/site.types";

import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, IsNull, LessThanOrEqual, Repository } from "typeorm";

import { type Actor, actors } from "../../payments/domain/audit-actor";
import { AUDIT_ENTITY } from "../../payments/entities/audit-log.entity";
import {
  type RefundContext,
  ReservationEconomicsService,
} from "../../payments/services/reservation-economics.service";
import { StripeService } from "../../stripe/services/stripe.service";
import { stripeIdempotencyKeys } from "../../stripe/utils/stripe-idempotency.util";
import { ReservationEntity } from "../entities/reservation.entity";
import { ReservationGuestFeedbackEntity } from "../entities/reservation-guest-feedback.entity";
import { expectedChargeCents } from "../utils/reservation-amount.util";
import { isDeferredUnpaid } from "../utils/reservation-policy.util";
import { ReservationService } from "./reservation.service";
import { ReservationEmailService } from "./reservation-email.service";
import { ReservationEventService } from "./reservation-event.service";

export interface ReleasePayoutResult {
  released: boolean;
  transferId?: string;
  reason?: string;
}

export interface RefundInTransactionResult {
  refundId: string;
  isPartial: boolean;
}

const SYSTEM_REFUND_CONTEXT: RefundContext = {
  requestedBy: actors.system("refund"),
  approvedBy: null,
  responsible: null,
};

const ADMIN_REFUND_CONTEXT: RefundContext = {
  requestedBy: actors.admin(),
  approvedBy: actors.admin(),
  responsible: null,
};

/** Do not re-send "payout failed" emails more often than this (cron retries every 15 min). */
const PAYOUT_FAILED_EMAIL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ReservationPayoutService {
  private readonly logger = new Logger(ReservationPayoutService.name);

  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    @InjectRepository(ReservationGuestFeedbackEntity)
    private readonly feedbackRepository: Repository<ReservationGuestFeedbackEntity>,
    @Inject(
      forwardRef(
        // Circular StripeModule <-> ReservationModule (pre-existing pattern).
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-return, node/no-missing-require
        () => require("../../stripe/services/stripe.service").StripeService,
      ),
    )
    private readonly stripeService: StripeService,
    @Inject(
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-return, node/no-missing-require
      forwardRef(() => require("./reservation.service").ReservationService),
    )
    private readonly reservationService: ReservationService,
    private readonly reservationEmailService: ReservationEmailService,
    private readonly reservationEventService: ReservationEventService,
    private readonly economics: ReservationEconomicsService,
  ) {}

  /**
   * Releases the host payout. The reservation row is locked FOR UPDATE for
   * the whole operation so the cron and a feedback submission can never both
   * transfer; the Stripe transfer uses idempotency key transfer:{id} and is
   * first looked up by transfer_group, so a transfer that succeeded but was
   * not persisted is adopted instead of re-sent (F0).
   */
  async releaseHostPayout(
    reservationId: number,
    actor: Actor = actors.system("payout_release"),
  ): Promise<ReleasePayoutResult> {
    let site: Site | undefined;
    try {
      const outcome = await this.reservationRepository.manager.transaction(
        async manager => {
          const repository = manager.getRepository(ReservationEntity);
          const reservation = await repository.findOne({
            where: { id: reservationId },
            lock: { mode: "pessimistic_write" },
          });
          if (!reservation) {
            throw new NotFoundException(
              `Reservation with id ${reservationId} not found`,
            );
          }

          if (reservation.stripe_transfer_id) {
            return {
              result: {
                released: false,
                transferId: reservation.stripe_transfer_id,
                reason: "already_transferred",
              } satisfies ReleasePayoutResult,
              reservation,
            };
          }

          if (reservation.payout_status !== "held") {
            return {
              result: {
                released: false,
                reason: `payout_status=${reservation.payout_status ?? "null"}`,
              } satisfies ReleasePayoutResult,
              reservation,
            };
          }

          if (
            reservation.payment_status !== "paid" &&
            reservation.payment_status !== "partially_refunded"
          ) {
            return {
              result: {
                released: false,
                reason: `payment_status=${reservation.payment_status}`,
              } satisfies ReleasePayoutResult,
              reservation,
            };
          }

          if (!reservation.stripe_payment_intent_id) {
            throw new BadRequestException(
              `Reservation ${reservationId} has no payment intent`,
            );
          }

          site = await this.reservationService.getSiteById(reservation.site_id);
          const hostUserId = site.user_id ?? 0;
          if (!hostUserId) {
            throw new BadRequestException(
              `Site ${reservation.site_id} has no host user`,
            );
          }

          const refundedCents = Math.round(
            Number(reservation.amount_refunded ?? 0) * 100,
          );
          const totalPaidCents =
            Math.round(Number(reservation.total) * 100) - refundedCents;
          if (totalPaidCents <= 0) {
            throw new BadRequestException(
              `Reservation ${reservationId} has invalid total`,
            );
          }

          // F1: commission frozen at booking (env % only for legacy rows).
          const fee = this.economics.computePlatformFee(
            reservation,
            refundedCents,
          );

          const transfer = await this.stripeService.transferHostPayout({
            reservationId: reservation.id,
            paymentIntentId: reservation.stripe_payment_intent_id,
            hostUserId,
            totalPaidCents,
            platformFeeCents: fee.feeCents,
          });

          await this.economics.transitionPayout(
            manager,
            reservation,
            "released",
            actor,
            {
              metadata: {
                transfer_id: transfer?.id ?? null,
                net_paid_cents: totalPaidCents,
                platform_fee_cents: fee.feeCents,
                host_amount_cents: fee.hostAmountCents,
                fee_rate: fee.rateUsed,
                fee_source: fee.source,
              },
            },
          );
          reservation.payout_released_at = new Date();
          reservation.stripe_transfer_id = transfer?.id ?? undefined;
          const saved = await repository.save(reservation);
          await this.reservationEventService.logEventInTransaction(
            manager,
            reservation.id,
            "payout_released",
            {
              transfer_id: transfer?.id ?? null,
              amount_cents: totalPaidCents,
              platform_fee_cents: fee.feeCents,
            },
          );

          return {
            result: {
              released: true,
              transferId: transfer?.id,
            } satisfies ReleasePayoutResult,
            reservation: saved,
          };
        },
      );

      if (outcome.result.released && site) {
        await this.reservationEmailService.sendPayoutReleasedEmails(
          outcome.reservation,
          site,
        );
      }
      return outcome.result;
    } catch (error) {
      this.logger.error(
        `Failed to release payout for reservation ${reservationId}`,
        error instanceof Error ? error.stack : String(error),
      );
      // Detached: the transaction rolled back, the failure must stay (B14/A22).
      await this.economics.auditDetached(
        AUDIT_ENTITY.PAYOUT,
        reservationId,
        "payout.release_failed",
        actor,
        { error: error instanceof Error ? error.message : String(error) },
      );
      await this.notifyPayoutFailed(reservationId, error);
      throw error;
    }
  }

  private async notifyPayoutFailed(
    reservationId: number,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const alreadyNotified = await this.reservationEventService.hasRecentEvent(
        reservationId,
        "payout_failed",
        new Date(Date.now() - PAYOUT_FAILED_EMAIL_COOLDOWN_MS),
      );
      await this.reservationEventService.logEvent(
        reservationId,
        "payout_failed",
        { error: message },
      );
      if (alreadyNotified) {
        return;
      }
      const reservation = await this.reservationRepository.findOne({
        where: { id: reservationId },
      });
      if (!reservation) {
        return;
      }
      const site = await this.reservationService.getSiteById(
        reservation.site_id,
      );
      await this.reservationEmailService.sendPayoutFailedEmails(
        reservation,
        site,
        message,
      );
    } catch (notifyError) {
      this.logger.warn(
        `Could not notify payout failure for reservation ${reservationId}`,
        notifyError instanceof Error
          ? notifyError.message
          : String(notifyError),
      );
    }
  }

  /**
   * Refund inside the caller's transaction; the caller MUST have locked the
   * reservation row (pessimistic_write). Mutates `reservation` (not saved).
   * Idempotency key refund:{id}:{n}; n is persisted with the reservation in
   * the same transaction, so a rollback reuses the same key on retry.
   * Emails are the caller's responsibility (sent after commit).
   */
  async refundInTransaction(
    manager: EntityManager,
    reservation: ReservationEntity,
    amountCents?: number,
    reason?: string,
    context: RefundContext = SYSTEM_REFUND_CONTEXT,
  ): Promise<RefundInTransactionResult> {
    if (isDeferredUnpaid(reservation)) {
      // Fase 4: deferred charge not made yet -> nothing was ever charged.
      throw new BadRequestException(
        `Reservation ${reservation.id} has an unpaid deferred charge; nothing to refund`,
      );
    }
    if (!reservation.stripe_payment_intent_id) {
      throw new BadRequestException(
        `Reservation ${reservation.id} has no payment intent to refund`,
      );
    }

    // F2: amount charged = total_cents (legacy rows: subtotal + surcharge).
    const paidCents = expectedChargeCents(reservation);
    const alreadyRefundedCents = Math.round(
      Number(reservation.amount_refunded ?? 0) * 100,
    );
    const refundCents = amountCents ?? paidCents - alreadyRefundedCents;
    if (refundCents <= 0) {
      throw new BadRequestException(
        `Reservation ${reservation.id} has nothing left to refund`,
      );
    }

    const sequence = reservation.refund_seq + 1;
    const refund = await this.stripeService.refundPaymentIntent({
      reservationId: reservation.id,
      sequence,
      paymentIntentId: reservation.stripe_payment_intent_id,
      amountCents: amountCents === undefined ? undefined : refundCents,
      reason,
    });

    // F1 ledger row (processing); refund.* webhooks complete or fail it.
    await this.economics.recordRefundCreated(
      manager,
      {
        reservationId: reservation.id,
        paymentIntentId: reservation.stripe_payment_intent_id,
        amountCents: refundCents,
        reason: reason ?? null,
        idempotencyKey: stripeIdempotencyKeys.refund(reservation.id, sequence),
        stripeRefundId: refund.id,
        context,
      },
      context.requestedBy,
    );

    const totalRefundedCents = alreadyRefundedCents + refundCents;
    const isPartial = totalRefundedCents < paidCents;
    reservation.refund_seq = sequence;
    reservation.stripe_refund_id = refund.id;
    reservation.amount_refunded = totalRefundedCents / 100;
    reservation.payment_status = isPartial ? "partially_refunded" : "refunded";

    await this.reservationEventService.logEventInTransaction(
      manager,
      reservation.id,
      "refund_created",
      {
        refund_id: refund.id,
        refund_seq: sequence,
        amount_cents: refundCents,
        partial: isPartial,
        reason: reason ?? null,
      },
    );

    return { refundId: refund.id, isPartial };
  }

  /** Standalone refund (own transaction + row lock + refund emails). */
  async refundReservation(
    reservationId: number,
    amountCents?: number,
    context: RefundContext = ADMIN_REFUND_CONTEXT,
  ): Promise<{ refundId: string }> {
    const { reservation, refundId } =
      await this.reservationRepository.manager.transaction(async manager => {
        const repository = manager.getRepository(ReservationEntity);
        const locked = await repository.findOne({
          where: { id: reservationId },
          lock: { mode: "pessimistic_write" },
        });
        if (!locked) {
          throw new NotFoundException(
            `Reservation with id ${reservationId} not found`,
          );
        }
        const result = await this.refundInTransaction(
          manager,
          locked,
          amountCents,
          "manual_refund",
          context,
        );
        const saved = await repository.save(locked);
        return { reservation: saved, refundId: result.refundId };
      });

    return { refundId };
  }

  /**
   * Releases due payouts. Only a guest REPORT (or a blocked payout) stops the
   * release; a review does not, so a release that failed right after a review
   * is retried here instead of being skipped forever (F0).
   */
  @Cron("*/15 * * * *")
  async processPayoutReleases(): Promise<void> {
    const now = new Date();
    const due = await this.reservationRepository.find({
      where: {
        status: "finalized",
        payout_status: "held",
        feedback_deadline_at: LessThanOrEqual(now),
        stripe_transfer_id: IsNull(),
      },
    });

    if (due.length === 0) {
      return;
    }

    for (const reservation of due) {
      const report = await this.feedbackRepository.findOne({
        where: { reservation_id: reservation.id, type: "report" },
      });
      if (report) {
        continue;
      }

      try {
        const result = await this.releaseHostPayout(reservation.id);
        if (result.released) {
          this.logger.log(
            `Cron released payout for reservation ${reservation.id}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Cron failed to release payout for reservation ${reservation.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }
}
