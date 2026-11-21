import type { Actor } from "../../payments/domain/audit-actor";
import type { RefundResponsible } from "../../payments/domain/refund-state-machine";
import type { TravelerCancelPreviewResponseDto } from "../../reservations/dto/traveler-panel.dto";
import type {
  ProviderCancellationHandler,
  ProviderTravelerCancelInput,
  ProviderTravelerCancelOutcome,
} from "../../reservations/services/provider-cancellation.bridge";
import type { TravelerCancellationReason } from "../../reservations/utils/refund-policy.util";
import type {
  ProviderCancellationOfferInput,
  ProviderCancellationQuote,
} from "../domain/provider-cancellation";
import type {
  ProviderCancellationInitiator,
  ProviderCancellationRecord,
  ProviderCancelResult,
} from "../domain/provider-reservation.types";

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
  Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { actors } from "../../payments/domain/audit-actor";
import { REFUND_RESPONSIBLE } from "../../payments/domain/refund-state-machine";
import { ReservationEconomicsService } from "../../payments/services/reservation-economics.service";
import { ProviderTransientError } from "../../providers/domain/provider.errors";
import {
  type CancelResult,
  PROVIDER_BOOKING_STATUS,
  PROVIDER_CANCEL_STATUS,
} from "../../providers/domain/provider.types";
import { ProviderOfferEntity } from "../../providers/entities/provider-offer.entity";
import { AccommodationProviderRegistry } from "../../providers/services/accommodation-provider.registry";
import { ReservationEntity } from "../../reservations/entities/reservation.entity";
import { ProviderCancellationBridge } from "../../reservations/services/provider-cancellation.bridge";
import { ReservationEventService } from "../../reservations/services/reservation-event.service";
import { ReservationPayoutService } from "../../reservations/services/reservation-payout.service";
import { CANCELLATION_QUOTE_SOURCE } from "../../reservations/utils/refund-policy.util";
import { expectedChargeCents } from "../../reservations/utils/reservation-amount.util";
import {
  quoteProviderCancellation,
  readCancellationRecord,
  withCancellationRecord,
} from "../domain/provider-cancellation";
import {
  PROVIDER_CANCEL_OUTCOME,
  PROVIDER_CANCELLATION_INITIATOR,
  PROVIDER_CANCELLATION_STATUS,
  PROVIDER_CANCELLED_BY_HOTEL_REASON,
} from "../domain/provider-reservation.types";
import { cancellationText } from "./provider-booking.service";
import { ProviderIncidentService } from "./provider-incident.service";
import { ProviderNotifierService } from "./provider-notifier.service";

/** A "requested" claim older than this is treated as pending (crash). */
export const STALE_CANCEL_CLAIM_MS = 10 * 60_000;
/** Pending cancellation still unconfirmed after this: alert V4P once. */
export const PENDING_CANCEL_ALERT_MS = 60 * 60_000;

const DEFAULT_TIMEZONE = "Europe/Madrid";
const ADMIN_CANCEL_REASON = "admin_cancelled";

export const PROVIDER_CANCEL_BLOCK = {
  NOT_PROVIDER: "not_provider_reservation",
  ALREADY_CANCELLED: "already_cancelled",
  IN_PROGRESS: "cancellation_in_progress",
  BOOKING_IN_PROGRESS: "booking_in_progress",
  STAY_STARTED: "stay_started",
  NOT_CONFIRMED: "not_confirmed",
  NOT_PAID: "not_paid",
} as const;

export type ProviderCancelBlock =
  (typeof PROVIDER_CANCEL_BLOCK)[keyof typeof PROVIDER_CANCEL_BLOCK];

type CancellableState =
  | { kind: "confirmed" }
  | { kind: "unpaid_pending" }
  | { kind: "blocked"; reason: ProviderCancelBlock };

export interface ProviderCancellationQuoteResponse extends ProviderCancellationQuote {
  reservation_id: number;
  can_cancel: boolean;
  blocked_reason: ProviderCancelBlock | null;
  currency: string;
  timezone: string;
  policy_text: string | null;
  cancellation_status: string | null;
}

interface CancelRequest {
  initiator: ProviderCancellationInitiator;
  reason: string;
  notes: string | null;
  actorId: number | null;
  actor: Actor;
  waivePenalty: boolean;
}

