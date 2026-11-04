import type {
  AfterCommitTask,
  StripeWebhookEvent,
  WebhookHandlerResult,
} from "../types/stripe-webhook-event.type";

import { Injectable, Logger } from "@nestjs/common";
import { EntityManager, Not } from "typeorm";

import { actors } from "../../payments/domain/audit-actor";
import {
  isRefundCompleted,
  REFUND_STATUS,
} from "../../payments/domain/refund-state-machine";
import {
  LEDGER_TRANSITION,
  type StripeRefundPayload,
} from "../../payments/services/payment-ledger.service";
import { ReservationEconomicsService } from "../../payments/services/reservation-economics.service";
import { ReservationEntity } from "../../reservations/entities/reservation.entity";
import { ReservationDisputeEntity } from "../../reservations/entities/reservation-dispute.entity";
import {
  PAYMENT_ACTIVATION_OUTCOME,
  ReservationService,
} from "../../reservations/services/reservation.service";
import { ReservationEmailService } from "../../reservations/services/reservation-email.service";
import { ReservationEventService } from "../../reservations/services/reservation-event.service";

interface CheckoutSessionPayload {
  id: string;
  payment_status: string;
  metadata?: Record<string, string>;
  payment_intent?: string | { id: string } | null;
  amount_total?: number | null;
}

interface ChargeRefundList {
  data?: StripeRefundPayload[];
}

interface ChargePayload {
  id: string;
  payment_intent?: string | { id: string } | null;
  amount?: number;
  amount_refunded?: number;
  refunded?: boolean;
  /** Only present when the API version/expansion includes it. */
  refunds?: ChargeRefundList | null;
}

interface DisputePayload {
  id: string;
  payment_intent?: string | { id: string } | null;
  reason?: string;
  status?: string;
  amount?: number;
}

/** Dispute statuses where the platform keeps the money. */
const DISPUTE_WON_STATUSES = new Set(["won", "warning_closed"]);

function resolveId(
  value: string | { id: string } | null | undefined,
): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return value?.id ?? undefined;
}

