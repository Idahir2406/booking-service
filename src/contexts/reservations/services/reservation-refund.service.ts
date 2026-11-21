import type { ReservationSnapshotPayload } from "../../payments/domain/reservation-snapshot";
import type { TravelerCancelPreviewResponseDto } from "../dto/traveler-panel.dto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";

import { actors } from "../../payments/domain/audit-actor";
import { PAYMENT_STATUS } from "../../payments/domain/payment-state-machine";
import { ReviewRefundDto } from "../../payments/dto/review-refund.dto";
import { RefundEntity } from "../../payments/entities/refund.entity";
import { ReservationEconomicsService } from "../../payments/services/reservation-economics.service";
import { ReservationSnapshotService } from "../../payments/services/reservation-snapshot.service";
import { StripeService } from "../../stripe/services/stripe.service";
import { stripeIdempotencyKeys } from "../../stripe/utils/stripe-idempotency.util";
import { ExceptionalRefundRequestDto } from "../dto/exceptional-refund-request.dto";
import { TravelerCancelReservationDto } from "../dto/traveler-cancel-reservation.dto";
import { ReservationEntity } from "../entities/reservation.entity";
import { ReservationDisputeEntity } from "../entities/reservation-dispute.entity";
import { isPartiallyRefundedByChangeOnly } from "../utils/change-refund.util";
import { isProviderReservation } from "../utils/provider-reservation.util";
import {
  resolveTravelerCancellationQuote,
  TRAVELER_CANCELLATION_REASON,
  type TravelerCancellationQuote,
  type TravelerCancellationReason,
  travelerPolicyAllowsCancel,
} from "../utils/refund-policy.util";
import { expectedChargeCents } from "../utils/reservation-amount.util";
import { isDeferredUnpaid } from "../utils/reservation-policy.util";
import {
  ProviderCancellationBridge,
  type ProviderCancellationHandler,
} from "./provider-cancellation.bridge";
import { ReservationService } from "./reservation.service";
import {
  PENALTY_CHARGE_OUTCOME,
  type PenaltyChargeOutcome,
  ReservationDeferredChargeService,
} from "./reservation-deferred-charge.service";
import { ReservationEmailService } from "./reservation-email.service";
import { ReservationEventService } from "./reservation-event.service";
import { ReservationIncidentService } from "./reservation-incident.service";
import { ReservationPayoutService } from "./reservation-payout.service";

interface CancelTravelerOutcome {
  reservation: ReservationEntity;
  refundInitiated: boolean;
  refundPendingReview: boolean;
  refundId?: number;
  /** F-PV7a: incident linked to the force_majeure dispute (attachments). */
  incidentId?: number;
  /** Fase 4: flexible reservation cancelled before its deferred charge. */
  deferred?: DeferredCancelOutcome;
  /**
   * Phase 5 providers (source = nuitee): the provider has not confirmed the
   * cancellation yet; nothing refunded, the reconciliation cron finishes it.
   */
  providerPending?: boolean;
}

/** Fase 4: what the cancellation of an unpaid flexible reservation did. */
interface DeferredCancelOutcome {
  penaltyCents: number;
  penaltyOutcome: PenaltyChargeOutcome | "not_charged_review";
  failure: string | null;
  /** Saved card to detach after commit (nothing more will be charged). */
  detachPaymentMethodId: string | null;
}