interface FinalizeInput {
  now?: Date;
  rawStatus: string | null;
  /** Real provider penalty (net) from CancelResult. */
  providerPenaltyNetCents?: number | null;
  providerCurrency?: string | null;
  /** Provider/hotel cancelled a booking nobody asked to cancel. */
  hotelCancelled?: boolean;
  source?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stayStarted(reservation: ReservationEntity, now: Date): boolean {
  return (
    String(reservation.checkin).slice(0, 10) <= now.toISOString().slice(0, 10)
  );
}

function refundedCents(reservation: ReservationEntity): number {
  return Math.round(Number(reservation.amount_refunded ?? 0) * 100);
}

/**
 * Phase 5: cancellation of provider reservations (source = nuitee).
 * Never refunds before the provider confirms the cancellation:
 * claim (requested) -> provider.cancel -> refund total - penalty (sell basis)
 * -> reservation cancelled / provider_status cancelled -> traveler email.
 * PENDING_UNKNOWN or a timeout leaves the claim `pending` for the 5-min cron
 * (resolvePendingCancellation). Hotel cancellations (webhook/reconcile)
 * refund everything and open an incident for V4P.
 */
@Injectable()
export class ProviderCancellationService
  implements OnModuleInit, ProviderCancellationHandler
{
  private readonly logger = new Logger(ProviderCancellationService.name);

  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    @InjectRepository(ProviderOfferEntity)
    private readonly offerRepository: Repository<ProviderOfferEntity>,
    private readonly registry: AccommodationProviderRegistry,
    private readonly payoutService: ReservationPayoutService,
    private readonly economics: ReservationEconomicsService,
    private readonly eventService: ReservationEventService,
    private readonly incidents: ProviderIncidentService,
    private readonly notifier: ProviderNotifierService,
    @Optional() private readonly bridge?: ProviderCancellationBridge,
  ) {}

  onModuleInit(): void {
    this.bridge?.register(this);
  }

  // ------------------------------------------------------------------ quote

  cancellableState(
    reservation: ReservationEntity,
    now: Date,
  ): CancellableState {
    if (reservation.source !== "nuitee") {
      return { kind: "blocked", reason: PROVIDER_CANCEL_BLOCK.NOT_PROVIDER };
    }
    if (
      reservation.status === "cancelled" ||
      reservation.provider_status === "cancelled" ||
      reservation.provider_status === "failed"
    ) {
      return {
        kind: "blocked",
        reason: PROVIDER_CANCEL_BLOCK.ALREADY_CANCELLED,
      };
    }
    if (reservation.status === "pending") {
      // Card authorized: the book may be running. Wait for its outcome.
      const authorized = Boolean(reservation.stripe_payment_intent_id);
      return authorized || reservation.provider_status === "booking"
        ? { kind: "blocked", reason: PROVIDER_CANCEL_BLOCK.BOOKING_IN_PROGRESS }
        : { kind: "unpaid_pending" };
    }
    const record = readCancellationRecord(reservation.provider_booking_json);
    if (record && record.status !== PROVIDER_CANCELLATION_STATUS.CANCELLED) {
      return { kind: "blocked", reason: PROVIDER_CANCEL_BLOCK.IN_PROGRESS };
    }
    if (
      reservation.status !== "confirmed" ||
      reservation.provider_status !== "confirmed" ||
      !reservation.external_reservation_id
    ) {
      return { kind: "blocked", reason: PROVIDER_CANCEL_BLOCK.NOT_CONFIRMED };
    }
    if (
      reservation.payment_status !== "paid" ||
      !reservation.stripe_payment_intent_id
    ) {
      return { kind: "blocked", reason: PROVIDER_CANCEL_BLOCK.NOT_PAID };
    }
    if (stayStarted(reservation, now)) {
      return { kind: "blocked", reason: PROVIDER_CANCEL_BLOCK.STAY_STARTED };
    }
    return { kind: "confirmed" };
  }

  private async loadOffer(
    reservation: ReservationEntity,
  ): Promise<ProviderCancellationOfferInput> {
    const offer = await this.offerRepository.findOne({
      where: { reservation_id: reservation.id },
      order: { id: "DESC" },
    });
    if (offer) {
      return {
        refundable: offer.refundable,
        cancellation_json: offer.cancellation_json,
        net_cents: offer.net_cents,
        markup_rate: offer.markup_rate ?? null,
        currency: offer.currency,
      };
    }
    this.logger.warn(
      `Provider reservation ${reservation.id} has no provider_offers row; penalty only from the provider`,
    );
    return {
      refundable: true,
      cancellation_json: [],
      net_cents: 0,
      markup_rate: null,
      currency: reservation.currency ?? "EUR",
    };
  }