function reservationIdFromMetadata(
  metadata?: Record<string, string>,
): number | undefined {
  const id = Number(metadata?.reservation_id);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

/**
 * Reservation side of the Stripe webhook. Every handler runs inside the
 * webhook transaction (`manager`) and only schedules emails through
 * `afterCommit`, so a rollback never leaves an email for a change that did
 * not happen, and a retry never double-applies money movements (F0).
 */
@Injectable()
export class ReservationWebhookService {
  private readonly logger = new Logger(ReservationWebhookService.name);

  constructor(
    private readonly reservationService: ReservationService,
    private readonly reservationEmailService: ReservationEmailService,
    private readonly reservationEventService: ReservationEventService,
    private readonly economics: ReservationEconomicsService,
  ) {}

  private async lockReservationByPaymentIntent(
    manager: EntityManager,
    paymentIntentId: string,
  ): Promise<ReservationEntity | null> {
    return manager.getRepository(ReservationEntity).findOne({
      where: { stripe_payment_intent_id: paymentIntentId },
      lock: { mode: "pessimistic_write" },
    });
  }

  /** checkout.session.completed and checkout.session.async_payment_succeeded. */
  async handleCheckoutCompleted(
    event: StripeWebhookEvent,
    manager: EntityManager,
    afterCommit: AfterCommitTask[],
  ): Promise<WebhookHandlerResult> {
    const session = event.data.object as CheckoutSessionPayload;
    const reservationId = reservationIdFromMetadata(session.metadata);

    if (session.payment_status !== "paid") {
      // Delayed payment methods: wait for async_payment_succeeded.
      this.logger.log(
        `Checkout session ${session.id} completed with payment_status=${session.payment_status}`,
      );
      if (reservationId) {
        const locked = await manager.getRepository(ReservationEntity).findOne({
          where: { id: reservationId },
          lock: { mode: "pessimistic_write" },
        });
        if (locked) {
          await this.economics.recordPaymentProcessing(
            manager,
            reservationId,
            session.id,
            resolveId(session.payment_intent) ?? null,
            actors.stripe(event.id),
          );
        }
      }
      return { reservationId };
    }

    if (!reservationId) {
      this.logger.warn(
        `Checkout session ${session.id} missing metadata.reservation_id`,
      );
      return {};
    }

    const paymentIntentId = resolveId(session.payment_intent);
    if (!paymentIntentId || !session.amount_total) {
      // Paid session without PI/amount is malformed: fail so it is retried/visible.
      throw new Error(
        `Checkout session ${session.id} is paid but lacks payment_intent/amount_total`,
      );
    }

    const result = await this.reservationService.activateFromPayment(
      {
        reservationId,
        checkoutSessionId: session.id,
        paymentIntentId,
        amountPaidCents: session.amount_total,
        actor: actors.stripe(event.id),
      },
      manager,
    );

    const reservation = result.reservation;
    switch (result.outcome) {
      case PAYMENT_ACTIVATION_OUTCOME.ACTIVATED:
      case PAYMENT_ACTIVATION_OUTCOME.REACTIVATED: {
        afterCommit.push(async () => {
          const site = await this.reservationService.getSiteById(
            reservation.site_id,
          );
          await this.reservationEmailService.sendPaymentConfirmedEmails(
            reservation,
            site,
          );
        });
        break;
      }
      case PAYMENT_ACTIVATION_OUTCOME.REFUNDED: {
        afterCommit.push(async () => {
          const site = await this.reservationService.getSiteById(
            reservation.site_id,
          );
          await this.reservationEmailService.sendPaymentAfterExpiryRefundEmails(
            reservation,
            site,
          );
        });
        break;
      }
      default: {
        this.logger.log(
          `Reservation ${reservationId} already activated; skipping confirmation emails`,
        );
      }
    }

    return { reservationId };
  }

  /** checkout.session.expired / async_payment_failed: release the hold now. */
  async handleCheckoutExpired(
    event: StripeWebhookEvent,
    manager: EntityManager,
  ): Promise<WebhookHandlerResult> {
    const session = event.data.object as CheckoutSessionPayload;
    const reservationId = reservationIdFromMetadata(session.metadata);
    if (!reservationId) {
      this.logger.warn(
        `Expired checkout session ${session.id} missing metadata.reservation_id`,
      );
      return {};
    }

    const reservation = await manager
      .getRepository(ReservationEntity)
      .findOne({ where: { id: reservationId } });
    if (!reservation) {
      this.logger.warn(
        `Expired checkout session ${session.id} references missing reservation ${reservationId}`,
      );
      return { reservationId };
    }
    if (
      reservation.stripe_checkout_session_id &&
      reservation.stripe_checkout_session_id !== session.id
    ) {
      // A newer session owns this reservation; this one is irrelevant.
      return { reservationId };
    }

    const expired = await this.reservationService.expirePendingReservation(
      reservationId,
      event.type === "checkout.session.expired"
        ? "checkout_session_expired"
        : "async_payment_failed",
      manager,
      actors.stripe(event.id),
      // pay-pending: re-checked under the row lock (the pay route may have
      // swapped the session between the read above and the lock).
      { onlyIfSessionId: session.id },
    );
    if (expired) {
      this.logger.log(
        `Cancelled pending reservation ${reservationId} after ${event.type} (${session.id})`,
      );
    }
    return { reservationId };
  }

  /**
   * charge.refunded: records full vs partial refund (amount_refunded vs
   * amount). Refunds we created are already recorded (same amount) inside
   * the row lock, so no second email is sent; only refunds made outside our
   * flows (Stripe Dashboard) notify guest/host.
   */
  async handleChargeRefunded(
    event: StripeWebhookEvent,
    manager: EntityManager,
    afterCommit: AfterCommitTask[],
  ): Promise<WebhookHandlerResult> {
    const charge = event.data.object as ChargePayload;
    const paymentIntentId = resolveId(charge.payment_intent);
    if (!paymentIntentId) {
      this.logger.warn("charge.refunded without payment_intent");
      return {};
    }

    const reservation = await this.lockReservationByPaymentIntent(
      manager,
      paymentIntentId,
    );
    if (!reservation) {
      this.logger.warn(
        `charge.refunded: no reservation for payment_intent ${paymentIntentId}`,
      );
      return {};
    }

    await this.economics.attachChargeId(manager, paymentIntentId, charge.id);
    // If the payload embeds the refunds, keep the refunds ledger consistent
    // too (refund.* events remain the primary source of truth).
    for (const embedded of charge.refunds?.data ?? []) {
      await this.economics.syncRefundFromStripe(
        manager,
        {
          ...embedded,
          payment_intent: embedded.payment_intent ?? paymentIntentId,
        },
        actors.stripe(event.id),
        reservation.id,
      );
    }

    const refundedCents = Number(charge.amount_refunded ?? 0);
    const chargeCents = Number(charge.amount ?? 0);
    const isFull =
      charge.refunded === true ||
      (chargeCents > 0 && refundedCents >= chargeCents);
    const nextStatus = isFull ? "refunded" : "partially_refunded";
    const knownCents = Math.round(
      Number(reservation.amount_refunded ?? 0) * 100,
    );

    if (
      reservation.payment_status === nextStatus &&
      knownCents === refundedCents
    ) {
      return { reservationId: reservation.id };
    }

    const initiatedOutsideOurFlows = refundedCents > knownCents;
    reservation.payment_status = nextStatus;
    reservation.amount_refunded = refundedCents / 100;
    const saved = await manager
      .getRepository(ReservationEntity)
      .save(reservation);
    await this.reservationEventService.logEventInTransaction(
      manager,
      reservation.id,
      "charge_refunded",
      {
        charge_id: charge.id,
        amount_refunded_cents: refundedCents,
        amount_cents: chargeCents,
        full: isFull,
        external: initiatedOutsideOurFlows,
      },
    );

    if (initiatedOutsideOurFlows) {
      afterCommit.push(async () => {
        const site = await this.reservationService.getSiteById(saved.site_id);
        await this.reservationEmailService.sendRefundProcessedEmails(
          saved,
          site,
        );
      });
    }
    return { reservationId: reservation.id };
  }

  /** charge.dispute.created: block the payout (unless already released) + record. */
  async handleChargeDisputeCreated(
    event: StripeWebhookEvent,
    manager: EntityManager,
    afterCommit: AfterCommitTask[],
  ): Promise<WebhookHandlerResult> {
    const dispute = event.data.object as DisputePayload;
    const paymentIntentId = resolveId(dispute.payment_intent);
    if (!paymentIntentId) {
      this.logger.warn("charge.dispute.created without payment_intent");
      return {};
    }

    const reservation = await this.lockReservationByPaymentIntent(
      manager,
      paymentIntentId,
    );
    if (!reservation) {
      this.logger.warn(
        `charge.dispute.created: no reservation for payment_intent ${paymentIntentId}`,
      );
      return {};
    }

    const disputeRepository = manager.getRepository(ReservationDisputeEntity);
    const existing = await disputeRepository.findOne({
      where: { stripe_dispute_id: dispute.id },
    });
    if (existing) {
      return { reservationId: reservation.id };
    }

    await disputeRepository.save(
      disputeRepository.create({
        reservation_id: reservation.id,
        status: "open",
        source: "stripe",
        stripe_dispute_id: dispute.id,
        stripe_status: dispute.status ?? null,
        guest_report: `Stripe dispute: ${dispute.reason ?? "unknown"}`,
      }),
    );

    const payoutAlreadyReleased = reservation.payout_status === "released";
    if (!payoutAlreadyReleased) {
      await this.economics.transitionPayout(
        manager,
        reservation,
        "blocked",
        actors.stripe(event.id),
        {
          onInvalid: "ignore",
          metadata: {
            trigger: "stripe_dispute_created",
            dispute_id: dispute.id,
          },
        },
      );
      await manager.getRepository(ReservationEntity).save(reservation);
    }
    await this.reservationEventService.logEventInTransaction(
      manager,
      reservation.id,
      payoutAlreadyReleased
        ? "stripe_dispute_after_payout_released"
        : "stripe_dispute_created",
      {
        dispute_id: dispute.id,
        reason: dispute.reason ?? null,
        amount_cents: dispute.amount ?? null,
      },
    );

    afterCommit.push(async () => {
      const site = await this.reservationService.getSiteById(
        reservation.site_id,
      );
      await this.reservationEmailService.sendStripeDisputeEmails(
        reservation,
        site,
        dispute.reason ?? "stripe_dispute",
      );
    });
    return { reservationId: reservation.id };
  }

  /**
   * charge.dispute.closed: won -> unblock payout if nothing else blocks it
   * (no other open dispute/report); lost -> keep blocked and record.
   */
  async handleChargeDisputeClosed(
    event: StripeWebhookEvent,
    manager: EntityManager,
  ): Promise<WebhookHandlerResult> {
    const dispute = event.data.object as DisputePayload;
    const paymentIntentId = resolveId(dispute.payment_intent);
    if (!paymentIntentId) {
      this.logger.warn("charge.dispute.closed without payment_intent");
      return {};
    }

    const reservation = await this.lockReservationByPaymentIntent(
      manager,
      paymentIntentId,
    );
    if (!reservation) {
      this.logger.warn(
        `charge.dispute.closed: no reservation for payment_intent ${paymentIntentId}`,
      );
      return {};
    }

    const disputeRepository = manager.getRepository(ReservationDisputeEntity);
    const won = DISPUTE_WON_STATUSES.has(String(dispute.status ?? ""));
    const row =
      (await disputeRepository.findOne({
        where: { stripe_dispute_id: dispute.id },
      })) ??
      disputeRepository.create({
        reservation_id: reservation.id,
        source: "stripe",
        stripe_dispute_id: dispute.id,
        guest_report: `Stripe dispute: ${dispute.reason ?? "unknown"}`,
      });
    row.status = won ? "resolved_release" : "resolved_refund";
    row.stripe_status = dispute.status ?? null;
    row.closed_at = new Date();
    const savedDispute = await disputeRepository.save(row);

    const reservationRepository = manager.getRepository(ReservationEntity);
    if (won) {
      const otherOpen = await disputeRepository.count({
        where: {
          reservation_id: reservation.id,
          status: "open",
          id: Not(savedDispute.id),
        },
      });
      if (reservation.payout_status === "blocked" && otherOpen === 0) {
        await this.economics.transitionPayout(
          manager,
          reservation,
          "held",
          actors.stripe(event.id),
          {
            onInvalid: "ignore",
            metadata: { trigger: "stripe_dispute_won", dispute_id: dispute.id },
          },
        );
        await reservationRepository.save(reservation);
      }
    } else if (reservation.payout_status !== "released") {
      await this.economics.transitionPayout(
        manager,
        reservation,
        "blocked",
        actors.stripe(event.id),
        {
          onInvalid: "ignore",
          metadata: { trigger: "stripe_dispute_lost", dispute_id: dispute.id },
        },
      );
      await reservationRepository.save(reservation);
    }

    await this.reservationEventService.logEventInTransaction(
      manager,
      reservation.id,
      won ? "stripe_dispute_won" : "stripe_dispute_lost",
      {
        dispute_id: dispute.id,
        status: dispute.status ?? null,
        amount_cents: dispute.amount ?? null,
        payout_status: reservation.payout_status ?? null,
      },
    );
    return { reservationId: reservation.id };
  }

  async handleTransferCreated(
    event: StripeWebhookEvent,
    manager: EntityManager,
  ): Promise<WebhookHandlerResult> {
    const transfer = event.data.object as {
      id: string;
      transfer_group?: string | null;
      metadata?: Record<string, string>;
    };

    const reservationId = reservationIdFromMetadata(transfer.metadata);
    if (!reservationId) {
      return {};
    }

    // Backup sync: a transfer that succeeded but was not persisted.
    const repository = manager.getRepository(ReservationEntity);
    const reservation = await repository.findOne({
      where: { id: reservationId },
      lock: { mode: "pessimistic_write" },
    });
    if (reservation && !reservation.stripe_transfer_id) {
      reservation.stripe_transfer_id = transfer.id;
      // Stripe is the truth: the transfer exists, whatever we had.
      await this.economics.transitionPayout(
        manager,
        reservation,
        "released",
        actors.stripe(event.id),
        {
          onInvalid: "ignore",
          metadata: { trigger: "transfer.created", transfer_id: transfer.id },
        },
      );
      reservation.payout_status = "released";
      reservation.payout_released_at =
        reservation.payout_released_at ?? new Date();
      await repository.save(reservation);
      await this.reservationEventService.logEventInTransaction(
        manager,
        reservationId,
        "payout_synced_from_webhook",
        { transfer_id: transfer.id },
      );
    }
    return { reservationId };
  }

  /**
   * refund.created / refund.updated / refund.failed: the refunds ledger
   * follows Stripe (B4: completion is never assumed). The reservation row
   * is locked first, so a refund.* event that races the transaction which
   * created the refund waits for it and then finds the row. A failed refund
   * reverts the optimistic legacy columns so PHP never shows it as done.
   */
  async handleRefundEvent(
    event: StripeWebhookEvent,
    manager: EntityManager,
    afterCommit: AfterCommitTask[] = [],
  ): Promise<WebhookHandlerResult> {
    const refund = event.data.object as StripeRefundPayload;
    const paymentIntentId = resolveId(refund.payment_intent);
    const metadataReservationId = reservationIdFromMetadata(
      refund.metadata ?? undefined,
    );

    const repository = manager.getRepository(ReservationEntity);
    let reservation: ReservationEntity | null = null;
    if (metadataReservationId) {
      reservation = await repository.findOne({
        where: { id: metadataReservationId },
        lock: { mode: "pessimistic_write" },
      });
    } else if (paymentIntentId) {
      reservation = await this.lockReservationByPaymentIntent(
        manager,
        paymentIntentId,
      );
    }
    if (!reservation) {
      this.logger.warn(
        `${event.type}: no reservation for refund ${refund.id} (pi=${paymentIntentId ?? "none"})`,
      );
      return {};
    }

    const sync = await this.economics.syncRefundFromStripe(
      manager,
      refund,
      actors.stripe(event.id),
      reservation.id,
    );

    if (
      sync.refund &&
      sync.result === LEDGER_TRANSITION.CHANGED &&
      sync.refund.status === REFUND_STATUS.FAILED
    ) {
      const before = {
        payment_status: reservation.payment_status,
        amount_refunded: reservation.amount_refunded ?? null,
      };
      if (
        reservation.payment_status === "refunded" ||
        reservation.payment_status === "partially_refunded"
      ) {
        const knownCents = Math.round(
          Number(reservation.amount_refunded ?? 0) * 100,
        );
        const remaining = Math.max(0, knownCents - sync.refund.amount_cents);
        reservation.amount_refunded = remaining / 100;
        reservation.payment_status =
          remaining > 0 ? "partially_refunded" : "paid";
        await repository.save(reservation);
      }
      await this.economics.auditReservationChange(
        manager,
        reservation.id,
        "reservation.refund_failed",
        actors.stripe(event.id),
        before,
        {
          payment_status: reservation.payment_status,
          amount_refunded: reservation.amount_refunded ?? null,
        },
        {
          refund_id: refund.id,
          failure_reason: refund.failure_reason ?? null,
        },
      );
      await this.reservationEventService.logEventInTransaction(
        manager,
        reservation.id,
        "refund_failed",
        {
          refund_id: refund.id,
          amount_cents: sync.refund.amount_cents,
          failure_reason: refund.failure_reason ?? null,
        },
      );
      this.logger.error(
        `Refund ${refund.id} for reservation ${reservation.id} FAILED (${refund.failure_reason ?? "unknown"}); refund obligation remains open`,
      );
      afterCommit.push(async () => {
        const site = await this.reservationService.getSiteById(
          reservation.site_id,
        );
        await this.reservationEmailService.sendRefundFailedEmails(
          reservation,
          site,
          refund.failure_reason ?? "refund_failed",
        );
      });
    }

    if (
      sync.refund &&
      sync.result === LEDGER_TRANSITION.CHANGED &&
      isRefundCompleted(sync.refund.status)
    ) {
      afterCommit.push(async () => {
        const site = await this.reservationService.getSiteById(
          reservation.site_id,
        );
        await this.reservationEmailService.sendRefundProcessedEmails(
          reservation,
          site,
        );
      });
    }

    return { reservationId: reservation.id };
  }
}