@Injectable()
export class ReservationRefundService {
  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    @InjectRepository(RefundEntity)
    private readonly refundRepository: Repository<RefundEntity>,
    @InjectRepository(ReservationDisputeEntity)
    private readonly disputeRepository: Repository<ReservationDisputeEntity>,
    private readonly reservationService: ReservationService,
    private readonly payoutService: ReservationPayoutService,
    private readonly reservationEmailService: ReservationEmailService,
    private readonly reservationEventService: ReservationEventService,
    private readonly economics: ReservationEconomicsService,
    private readonly snapshots: ReservationSnapshotService,
    @Inject(
      forwardRef(
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-return, node/no-missing-require
        () => require("../../stripe/services/stripe.service").StripeService,
      ),
    )
    private readonly stripeService: StripeService,
    private readonly incidentService: ReservationIncidentService,
    // Fase 4 (last so pre-existing fixtures keep their positional args).
    private readonly deferredChargeService?: ReservationDeferredChargeService,
    // Phase 5 providers: nuitee cancellations (provider cancel before refund).
    private readonly providerCancellation?: ProviderCancellationBridge,
  ) {}

  /**
   * source = nuitee is never cancelled here: the provider must confirm the
   * cancellation before any refund. Without the provider handler (context
   * not loaded) the cancellation is refused instead of refunding blindly.
   */
  private providerHandler(): ProviderCancellationHandler {
    const handler = this.providerCancellation?.get() ?? null;
    if (!handler) {
      throw new ServiceUnavailableException(
        "Provider cancellations are not available right now",
      );
    }
    return handler;
  }

  private async lockReservation(
    manager: EntityManager,
    id: number,
  ): Promise<ReservationEntity> {
    const reservation = await manager
      .getRepository(ReservationEntity)
      .findOne({ where: { id }, lock: { mode: "pessimistic_write" } });
    if (!reservation) {
      throw new NotFoundException(`Reservation with id ${id} not found`);
    }
    return reservation;
  }

  private assertTravelerAccess(
    reservation: ReservationEntity,
    userId: number,
  ): void {
    if (userId < 1 || reservation.user_id !== userId) {
      throw new ForbiddenException("Reservation access denied");
    }
  }

  private assertHostAccess(
    reservation: ReservationEntity,
    siteId: number,
  ): void {
    if (siteId !== reservation.site_id) {
      throw new ForbiddenException("Site access denied");
    }
  }

  private async loadSnapshotPayload(
    manager: EntityManager | undefined,
    reservation: ReservationEntity,
  ): Promise<ReservationSnapshotPayload | null> {
    const version = reservation.snapshot_version ?? 1;
    const row = await this.snapshots.findVersion(reservation.id, version);
    if (!row?.payload) {
      const latest = await this.snapshots.findLatest(reservation.id, manager);
      return (
        (latest?.payload as ReservationSnapshotPayload | undefined) ?? null
      );
    }
    return row.payload as ReservationSnapshotPayload;
  }

  /**
   * F-PV7b: is the row partially_refunded ONLY by accepted-change
   * adjustments? Read inside the caller's transaction when given (the
   * reservation row is already locked, so no refund can be added meanwhile).
   */
  private async isPartialRefundFromChange(
    manager: EntityManager | undefined,
    reservation: ReservationEntity,
  ): Promise<boolean> {
    if (reservation.payment_status !== "partially_refunded") {
      return false;
    }
    const repository = manager
      ? manager.getRepository(RefundEntity)
      : this.refundRepository;
    const refunds = await repository.find({
      where: { reservation_id: reservation.id },
    });
    return isPartiallyRefundedByChangeOnly(reservation, refunds);
  }

  /**
   * F-PV4: what cancelByTraveler would do right now, without doing it. No
   * transaction, no lock, no Stripe, no writes. Shares the quote resolver
   * with cancelByTraveler so the previewed refund is the executed one.
   */
  async previewTravelerCancellation(
    userId: number,
    id: number,
    reason: TravelerCancellationReason,
    now: Date = new Date(),
  ): Promise<TravelerCancelPreviewResponseDto> {
    const reservation = await this.reservationRepository.findOne({
      where: { id },
    });
    if (!reservation) {
      throw new NotFoundException(`Reservation with id ${id} not found`);
    }
    this.assertTravelerAccess(reservation, userId);
    if (isProviderReservation(reservation)) {
      return this.providerHandler().previewTravelerCancellation(
        reservation,
        reason,
        now,
      );
    }

    const snapshot = await this.loadSnapshotPayload(undefined, reservation);
    const fromChange = await this.isPartialRefundFromChange(
      undefined,
      reservation,
    );
    const quote = resolveTravelerCancellationQuote({
      reservation,
      snapshot,
      reason,
      now,
      partial_refund_from_change: fromChange,
    });
    // cancelByTraveler also refuses after the host payout was released.
    const canCancel =
      quote.can_cancel && reservation.payout_status !== "released";

    return {
      ...quote,
      can_cancel: canCancel,
      releases_inventory: canCancel,
      reservation_id: reservation.id,
      cancellation_reason: reason,
      currency: snapshot?.currency ?? "EUR",
      timezone:
        snapshot?.timezone ??
        snapshot?.refund_policy.timezone ??
        reservation.timezone ??
        "Europe/Madrid",
      charge_pending: isDeferredUnpaid(reservation),
    };
  }

  private quoteEventPayload(
    quote: TravelerCancellationQuote,
  ): Record<string, unknown> {
    return {
      paid_cents: quote.paid_cents,
      penalty_cents: quote.penalty_cents,
      refund_cents: quote.refund_cents,
      quote_source: quote.source,
    };
  }

  async cancelByTraveler(
    id: number,
    dto: TravelerCancelReservationDto,
  ): Promise<CancelTravelerOutcome> {
    const existing = await this.reservationRepository.findOne({
      where: { id },
    });
    if (existing && isProviderReservation(existing)) {
      this.assertTravelerAccess(existing, dto.user_id);
      const provider = await this.providerHandler().cancelByTraveler(id, {
        userId: dto.user_id,
        reason: dto.cancellation_reason,
        notes: dto.notes ?? null,
      });
      return {
        reservation: provider.reservation,
        refundInitiated: provider.refundInitiated,
        refundPendingReview: false,
        providerPending: provider.pending,
      };
    }

    const outcome = await this.reservationRepository.manager.transaction(
      async (manager): Promise<CancelTravelerOutcome> => {
        const reservation = await this.lockReservation(manager, id);
        this.assertTravelerAccess(reservation, dto.user_id);

        if (reservation.status === "cancelled") {
          return {
            reservation,
            refundInitiated: false,
            refundPendingReview: false,
          };
        }

        const now = new Date();
        const fromChange = await this.isPartialRefundFromChange(
          manager,
          reservation,
        );
        if (
          !travelerPolicyAllowsCancel(reservation, now, {
            partialRefundFromChange: fromChange,
          })
        ) {
          throw new BadRequestException(
            "This reservation cannot be cancelled by the traveler",
          );
        }

        const snapshot = await this.loadSnapshotPayload(manager, reservation);
        const actor = actors.traveler(dto.user_id);
        const repository = manager.getRepository(ReservationEntity);
        const reason =
          dto.cancellation_reason satisfies TravelerCancellationReason;
        const quote = resolveTravelerCancellationQuote({
          reservation,
          snapshot,
          reason,
          now,
          partial_refund_from_change: fromChange,
        });

        if (reservation.status === "pending") {
          reservation.status = "cancelled";
          reservation.cancelled_at = now;
          reservation.cancel_reason = reason;
          reservation.refund_on_cancel = false;
          const saved = await repository.save(reservation);
          await this.reservationService.releaseAvailabilityForReservation(
            saved,
            manager,
          );
          await this.economics.recordPaymentFailed(
            manager,
            id,
            "cancelled_by_traveler",
            actor,
          );
          await this.reservationEventService.logEventInTransaction(
            manager,
            id,
            "cancelled",
            {
              by: "traveler",
              reason,
              notes: dto.notes ?? null,
              ...this.quoteEventPayload(quote),
            },
          );
          return {
            reservation: saved,
            refundInitiated: false,
            refundPendingReview: false,
          };
        }

        if (reservation.payout_status === "released") {
          throw new BadRequestException(
            "Cannot cancel after the host payout was released",
          );
        }

        if (isDeferredUnpaid(reservation)) {
          // Fase 4: never charged -> no Stripe refund ever (refundInTransaction
          // needs a PaymentIntent). Penalty, if any, is charged off-session.
          return this.cancelDeferredUnpaid(
            manager,
            reservation,
            dto,
            quote,
            now,
          );
        }

        let refundInitiated = false;
        let refundPendingReview = false;
        let refundId: number | undefined;
        let incidentId: number | undefined;

        if (reason === TRAVELER_CANCELLATION_REASON.FORCE_MAJEURE) {
          const amountCents = quote.refund_cents;
          const pending = await this.economics.recordRefundPending(
            manager,
            {
              reservationId: id,
              paymentIntentId: reservation.stripe_payment_intent_id ?? null,
              amountCents,
              reason: `traveler_force_majeure:${reason}`,
              idempotencyKey: stripeIdempotencyKeys.refundPending(
                id,
                Date.now(),
              ),
              context: {
                requestedBy: actor,
                approvedBy: null,
                responsible: "traveler",
              },
            },
            actor,
          );
          refundId = pending.id;
          refundPendingReview = true;
          const dispute = await this.openForceMajeureDispute(
            manager,
            id,
            reason,
            dto.notes,
          );
          // F-PV7a: same UI as incidents (attachments + "Pendiente de
          // revisión V4P"); no extra payout change, the refund stays pending.
          const incident =
            await this.incidentService.openForceMajeureIncidentInTransaction(
              manager,
              {
                reservationId: id,
                userId: dto.user_id,
                disputeId: dispute.id,
                description: dto.notes ?? reason,
              },
            );
          incidentId = incident.id;
        } else if (quote.refund_cents > 0) {
          await this.payoutService.refundInTransaction(
            manager,
            reservation,
            quote.refund_cents,
            `traveler_cancel:${reason}`,
            {
              requestedBy: actor,
              approvedBy: actor,
              responsible: "traveler",
            },
          );
          refundInitiated = true;
        }

        reservation.status = "cancelled";
        reservation.cancelled_at = now;
        reservation.cancel_reason = reason;
        reservation.refund_on_cancel = refundInitiated;
        const saved = await repository.save(reservation);
        await this.reservationService.releaseAvailabilityForReservation(
          saved,
          manager,
        );
        await this.reservationEventService.logEventInTransaction(
          manager,
          id,
          "cancelled",
          {
            by: "traveler",
            reason,
            refund: refundInitiated,
            pending_review: refundPendingReview,
            notes: dto.notes ?? null,
            ...this.quoteEventPayload(quote),
          },
        );

        return {
          reservation: saved,
          refundInitiated,
          refundPendingReview,
          refundId,
          incidentId,
        };
      },
    );

    if (outcome.reservation.status === "cancelled") {
      const site = await this.reservationService.getSiteById(
        outcome.reservation.site_id,
      );
      await this.reservationEmailService.sendCancelledEmails(
        outcome.reservation,
        site,
        false,
      );
      if (outcome.refundPendingReview) {
        await this.reservationEmailService.sendForceMajeureReviewAdminEmail(
          outcome.reservation,
          site,
          dto.cancellation_reason,
          dto.notes,
        );
      }
      const deferred = outcome.deferred;
      if (deferred?.penaltyOutcome === PENALTY_CHARGE_OUTCOME.FAILED) {
        await this.reservationEmailService.sendDeferredPenaltyFailedAdminEmail(
          outcome.reservation,
          site,
          deferred.penaltyCents,
          deferred.failure ?? "",
        );
      }
      if (deferred?.detachPaymentMethodId && this.deferredChargeService) {
        await this.deferredChargeService.detachQuietly(
          deferred.detachPaymentMethodId,
        );
      }
    }

    return outcome;
  }

  /**
   * Fase 4: traveler cancels a confirmed flexible reservation whose
   * deferred charge never succeeded (method saved, charge pending or in
   * regularization). Caller holds the row lock.
   * - free period (penalty 0): cancel, nothing charged, card detached;
   * - penalty > 0: charged off-session with the saved card; if it fails,
   *   an incident (charge_issue) is opened for V4P and the card is kept;
   * - force_majeure: nothing charged automatically, V4P reviews (incident).
   * A charge already in flight (ledger processing) blocks the cancellation.
   */
  private async cancelDeferredUnpaid(
    manager: EntityManager,
    reservation: ReservationEntity,
    dto: TravelerCancelReservationDto,
    quote: TravelerCancellationQuote,
    now: Date,
  ): Promise<CancelTravelerOutcome> {
    const deferredService = this.deferredChargeService;
    if (!deferredService) {
      throw new Error("ReservationDeferredChargeService is not available");
    }
    const id = reservation.id;
    const actor = actors.traveler(dto.user_id);
    const reason = dto.cancellation_reason satisfies TravelerCancellationReason;
    const payment = await this.economics.findLatestPayment(manager, id);
    if (payment?.status === PAYMENT_STATUS.PROCESSING) {
      throw new ConflictException(
        "The payment of this reservation is being processed; try again in a few minutes",
      );
    }

    const isForceMajeure =
      reason === TRAVELER_CANCELLATION_REASON.FORCE_MAJEURE;
    const paymentMethodId = reservation.stripe_payment_method_id ?? null;
    let deferred: DeferredCancelOutcome;
    let incidentId: number | undefined;

    if (isForceMajeure) {
      const incident =
        await this.incidentService.openChargeIssueIncidentInTransaction(
          manager,
          {
            reservationId: id,
            userId: dto.user_id,
            description:
              `Cancelación por fuerza mayor de una reserva con cobro diferido aún no cobrado. Revisar si procede cobrar la penalización. ${dto.notes ?? ""}`.trim(),
          },
        );
      incidentId = incident.id;
      deferred = {
        penaltyCents: 0,
        penaltyOutcome: "not_charged_review",
        failure: null,
        detachPaymentMethodId: null,
      };
    } else {
      const penalty = await deferredService.chargePenaltyInTransaction(
        manager,
        reservation,
        quote.penalty_cents,
        actor,
      );
      const failure =
        penalty.outcome === PENALTY_CHARGE_OUTCOME.FAILED
          ? (penalty.failureCode ?? "penalty_charge_failed")
          : null;
      if (failure !== null) {
        const incident =
          await this.incidentService.openChargeIssueIncidentInTransaction(
            manager,
            {
              reservationId: id,
              userId: dto.user_id,
              description: `No se ha podido cobrar la penalización de cancelación (${(quote.penalty_cents / 100).toFixed(2)} €) con la tarjeta guardada: ${failure}.`,
            },
          );
        incidentId = incident.id;
      }
      deferred = {
        penaltyCents: quote.penalty_cents,
        penaltyOutcome: penalty.outcome,
        failure,
        // Keep the card while V4P may still need it (failed / settling).
        detachPaymentMethodId:
          penalty.outcome === PENALTY_CHARGE_OUTCOME.NONE ||
          penalty.outcome === PENALTY_CHARGE_OUTCOME.CHARGED
            ? paymentMethodId
            : null,
      };
    }

    reservation.status = "cancelled";
    reservation.cancelled_at = now;
    reservation.cancel_reason = reason;
    reservation.refund_on_cancel = false;
    reservation.regularization_deadline_at = null;
    const saved = await manager
      .getRepository(ReservationEntity)
      .save(reservation);
    await this.reservationService.releaseAvailabilityForReservation(
      saved,
      manager,
    );
    await this.reservationEventService.logEventInTransaction(
      manager,
      id,
      "cancelled",
      {
        by: "traveler",
        reason,
        refund: false,
        deferred_charge: true,
        penalty_outcome: deferred.penaltyOutcome,
        penalty_failure: deferred.failure,
        notes: dto.notes ?? null,
        ...this.quoteEventPayload(quote),
      },
    );
    return {
      reservation: saved,
      refundInitiated: false,
      refundPendingReview: false,
      incidentId,
      deferred,
    };
  }

  private async openForceMajeureDispute(
    manager: EntityManager,
    reservationId: number,
    reason: string,
    notes?: string,
  ): Promise<ReservationDisputeEntity> {
    const repository = manager.getRepository(ReservationDisputeEntity);
    return repository.save(
      repository.create({
        reservation_id: reservationId,
        source: "guest_report",
        status: "open",
        guest_report: JSON.stringify({
          type: "force_majeure_cancellation",
          reason,
          notes: notes ?? null,
        }),
      }),
    );
  }

  async requestExceptionalRefund(
    id: number,
    dto: ExceptionalRefundRequestDto,
  ): Promise<{ refund_id: number }> {
    const outcome = await this.reservationRepository.manager.transaction(
      async manager => {
        const reservation = await this.lockReservation(manager, id);
        this.assertHostAccess(reservation, dto.site_id);

        if (
          reservation.status !== "confirmed" ||
          reservation.payment_status !== "paid"
        ) {
          throw new BadRequestException(
            "Exceptional refunds require a paid, confirmed reservation",
          );
        }
        if (reservation.payout_status === "released") {
          throw new BadRequestException(
            "Cannot request refund after payout was released",
          );
        }

        const paidCents = expectedChargeCents(reservation);
        const alreadyRefundedCents = Math.round(
          Number(reservation.amount_refunded ?? 0) * 100,
        );
        const remaining = paidCents - alreadyRefundedCents;
        if (dto.amount_cents > remaining) {
          throw new BadRequestException(
            `Amount exceeds remaining refundable balance (${remaining} cents)`,
          );
        }

        const actor = actors.host(dto.site_id);
        const pending = await this.economics.recordRefundPending(
          manager,
          {
            reservationId: id,
            paymentIntentId: reservation.stripe_payment_intent_id ?? null,
            amountCents: dto.amount_cents,
            reason: `host_exceptional:${dto.reason.slice(0, 80)}`,
            idempotencyKey: stripeIdempotencyKeys.refundPending(id, Date.now()),
            context: {
              requestedBy: actor,
              approvedBy: null,
              responsible: "host",
            },
          },
          actor,
        );
        await this.reservationEventService.logEventInTransaction(
          manager,
          id,
          "exceptional_refund_requested",
          {
            refund_id: pending.id,
            amount_cents: dto.amount_cents,
            reason: dto.reason,
            notes: dto.notes ?? null,
          },
        );
        return { refund_id: pending.id, reservation };
      },
    );

    const site = await this.reservationService.getSiteById(
      outcome.reservation.site_id,
    );
    await this.reservationEmailService.sendExceptionalRefundReviewAdminEmail(
      outcome.reservation,
      site,
      dto.amount_cents,
      dto.reason,
    );

    return { refund_id: outcome.refund_id };
  }

  async reviewPendingRefund(
    refundId: number,
    dto: ReviewRefundDto,
  ): Promise<RefundEntity> {
    const outcome = await this.refundRepository.manager.transaction(
      async manager => {
        const refundRepository = manager.getRepository(RefundEntity);
        const refund = await refundRepository.findOne({
          where: { id: refundId },
          lock: { mode: "pessimistic_write" },
        });
        if (!refund) {
          throw new NotFoundException(`Refund with id ${refundId} not found`);
        }
        if (refund.status !== "pending") {
          throw new BadRequestException(
            `Refund ${refundId} is not awaiting review`,
          );
        }

        const actor = actors.admin();
        if (dto.decision === "reject") {
          const rejected = await this.economics.rejectPendingRefund(
            manager,
            refundId,
            actor,
            dto.admin_notes ?? "rejected_by_admin",
          );
          if (!rejected) {
            throw new NotFoundException(`Refund with id ${refundId} not found`);
          }
          return {
            refund: rejected,
            reservation: null as ReservationEntity | null,
          };
        }

        const reservation = await this.lockReservation(
          manager,
          refund.reservation_id,
        );
        if (!reservation.stripe_payment_intent_id) {
          throw new BadRequestException(
            `Reservation ${reservation.id} has no payment intent`,
          );
        }

        const sequence = reservation.refund_seq + 1;
        const stripeRefund = await this.stripeService.refundPaymentIntent({
          reservationId: reservation.id,
          sequence,
          paymentIntentId: reservation.stripe_payment_intent_id,
          amountCents: refund.amount_cents,
          reason: refund.reason ?? "approved_exceptional_refund",
        });

        const processing = await this.economics.submitPendingRefundToStripe(
          manager,
          refund,
          stripeRefund.id,
          stripeIdempotencyKeys.refund(reservation.id, sequence),
          actor,
        );

        const paidCents = expectedChargeCents(reservation);
        const alreadyRefundedCents = Math.round(
          Number(reservation.amount_refunded ?? 0) * 100,
        );
        const totalRefundedCents = alreadyRefundedCents + refund.amount_cents;
        reservation.refund_seq = sequence;
        reservation.stripe_refund_id = stripeRefund.id;
        reservation.amount_refunded = totalRefundedCents / 100;
        reservation.payment_status =
          totalRefundedCents < paidCents ? "partially_refunded" : "refunded";
        await manager.getRepository(ReservationEntity).save(reservation);

        await this.reservationEventService.logEventInTransaction(
          manager,
          reservation.id,
          "refund_approved",
          {
            refund_id: refundId,
            stripe_refund_id: stripeRefund.id,
            admin_notes: dto.admin_notes ?? null,
          },
        );

        return { refund: processing, reservation };
      },
    );

    if (dto.decision === "reject" && outcome.refund.status === "failed") {
      const reservation = await this.reservationRepository.findOne({
        where: { id: outcome.refund.reservation_id },
      });
      if (reservation) {
        const site = await this.reservationService.getSiteById(
          reservation.site_id,
        );
        await this.reservationEmailService.sendRefundFailedEmails(
          reservation,
          site,
          dto.admin_notes ?? "rejected_by_admin",
        );
      }
    }

    return outcome.refund;
  }
}