  private async computeQuote(
    reservation: ReservationEntity,
    now: Date,
    extra: {
      providerPenaltyNetCents?: number | null;
      providerCurrency?: string | null;
      waivePenalty?: boolean;
    } = {},
  ): Promise<{
    quote: ProviderCancellationQuote;
    offer: ProviderCancellationOfferInput;
  }> {
    const offer = await this.loadOffer(reservation);
    const quote = quoteProviderCancellation({
      offer,
      chargedCents: expectedChargeCents(reservation),
      alreadyRefundedCents: refundedCents(reservation),
      now,
      fallbackMarkupRate: reservation.commission_rate ?? null,
      providerPenaltyNetCents: extra.providerPenaltyNetCents ?? null,
      providerPenaltyCurrency: extra.providerCurrency ?? null,
      waivePenalty: extra.waivePenalty ?? false,
    });
    return { quote, offer };
  }

  /** GET /v1/provider-reservations/:id/cancellation-quote (no side effects). */
  async quoteForReservation(
    reservationId: number,
    now: Date = new Date(),
  ): Promise<ProviderCancellationQuoteResponse> {
    const reservation = await this.reservationRepository.findOne({
      where: { id: reservationId },
    });
    if (!reservation || reservation.source !== "nuitee") {
      throw new NotFoundException(
        `Provider reservation ${reservationId} not found`,
      );
    }
    return this.buildQuoteResponse(reservation, now);
  }

  private async buildQuoteResponse(
    reservation: ReservationEntity,
    now: Date,
  ): Promise<ProviderCancellationQuoteResponse> {
    const state = this.cancellableState(reservation, now);
    const timezone = reservation.timezone ?? DEFAULT_TIMEZONE;
    const record = readCancellationRecord(reservation.provider_booking_json);
    const base = {
      reservation_id: reservation.id,
      currency: reservation.currency ?? "EUR",
      timezone,
      cancellation_status: record?.status ?? null,
    };
    if (state.kind === "unpaid_pending") {
      return {
        ...base,
        can_cancel: true,
        blocked_reason: null,
        policy_text: null,
        paid_cents: 0,
        penalty_net_cents: 0,
        penalty_cents: 0,
        refund_cents: 0,
        within_free_period: true,
        deadline_iso: null,
        penalty_source: "computed",
      };
    }
    const { quote, offer } = await this.computeQuote(reservation, now);
    return {
      ...base,
      ...quote,
      can_cancel: state.kind === "confirmed",
      blocked_reason: state.kind === "blocked" ? state.reason : null,
      policy_text: cancellationText(
        offer.refundable,
        offer.cancellation_json,
        timezone,
      ),
    };
  }

  /** Traveler panel "cancel-preview" for source = nuitee (bridge). */
  async previewTravelerCancellation(
    reservation: ReservationEntity,
    reason: TravelerCancellationReason,
    now: Date,
  ): Promise<TravelerCancelPreviewResponseDto> {
    const quote = await this.buildQuoteResponse(reservation, now);
    return {
      can_cancel: quote.can_cancel,
      paid_cents: quote.paid_cents,
      penalty_cents: quote.penalty_cents,
      refund_cents: quote.refund_cents,
      within_free_period: quote.within_free_period,
      deadline_iso: quote.deadline_iso,
      policy_text: quote.policy_text,
      // No V4P nights/inventory behind a provider reservation.
      releases_inventory: false,
      // The provider policy applies to every reason (no V4P review).
      requires_review: false,
      source: CANCELLATION_QUOTE_SOURCE.PROVIDER,
      reservation_id: reservation.id,
      cancellation_reason: reason,
      currency: quote.currency,
      timezone: quote.timezone,
      charge_pending: false,
    };
  }

  // ----------------------------------------------------------------- cancel

  /** Traveler cancellation (bridge from ReservationRefundService). */
  async cancelByTraveler(
    reservationId: number,
    input: ProviderTravelerCancelInput,
  ): Promise<ProviderTravelerCancelOutcome> {
    const result = await this.cancel(reservationId, {
      initiator: PROVIDER_CANCELLATION_INITIATOR.TRAVELER,
      reason: input.reason,
      notes: input.notes,
      actorId: input.userId,
      actor: actors.traveler(input.userId),
      waivePenalty: false,
    });
    const reservation = await this.reservationRepository.findOne({
      where: { id: reservationId },
    });
    if (!reservation) {
      throw new NotFoundException(`Reservation ${reservationId} not found`);
    }
    return {
      reservation,
      refundInitiated: result.refund_initiated,
      pending: result.outcome === PROVIDER_CANCEL_OUTCOME.PENDING,
      penaltyCents: result.penalty_cents,
      refundCents: result.refund_cents,
    };
  }

  /** Backoffice cancellation (optionally waiving the penalty for the traveler). */
  cancelByAdmin(
    reservationId: number,
    input: {
      waivePenalty: boolean;
      notes: string | null;
      adminId: number | null;
    },
  ): Promise<ProviderCancelResult> {
    return this.cancel(reservationId, {
      initiator: PROVIDER_CANCELLATION_INITIATOR.ADMIN,
      reason: ADMIN_CANCEL_REASON,
      notes: input.notes,
      actorId: input.adminId,
      actor: actors.admin(input.adminId),
      waivePenalty: input.waivePenalty,
    });
  }

  async cancel(
    reservationId: number,
    request: CancelRequest,
    now: Date = new Date(),
  ): Promise<ProviderCancelResult> {
    const current = await this.reservationRepository.findOne({
      where: { id: reservationId },
    });
    if (!current) {
      throw new NotFoundException(`Reservation ${reservationId} not found`);
    }
    const state = this.cancellableState(current, now);
    if (state.kind === "unpaid_pending") {
      return this.cancelUnpaid(reservationId, request, now);
    }
    if (state.kind === "blocked") {
      if (state.reason === PROVIDER_CANCEL_BLOCK.ALREADY_CANCELLED) {
        return this.result(
          current,
          PROVIDER_CANCEL_OUTCOME.NOOP,
          0,
          0,
          false,
          state.reason,
        );
      }
      if (state.reason === PROVIDER_CANCEL_BLOCK.IN_PROGRESS) {
        return this.result(
          current,
          PROVIDER_CANCEL_OUTCOME.PENDING,
          0,
          0,
          false,
          state.reason,
        );
      }
      throw new BadRequestException({
        code: state.reason,
        message: "This provider reservation cannot be cancelled now",
      });
    }

    const claimed = await this.claim(reservationId, request, now);
    if (!claimed) {
      throw new ConflictException({
        code: PROVIDER_CANCEL_BLOCK.IN_PROGRESS,
        message: "The reservation changed while cancelling; try again",
      });
    }

    const bookingId = String(claimed.external_reservation_id);
    let cancelResult: CancelResult;
    try {
      cancelResult = await this.registry.get(claimed.source).cancel(bookingId);
    } catch (error) {
      if (error instanceof ProviderTransientError) {
        // May have reached the provider: never refund, never release.
        await this.markPending(reservationId, {
          provider_raw_status: `transient:${error.code}`,
        });
        return this.result(
          claimed,
          PROVIDER_CANCEL_OUTCOME.PENDING,
          0,
          0,
          false,
          "provider_timeout",
        );
      }
      await this.releaseClaim(reservationId, errorMessage(error));
      throw new BadGatewayException({
        code: "provider_cancel_failed",
        message: `The provider refused the cancellation: ${errorMessage(error)}`,
      });
    }

    if (cancelResult.status === PROVIDER_CANCEL_STATUS.PENDING_UNKNOWN) {
      await this.markPending(reservationId, {
        provider_raw_status: cancelResult.rawStatus,
        penalty_net_cents: cancelResult.penaltyCents,
      });
      await this.eventService.logEvent(
        reservationId,
        "provider_cancellation_pending",
        {
          raw_status: cancelResult.rawStatus,
        },
      );
      return this.result(
        claimed,
        PROVIDER_CANCEL_OUTCOME.PENDING,
        0,
        0,
        false,
        "provider_pending",
      );
    }

    return this.finalize(reservationId, {
      now,
      rawStatus: cancelResult.rawStatus,
      providerPenaltyNetCents: cancelResult.penaltyCents,
      providerCurrency: cancelResult.currency,
      source: "cancel_call",
    });
  }

  /** Pending, never authorized: nothing at the provider, nothing charged. */
  private async cancelUnpaid(
    reservationId: number,
    request: CancelRequest,
    now: Date,
  ): Promise<ProviderCancelResult> {
    const saved = await this.reservationRepository.manager.transaction(
      async manager => {
        const repository = manager.getRepository(ReservationEntity);
        const reservation = await repository.findOne({
          where: { id: reservationId },
          lock: { mode: "pessimistic_write" },
        });
        if (
          !reservation ||
          reservation.status !== "pending" ||
          Boolean(reservation.stripe_payment_intent_id) ||
          reservation.provider_status === "booking"
        ) {
          return null;
        }
        reservation.status = "cancelled";
        reservation.cancelled_at = now;
        reservation.cancel_reason = request.reason;
        reservation.refund_on_cancel = false;
        reservation.provider_status = "cancelled";
        await repository.save(reservation);
        await this.economics.recordPaymentFailed(
          manager,
          reservationId,
          `cancelled_by_${request.initiator}`,
          request.actor,
        );
        await this.eventService.logEventInTransaction(
          manager,
          reservationId,
          "cancelled",
          {
            by: request.initiator,
            reason: request.reason,
            notes: request.notes,
            refund: false,
            quote_source: CANCELLATION_QUOTE_SOURCE.PROVIDER,
          },
        );
        return reservation;
      },
    );
    if (!saved) {
      throw new ConflictException({
        code: PROVIDER_CANCEL_BLOCK.BOOKING_IN_PROGRESS,
        message: "The reservation changed while cancelling; try again",
      });
    }
    return this.result(saved, PROVIDER_CANCEL_OUTCOME.CANCELLED, 0, 0, false);
  }

  /** confirmed -> cancellation.requested under the row lock. */
  private async claim(
    reservationId: number,
    request: CancelRequest,
    now: Date,
  ): Promise<ReservationEntity | null> {
    return this.reservationRepository.manager.transaction(async manager => {
      const repository = manager.getRepository(ReservationEntity);
      const reservation = await repository.findOne({
        where: { id: reservationId },
        lock: { mode: "pessimistic_write" },
      });
      if (
        !reservation ||
        this.cancellableState(reservation, now).kind !== "confirmed"
      ) {
        return null;
      }
      const record: ProviderCancellationRecord = {
        status: PROVIDER_CANCELLATION_STATUS.REQUESTED,
        initiator: request.initiator,
        requested_at: now.toISOString(),
        reason: request.reason,
        notes: request.notes,
        actor_id: request.actorId,
        waive_penalty: request.waivePenalty,
        provider_raw_status: null,
        penalty_net_cents: null,
        penalty_cents: null,
        refund_cents: null,
        completed_at: null,
        alerted_at: null,
      };
      reservation.provider_booking_json = withCancellationRecord(
        reservation.provider_booking_json,
        record,
      );
      await repository.save(reservation);
      await this.eventService.logEventInTransaction(
        manager,
        reservationId,
        "provider_cancellation_requested",
        {
          by: request.initiator,
          reason: request.reason,
          waive_penalty: request.waivePenalty,
        },
      );
      return reservation;
    });
  }

  /** Definitive provider error: drop the claim, the booking stays live. */
  private async releaseClaim(
    reservationId: number,
    message: string,
  ): Promise<void> {
    await this.reservationRepository.manager.transaction(async manager => {
      const repository = manager.getRepository(ReservationEntity);
      const reservation = await repository.findOne({
        where: { id: reservationId },
        lock: { mode: "pessimistic_write" },
      });
      if (!reservation) {
        return;
      }
      reservation.provider_booking_json = withCancellationRecord(
        reservation.provider_booking_json,
        null,
      );
      await repository.save(reservation);
      await this.eventService.logEventInTransaction(
        manager,
        reservationId,
        "provider_cancellation_failed",
        { message },
      );
    });
  }

  private async markPending(
    reservationId: number,
    patch: Partial<ProviderCancellationRecord>,
  ): Promise<void> {
    await this.reservationRepository.manager.transaction(async manager => {
      const repository = manager.getRepository(ReservationEntity);
      const reservation = await repository.findOne({
        where: { id: reservationId },
        lock: { mode: "pessimistic_write" },
      });
      const record = reservation
        ? readCancellationRecord(reservation.provider_booking_json)
        : null;
      if (
        !reservation ||
        !record ||
        record.status === PROVIDER_CANCELLATION_STATUS.CANCELLED
      ) {
        return;
      }
      reservation.provider_booking_json = withCancellationRecord(
        reservation.provider_booking_json,
        { ...record, ...patch, status: PROVIDER_CANCELLATION_STATUS.PENDING },
      );
      await repository.save(reservation);
    });
  }

  // --------------------------------------------------------------- finalize

  /**
   * Provider confirmed the cancellation: refund (total - penalty) through
   * Stripe and close the reservation. Idempotent (already cancelled = noop).
   * A refund failure leaves the claim `pending` (provider already cancelled)
   * so the 5-min cron retries the refund; V4P is alerted.
   */
  async finalize(
    reservationId: number,
    input: FinalizeInput,
  ): Promise<ProviderCancelResult> {
    const now = input.now ?? new Date();
    let outcome: {
      reservation: ReservationEntity;
      quote: ProviderCancellationQuote;
      hotelCancelled: boolean;
      initiator: ProviderCancellationInitiator;
    } | null;
    try {
      outcome = await this.reservationRepository.manager.transaction(
        async manager => {
          const repository = manager.getRepository(ReservationEntity);
          const reservation = await repository.findOne({
            where: { id: reservationId },
            lock: { mode: "pessimistic_write" },
          });
          if (
            !reservation ||
            reservation.source !== "nuitee" ||
            reservation.status === "cancelled" ||
            reservation.provider_status === "cancelled"
          ) {
            return null;
          }
          const existing = readCancellationRecord(
            reservation.provider_booking_json,
          );
          const hotelCancelled = input.hotelCancelled === true && !existing;
          const record: ProviderCancellationRecord = existing ?? {
            status: PROVIDER_CANCELLATION_STATUS.REQUESTED,
            initiator: PROVIDER_CANCELLATION_INITIATOR.PROVIDER,
            requested_at: now.toISOString(),
            reason: PROVIDER_CANCELLED_BY_HOTEL_REASON,
            notes: input.source ?? null,
            actor_id: null,
            waive_penalty: true,
            provider_raw_status: null,
            penalty_net_cents: null,
            penalty_cents: null,
            refund_cents: null,
            completed_at: null,
            alerted_at: null,
          };
          // Policy evaluated when the cancellation was asked, not when the
          // provider (or the cron) confirmed it.
          const requestedAt = new Date(record.requested_at);
          const { quote } = await this.computeQuote(
            reservation,
            Number.isNaN(requestedAt.getTime()) ? now : requestedAt,
            {
              providerPenaltyNetCents:
                input.providerPenaltyNetCents ?? record.penalty_net_cents,
              providerCurrency: input.providerCurrency ?? null,
              waivePenalty: record.waive_penalty || hotelCancelled,
            },
          );

          const before = {
            status: reservation.status,
            payment_status: reservation.payment_status,
            provider_status: reservation.provider_status,
          };
          const canRefund =
            quote.refund_cents > 0 &&
            Boolean(reservation.stripe_payment_intent_id) &&
            (reservation.payment_status === "paid" ||
              reservation.payment_status === "partially_refunded");
          if (canRefund) {
            await this.payoutService.refundInTransaction(
              manager,
              reservation,
              quote.refund_cents,
              `provider_cancel:${record.initiator}`,
              {
                requestedBy: this.actorFor(record),
                approvedBy: this.actorFor(record),
                responsible: this.responsibleFor(record),
              },
            );
          }

          reservation.status = "cancelled";
          reservation.cancelled_at = now;
          reservation.cancel_reason = record.reason;
          reservation.refund_on_cancel = canRefund;
          reservation.provider_status = "cancelled";
          reservation.provider_booking_json = withCancellationRecord(
            reservation.provider_booking_json,
            {
              ...record,
              status: PROVIDER_CANCELLATION_STATUS.CANCELLED,
              provider_raw_status:
                input.rawStatus ?? record.provider_raw_status,
              penalty_net_cents: quote.penalty_net_cents,
              penalty_cents: quote.penalty_cents,
              refund_cents: canRefund ? quote.refund_cents : 0,
              completed_at: now.toISOString(),
            },
          );
          await repository.save(reservation);
          await this.economics.auditReservationChange(
            manager,
            reservation.id,
            "reservation.provider_cancelled",
            this.actorFor(record),
            before,
            {
              status: reservation.status,
              payment_status: reservation.payment_status,
              provider_status: "cancelled",
            },
            {
              initiator: record.initiator,
              penalty_net_cents: quote.penalty_net_cents,
              penalty_cents: quote.penalty_cents,
              refund_cents: canRefund ? quote.refund_cents : 0,
              penalty_source: quote.penalty_source,
              raw_status: input.rawStatus,
              source: input.source ?? null,
            },
          );
          await this.eventService.logEventInTransaction(
            manager,
            reservation.id,
            "cancelled",
            {
              by: record.initiator,
              reason: record.reason,
              notes: record.notes,
              refund: canRefund,
              paid_cents: quote.paid_cents,
              penalty_cents: quote.penalty_cents,
              refund_cents: canRefund ? quote.refund_cents : 0,
              quote_source: CANCELLATION_QUOTE_SOURCE.PROVIDER,
              penalty_source: quote.penalty_source,
            },
          );
          if (hotelCancelled) {
            await this.incidents.openOnce(
              {
                reservationId: reservation.id,
                userId: reservation.user_id,
                key: "hotel_cancelled",
                description: `El proveedor/hotel canceló la reserva ${String(reservation.external_reservation_id)} (${input.rawStatus ?? "CANCELLED"}). Se ha reembolsado el 100 % (${(quote.refund_cents / 100).toFixed(2)} €). Contactar con el viajero para ofrecer alternativa.`,
              },
              manager,
            );
          }
          return {
            reservation,
            quote: canRefund ? quote : { ...quote, refund_cents: 0 },
            hotelCancelled,
            initiator: record.initiator,
          };
        },
      );
    } catch (error) {
      this.logger.error(
        `Provider cancellation of reservation ${reservationId} confirmed but closing/refunding failed: ${errorMessage(error)}`,
      );
      await this.markPending(reservationId, {
        provider_raw_status: input.rawStatus,
        ...(input.providerPenaltyNetCents === undefined ||
        input.providerPenaltyNetCents === null
          ? {}
          : { penalty_net_cents: input.providerPenaltyNetCents }),
      });
      const reservation = await this.reservationRepository.findOne({
        where: { id: reservationId },
      });
      if (reservation) {
        await this.notifier.alertAdmin(
          reservation,
          `El proveedor confirmó la cancelación pero el reembolso/cierre en V4P falló: ${errorMessage(error)}. Se reintentará automáticamente.`,
        );
        return this.result(
          reservation,
          PROVIDER_CANCEL_OUTCOME.PENDING,
          0,
          0,
          false,
          "refund_failed",
        );
      }
      throw error;
    }

    if (!outcome) {
      const reservation = await this.reservationRepository.findOne({
        where: { id: reservationId },
      });
      return {
        reservation_id: reservationId,
        outcome: PROVIDER_CANCEL_OUTCOME.NOOP,
        provider_status: reservation?.provider_status ?? null,
        penalty_cents: 0,
        refund_cents: 0,
        refund_initiated: false,
        reason: "already_cancelled",
      };
    }

    const refunded = outcome.quote.refund_cents > 0;
    await this.notifier.sendCancelled(outcome.reservation, refunded);
    if (outcome.hotelCancelled) {
      await this.notifier.alertAdmin(
        outcome.reservation,
        `El hotel/proveedor ha cancelado la reserva ${String(outcome.reservation.external_reservation_id)}. Reembolso completo emitido e incidencia abierta.`,
      );
    }
    return this.result(
      outcome.reservation,
      PROVIDER_CANCEL_OUTCOME.CANCELLED,
      outcome.quote.penalty_cents,
      outcome.quote.refund_cents,
      refunded,
    );
  }

  /**
   * Provider reports CANCELLED for a confirmed booking (webhook / daily
   * reconciliation, always after getBooking). With a V4P claim it finishes
   * our cancellation; without one the hotel cancelled: full refund.
   */
  async handleProviderCancelled(
    reservationId: number,
    rawStatus: string | null,
    source: string,
  ): Promise<ProviderCancelResult> {
    return this.finalize(reservationId, {
      rawStatus,
      hotelCancelled: true,
      source,
    });
  }

  /**
   * Cron: claims left `pending` (PENDING_UNKNOWN, timeout, failed refund) or
   * a `requested` claim older than STALE_CANCEL_CLAIM_MS (crash mid-call).
   * Refunds only once getBooking says CANCELLED.
   */
  async resolvePendingCancellation(
    reservationId: number,
    now: Date = new Date(),
  ): Promise<ProviderCancelResult> {
    const reservation = await this.reservationRepository.findOne({
      where: { id: reservationId },
    });
    const record = reservation
      ? readCancellationRecord(reservation.provider_booking_json)
      : null;
    if (
      !reservation ||
      !record ||
      record.status === PROVIDER_CANCELLATION_STATUS.CANCELLED ||
      reservation.status === "cancelled"
    ) {
      return {
        reservation_id: reservationId,
        outcome: PROVIDER_CANCEL_OUTCOME.NOOP,
        provider_status: reservation?.provider_status ?? null,
        penalty_cents: 0,
        refund_cents: 0,
        refund_initiated: false,
        reason: "not_pending",
      };
    }
    const age = now.getTime() - Date.parse(record.requested_at);
    if (
      record.status === PROVIDER_CANCELLATION_STATUS.REQUESTED &&
      age < STALE_CANCEL_CLAIM_MS
    ) {
      return this.result(
        reservation,
        PROVIDER_CANCEL_OUTCOME.PENDING,
        0,
        0,
        false,
        "in_flight",
      );
    }
    const booking = await this.registry
      .get(reservation.source)
      .getBooking(String(reservation.external_reservation_id));
    if (booking.status === PROVIDER_BOOKING_STATUS.CANCELLED) {
      return this.finalize(reservationId, {
        now,
        rawStatus: booking.rawStatus,
        source: "reconcile_pending",
      });
    }
    if (age >= PENDING_CANCEL_ALERT_MS && !record.alerted_at) {
      await this.markPending(reservationId, { alerted_at: now.toISOString() });
      await this.notifier.alertAdmin(
        reservation,
        `Cancelación solicitada el ${record.requested_at} sin confirmar por el proveedor (estado ${booking.rawStatus ?? booking.status}). Revisar en Nuitee; no se ha reembolsado nada.`,
      );
    }
    return this.result(
      reservation,
      PROVIDER_CANCEL_OUTCOME.PENDING,
      0,
      0,
      false,
      "provider_pending",
    );
  }

  /**
   * booking.cancel_error webhook for a V4P cancellation still `requested` /
   * `pending` (the caller already checked getBooking is NOT cancelled):
   * drops the claim (the booking stays live, nothing is refunded) and
   * alerts V4P. Returns false when there was no open claim.
   */
  async failPendingCancellation(
    reservationId: number,
    message: string,
  ): Promise<boolean> {
    const failed = await this.reservationRepository.manager.transaction(
      async manager => {
        const repository = manager.getRepository(ReservationEntity);
        const reservation = await repository.findOne({
          where: { id: reservationId },
          lock: { mode: "pessimistic_write" },
        });
        const record = reservation
          ? readCancellationRecord(reservation.provider_booking_json)
          : null;
        if (
          !reservation ||
          !record ||
          record.status === PROVIDER_CANCELLATION_STATUS.CANCELLED ||
          reservation.status === "cancelled"
        ) {
          return null;
        }
        reservation.provider_booking_json = withCancellationRecord(
          reservation.provider_booking_json,
          null,
        );
        await repository.save(reservation);
        await this.eventService.logEventInTransaction(
          manager,
          reservationId,
          "provider_cancellation_failed",
          { message, source: "webhook:booking.cancel_error" },
        );
        return reservation;
      },
    );
    if (!failed) {
      return false;
    }
    await this.notifier.alertAdmin(
      failed,
      `Nuitee rechazó la cancelación de la reserva ${String(failed.external_reservation_id)}: ${message}. La reserva sigue activa y no se ha reembolsado nada; revisar con el viajero.`,
    );
    return true;
  }

  // ---------------------------------------------------------------- helpers

  private actorFor(record: ProviderCancellationRecord): Actor {
    if (record.initiator === PROVIDER_CANCELLATION_INITIATOR.TRAVELER) {
      return actors.traveler(record.actor_id);
    }
    if (record.initiator === PROVIDER_CANCELLATION_INITIATOR.ADMIN) {
      return actors.admin(record.actor_id);
    }
    return actors.system("provider_cancellation");
  }

  private responsibleFor(
    record: ProviderCancellationRecord,
  ): RefundResponsible {
    return record.initiator === PROVIDER_CANCELLATION_INITIATOR.TRAVELER
      ? REFUND_RESPONSIBLE.TRAVELER
      : REFUND_RESPONSIBLE.PLATFORM;
  }

  private result(
    reservation: ReservationEntity,
    outcome: ProviderCancelResult["outcome"],
    penaltyCents: number,
    refundCents: number,
    refundInitiated: boolean,
    reason?: string,
  ): ProviderCancelResult {
    return {
      reservation_id: reservation.id,
      outcome,
      provider_status: reservation.provider_status ?? null,
      penalty_cents: penaltyCents,
      refund_cents: refundCents,
      refund_initiated: refundInitiated,
      ...(reason === undefined ? {} : { reason }),
    };
  }
}
