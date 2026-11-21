import type { Site } from "@/src/types/site.types";
import type {
  BookResult,
  ProviderCancellationPolicy,
  ProviderTax,
} from "../../providers/domain/provider.types";
import type { ReservationEmailProviderDetails } from "../../reservations/types/reservation-email.types";
import type {
  AfterCommitTask,
  StripeWebhookEvent,
  WebhookHandlerResult,
} from "../../webhook/types/stripe-webhook-event.type";
import type {
  ProviderBookingRecord,
  ProviderBookResult,
  ProviderFailureReason,
} from "../domain/provider-reservation.types";

import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";

import { actors } from "../../payments/domain/audit-actor";
import { ReservationEconomicsService } from "../../payments/services/reservation-economics.service";
import {
  ProviderDuplicateReferenceError,
  ProviderError,
  ProviderInProgressError,
  ProviderTransientError,
} from "../../providers/domain/provider.errors";
import { PROVIDER_BOOKING_STATUS } from "../../providers/domain/provider.types";
import { computeSellPrice } from "../../providers/domain/provider-pricing";
import { ProviderOfferEntity } from "../../providers/entities/provider-offer.entity";
import { ProviderPropertyEntity } from "../../providers/entities/provider-property.entity";
import { AccommodationProviderRegistry } from "../../providers/services/accommodation-provider.registry";
import { ReservationEntity } from "../../reservations/entities/reservation.entity";
import { ReservationEmailService } from "../../reservations/services/reservation-email.service";
import { ReservationEventService } from "../../reservations/services/reservation-event.service";
import { envs } from "../../shared/configs/envs";
import { MysqlService } from "../../shared/services/mysql.service";
import { StripeService } from "../../stripe/services/stripe.service";
import {
  PROVIDER_BOOK_OUTCOME,
  PROVIDER_FAILURE_REASON,
} from "../domain/provider-reservation.types";
import {
  authorizationExpiring,
  clientReferenceFor,
  isPrebookStale,
  pendingTimeoutReason,
  readBookingRecord,
} from "../domain/provider-reservation.util";
import { ProviderAlternativesService } from "./provider-alternatives.service";

interface CheckoutSessionPayload {
  id: string;
  metadata?: Record<string, string> | null;
  payment_intent?: string | { id: string } | null;
}

/** checkout.session.* of a provider reservation (metadata.source). */
export function isProviderCheckoutEvent(event: StripeWebhookEvent): boolean {
  const session = event.data.object as CheckoutSessionPayload | null;
  return session?.metadata?.source === "nuitee";
}

function resolveId(
  value: string | { id: string } | null | undefined,
): string | null {
  if (typeof value === "string") {
    return value;
  }
  return value?.id ?? null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const SYSTEM_ACTOR = actors.system("provider_booking");

type ClaimResult =
  | { kind: "noop"; reason: string; providerStatus: string | null }
  | { kind: "fail"; reason: ProviderFailureReason }
  | {
      kind: "proceed";
      reservation: ReservationEntity;
      offer: ProviderOfferEntity;
      record: ProviderBookingRecord;
    };

/**
 * Provider booking after the card is authorized (manual capture):
 * - checkout.session.completed (source = nuitee) records the authorization
 *   in the webhook transaction and books in the background;
 * - book(): claim (prebooked -> booking) under the row lock, re-prebook if
 *   stale, call the provider, then confirm (capture) or fail (void);
 * - resolvePending(): reconciles an unknown outcome by clientReference.
 *   Public on purpose: phase 5's cron calls it for provider_status booking
 *   (and prebooked + authorized, e.g. a crash before the book call).
 * Never touches availability, nights or host payouts.
 */
@Injectable()
export class ProviderBookingService {
  private readonly logger = new Logger(ProviderBookingService.name);

  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    @InjectRepository(ProviderOfferEntity)
    private readonly offerRepository: Repository<ProviderOfferEntity>,
    @InjectRepository(ProviderPropertyEntity)
    private readonly propertyRepository: Repository<ProviderPropertyEntity>,
    private readonly registry: AccommodationProviderRegistry,
    private readonly stripeService: StripeService,
    private readonly economics: ReservationEconomicsService,
    private readonly eventService: ReservationEventService,
    private readonly emailService: ReservationEmailService,
    private readonly alternatives: ProviderAlternativesService,
    private readonly mysqlService: MysqlService,
  ) {}

  // --------------------------------------------------------------- webhook

  /**
   * checkout.session.completed / async_payment_succeeded of a provider
   * reservation. Runs in the webhook transaction; the provider call happens
   * after commit and is not awaited (Stripe must get its 2xx quickly).
   */
  async handleCheckoutCompleted(
    event: StripeWebhookEvent,
    manager: EntityManager,
    afterCommit: AfterCommitTask[],
  ): Promise<WebhookHandlerResult> {
    const session = event.data.object as CheckoutSessionPayload;
    const reservationId = Number(session.metadata?.reservation_id);
    if (!Number.isInteger(reservationId) || reservationId <= 0) {
      this.logger.warn(
        `Provider checkout session ${session.id} missing metadata.reservation_id`,
      );
      return {};
    }
    const paymentIntentId = resolveId(session.payment_intent);
    if (!paymentIntentId) {
      throw new Error(
        `Provider checkout session ${session.id} completed without payment_intent`,
      );
    }

    const result = await this.recordAuthorization(manager, {
      reservationId,
      checkoutSessionId: session.id,
      paymentIntentId,
      eventId: event.id,
    });
    if (result.voidPaymentIntentId) {
      const duplicate = result.voidPaymentIntentId;
      afterCommit.push(async () => {
        await this.stripeService.cancelPaymentIntent({
          reservationId,
          paymentIntentId: duplicate,
        });
      });
    }
    if (result.shouldBook) {
      afterCommit.push(() => {
        this.bookInBackground(reservationId);
        return Promise.resolve();
      });
    }
    return { reservationId };
  }

  async recordAuthorization(
    manager: EntityManager,
    input: {
      reservationId: number;
      checkoutSessionId: string;
      paymentIntentId: string;
      eventId: string | null;
    },
  ): Promise<{ shouldBook: boolean; voidPaymentIntentId: string | null }> {
    const repository = manager.getRepository(ReservationEntity);
    const reservation = await repository.findOne({
      where: { id: input.reservationId },
      lock: { mode: "pessimistic_write" },
    });
    if (!reservation || reservation.source !== "nuitee") {
      this.logger.warn(
        `Provider checkout for reservation ${input.reservationId}: not a provider reservation`,
      );
      return { shouldBook: false, voidPaymentIntentId: null };
    }
    const current = reservation.stripe_payment_intent_id ?? null;
    if (current === input.paymentIntentId) {
      // Webhook replay: book() is idempotent.
      return { shouldBook: true, voidPaymentIntentId: null };
    }
    if (current !== null) {
      // A second authorization for the same reservation: void it.
      await this.eventService.logEventInTransaction(
        manager,
        reservation.id,
        "provider_duplicate_authorization",
        { payment_intent_id: input.paymentIntentId, kept: current },
      );
      return { shouldBook: false, voidPaymentIntentId: input.paymentIntentId };
    }

    const record = readBookingRecord(reservation.provider_booking_json);
    reservation.stripe_payment_intent_id = input.paymentIntentId;
    reservation.stripe_checkout_session_id = input.checkoutSessionId;
    if (record) {
      reservation.provider_booking_json = {
        ...record,
        authorized_at: new Date().toISOString(),
      } satisfies ProviderBookingRecord;
    }
    await repository.save(reservation);
    const actor = actors.stripe(input.eventId);
    await this.economics.recordPaymentProcessing(
      manager,
      reservation.id,
      input.checkoutSessionId,
      input.paymentIntentId,
      actor,
    );
    await this.eventService.logEventInTransaction(
      manager,
      reservation.id,
      "provider_payment_authorized",
      {
        payment_intent_id: input.paymentIntentId,
        checkout_session_id: input.checkoutSessionId,
      },
    );
    return { shouldBook: true, voidPaymentIntentId: null };
  }

  bookInBackground(reservationId: number): void {
    this.book(reservationId).catch((error: unknown) => {
      this.logger.error(
        `Provider book failed unexpectedly for reservation ${reservationId}; resolvePending will reconcile`,
        error instanceof Error ? error.stack : String(error),
      );
    });
  }

  // ------------------------------------------------------------------ book

  async book(reservationId: number): Promise<ProviderBookResult> {
    const claim = await this.claimForBooking(reservationId);
    if (claim.kind === "noop") {
      return {
        reservationId,
        outcome: PROVIDER_BOOK_OUTCOME.NOOP,
        providerStatus: claim.providerStatus,
        reason: claim.reason,
      };
    }
    if (claim.kind === "fail") {
      return this.fail(reservationId, claim.reason, null);
    }

    const { reservation, record } = claim;
    let offer = claim.offer;
    const paymentIntentId = String(reservation.stripe_payment_intent_id);
    const chargedCents = reservation.total_cents ?? 0;

    const intent =
      await this.stripeService.retrievePaymentIntentState(paymentIntentId);
    if (
      !intent ||
      intent.status !== "requires_capture" ||
      intent.amountCapturable < chargedCents
    ) {
      return this.fail(
        reservationId,
        PROVIDER_FAILURE_REASON.PAYMENT_NOT_AUTHORIZED,
        `PaymentIntent ${paymentIntentId} status=${intent?.status ?? "missing"}`,
      );
    }

    const provider = this.registry.get(reservation.source);

    if (isPrebookStale(offer, new Date())) {
      try {
        const prebook = await provider.prebook(offer.offer_id);
        const netCents = prebook.offer.netCents;
        if (netCents === null || netCents <= 0) {
          return this.fail(
            reservationId,
            PROVIDER_FAILURE_REASON.UNAVAILABLE,
            "Re-prebook returned no price",
          );
        }
        const markupRate =
          offer.markup_rate ?? reservation.commission_rate ?? 0;
        const newSell = computeSellPrice(netCents, markupRate).sellCents;
        if (newSell > chargedCents) {
          return this.fail(
            reservationId,
            PROVIDER_FAILURE_REASON.PRICE_INCREASED,
            `Re-prebook sell ${newSell} > charged ${chargedCents}`,
          );
        }
        offer = await this.refreshOffer(offer, {
          prebookId: prebook.prebookId,
          netCents,
          raw: prebook.raw,
        });
      } catch (error) {
        if (error instanceof ProviderTransientError) {
          // Nothing was booked: back to prebooked so resolvePending retries.
          await this.releaseClaim(reservationId, errorMessage(error));
          return {
            reservationId,
            outcome: PROVIDER_BOOK_OUTCOME.PENDING,
            providerStatus: "prebooked",
            reason: "prebook_transient",
          };
        }
        if (error instanceof ProviderError) {
          return this.fail(
            reservationId,
            PROVIDER_FAILURE_REASON.OFFER_EXPIRED,
            errorMessage(error),
          );
        }
        throw error;
      }
    }

    let result: BookResult;
    try {
      result = await provider.book({
        prebookId: String(offer.prebook_id),
        clientReference:
          reservation.client_reference ?? clientReferenceFor(reservation.id),
        holder: {
          firstName: record.holder.firstName,
          lastName: record.holder.lastName,
          email: record.holder.email,
          phone: record.holder.phone,
        },
        guests: [
          {
            occupancyNumber: 1,
            firstName: record.holder.firstName,
            lastName: record.holder.lastName,
            email: record.holder.email,
            remarks: record.remarks,
          },
        ],
      });
    } catch (error) {
      if (
        error instanceof ProviderInProgressError ||
        error instanceof ProviderTransientError ||
        error instanceof ProviderDuplicateReferenceError
      ) {
        this.logger.warn(
          `Provider book outcome unknown for reservation ${reservationId} (${error.name}); reconciling`,
        );
        await this.eventService.logEvent(
          reservationId,
          "provider_booking_unknown",
          { error: error.name, code: error.code },
        );
        return this.resolvePending(reservationId);
      }
      if (error instanceof ProviderError) {
        return this.fail(
          reservationId,
          PROVIDER_FAILURE_REASON.UNAVAILABLE,
          `${error.name} ${error.code}: ${error.message}`,
        );
      }
      // Unknown failure: the booking may exist; reconcile, never assume.
      this.logger.error(
        `Provider book crashed for reservation ${reservationId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return this.resolvePending(reservationId);
    }

    if (result.status === PROVIDER_BOOKING_STATUS.CONFIRMED) {
      return this.confirm(reservationId, result);
    }
    if (result.status === PROVIDER_BOOKING_STATUS.CANCELLED) {
      return this.fail(
        reservationId,
        PROVIDER_FAILURE_REASON.PROVIDER_REJECTED,
        `Provider status ${result.rawStatus ?? "CANCELLED"}`,
      );
    }
    return this.resolvePending(reservationId);
  }

  // -------------------------------------------------------- resolve pending

  /**
   * Reconciles a provider reservation whose booking outcome is unknown.
   * Safe to call repeatedly (cron). Never voids while a CONFIRMED booking
   * exists; fails only when nothing was found after
   * PROVIDER_PENDING_FAIL_AFTER_MINUTES or the authorization is too old.
   */
  async resolvePending(
    reservationId: number,
    now: Date = new Date(),
  ): Promise<ProviderBookResult> {
    const reservation = await this.reservationRepository.findOne({
      where: { id: reservationId },
    });
    if (!reservation || reservation.source !== "nuitee") {
      return {
        reservationId,
        outcome: PROVIDER_BOOK_OUTCOME.NOOP,
        providerStatus: null,
        reason: "not_provider_reservation",
      };
    }
    const record = readBookingRecord(reservation.provider_booking_json);
    const timing = {
      record,
      reservationCreatedAt: reservation.created_at,
      now,
      failAfterMinutes: envs.PROVIDER_PENDING_FAIL_AFTER_MINUTES,
      authMaxAgeHours: envs.PROVIDER_AUTH_MAX_AGE_HOURS,
    };

    if (
      reservation.provider_status === "prebooked" &&
      reservation.stripe_payment_intent_id
    ) {
      if (authorizationExpiring(timing)) {
        return this.fail(
          reservationId,
          PROVIDER_FAILURE_REASON.AUTHORIZATION_EXPIRING,
          null,
        );
      }
      // Authorized but never booked (crash / transient prebook): book now.
      return this.book(reservationId);
    }
    if (reservation.provider_status !== "booking") {
      return {
        reservationId,
        outcome: PROVIDER_BOOK_OUTCOME.NOOP,
        providerStatus: reservation.provider_status ?? null,
        reason: "not_pending",
      };
    }

    const clientReference =
      reservation.client_reference ?? clientReferenceFor(reservation.id);
    let bookings: BookResult[];
    try {
      bookings = await this.registry
        .get(reservation.source)
        .listBookings(clientReference);
    } catch (error) {
      this.logger.warn(
        `listBookings(${clientReference}) failed: ${errorMessage(error)}`,
      );
      if (authorizationExpiring(timing)) {
        return this.fail(
          reservationId,
          PROVIDER_FAILURE_REASON.AUTHORIZATION_EXPIRING,
          errorMessage(error),
        );
      }
      return {
        reservationId,
        outcome: PROVIDER_BOOK_OUTCOME.PENDING,
        providerStatus: "booking",
        reason: "list_failed",
      };
    }

    const confirmed = bookings.find(
      booking => booking.status === PROVIDER_BOOKING_STATUS.CONFIRMED,
    );
    if (confirmed) {
      return this.confirm(reservationId, confirmed);
    }
    const stillPending = bookings.some(
      booking => booking.status === PROVIDER_BOOKING_STATUS.PENDING_UNKNOWN,
    );
    if (stillPending) {
      if (authorizationExpiring(timing)) {
        return this.fail(
          reservationId,
          PROVIDER_FAILURE_REASON.AUTHORIZATION_EXPIRING,
          "Provider booking still pending",
        );
      }
      return {
        reservationId,
        outcome: PROVIDER_BOOK_OUTCOME.PENDING,
        providerStatus: "booking",
        reason: "provider_pending",
      };
    }
    if (bookings.length > 0) {
      return this.fail(
        reservationId,
        PROVIDER_FAILURE_REASON.PROVIDER_CANCELLED,
        "Provider booking cancelled",
      );
    }
    const timeout = pendingTimeoutReason(timing);
    if (timeout) {
      return this.fail(reservationId, timeout, "No provider booking found");
    }
    return {
      reservationId,
      outcome: PROVIDER_BOOK_OUTCOME.PENDING,
      providerStatus: "booking",
      reason: "no_booking_yet",
    };
  }

  // --------------------------------------------------------------- confirm

  private async confirm(
    reservationId: number,
    result: BookResult,
  ): Promise<ProviderBookResult> {
    const current = await this.reservationRepository.findOne({
      where: { id: reservationId },
    });
    if (!current) {
      return {
        reservationId,
        outcome: PROVIDER_BOOK_OUTCOME.NOOP,
        providerStatus: null,
        reason: "missing",
      };
    }
    if (current.provider_status === "confirmed") {
      return {
        reservationId,
        outcome: PROVIDER_BOOK_OUTCOME.NOOP,
        providerStatus: "confirmed",
        reason: "already_confirmed",
      };
    }
    if (
      current.provider_status !== "booking" &&
      current.provider_status !== "prebooked"
    ) {
      // We already failed (authorization voided) but the provider booked.
      await this.alertAdmin(
        current,
        `La reserva ${result.bookingId} está CONFIRMADA en el proveedor pero en V4P figura como ${current.provider_status ?? "?"} (pago anulado). Cancélala en el proveedor o cobra al viajero.`,
      );
      return {
        reservationId,
        outcome: PROVIDER_BOOK_OUTCOME.NOOP,
        providerStatus: current.provider_status ?? null,
        reason: "confirmed_after_failure",
      };
    }

    const paymentIntentId = String(current.stripe_payment_intent_id ?? "");
    let captureError: string | null = null;
    try {
      await this.stripeService.capturePaymentIntent({
        reservationId,
        paymentIntentId,
      });
    } catch (error) {
      captureError = errorMessage(error);
      this.logger.error(
        `Capture failed for provider reservation ${reservationId} (${paymentIntentId}): ${captureError}`,
      );
    }

    const saved = await this.reservationRepository.manager.transaction(
      async manager => {
        const repository = manager.getRepository(ReservationEntity);
        const reservation = await repository.findOne({
          where: { id: reservationId },
          lock: { mode: "pessimistic_write" },
        });
        if (!reservation || reservation.provider_status === "confirmed") {
          return null;
        }
        const record = readBookingRecord(reservation.provider_booking_json);
        const now = new Date();
        reservation.provider_status = "confirmed";
        reservation.external_reservation_id = result.bookingId;
        if (record) {
          reservation.provider_booking_json = {
            ...record,
            hotel_confirmation_code: result.hotelConfirmationCode,
            booking: result.raw,
          } satisfies ProviderBookingRecord;
        }
        if (captureError === null) {
          reservation.status = "confirmed";
          reservation.payment_status = "paid";
          reservation.paid_at = now;
          // payout_status stays NULL: no host payout for provider stays.
        }
        await repository.save(reservation);
        if (captureError === null) {
          await this.economics.recordPaymentSucceeded(
            manager,
            reservation,
            reservation.stripe_checkout_session_id ?? null,
            paymentIntentId,
            reservation.total_cents ?? 0,
            SYSTEM_ACTOR,
          );
        }
        await this.economics.auditReservationChange(
          manager,
          reservation.id,
          "reservation.provider_confirmed",
          SYSTEM_ACTOR,
          { status: current.status, provider_status: current.provider_status },
          {
            status: reservation.status,
            payment_status: reservation.payment_status,
            provider_status: "confirmed",
            external_reservation_id: result.bookingId,
          },
          { capture_error: captureError },
        );
        await this.eventService.logEventInTransaction(
          manager,
          reservation.id,
          captureError === null
            ? "provider_booking_confirmed"
            : "provider_capture_failed",
          {
            booking_id: result.bookingId,
            hotel_confirmation_code: result.hotelConfirmationCode,
            ...(captureError === null ? {} : { error: captureError }),
          },
        );
        return reservation;
      },
    );

    if (!saved) {
      return {
        reservationId,
        outcome: PROVIDER_BOOK_OUTCOME.NOOP,
        providerStatus: "confirmed",
        reason: "already_confirmed",
      };
    }

    await (captureError === null
      ? this.sendConfirmedEmail(saved, result)
      : this.alertAdmin(
          saved,
          `Reserva confirmada en el proveedor (${result.bookingId}) pero no se pudo capturar el pago ${paymentIntentId}: ${captureError}`,
        ));
    return {
      reservationId,
      outcome: PROVIDER_BOOK_OUTCOME.CONFIRMED,
      providerStatus: "confirmed",
      ...(captureError === null ? {} : { reason: "capture_failed" }),
    };
  }

  // ------------------------------------------------------------------ fail

  private async fail(
    reservationId: number,
    reason: ProviderFailureReason,
    message: string | null,
  ): Promise<ProviderBookResult> {
    const current = await this.reservationRepository.findOne({
      where: { id: reservationId },
    });
    if (!current || current.provider_status === "confirmed") {
      return {
        reservationId,
        outcome: PROVIDER_BOOK_OUTCOME.NOOP,
        providerStatus: current?.provider_status ?? null,
        reason: "already_confirmed",
      };
    }
    if (current.provider_status === "failed") {
      return {
        reservationId,
        outcome: PROVIDER_BOOK_OUTCOME.NOOP,
        providerStatus: "failed",
        reason: "already_failed",
      };
    }

    const paymentIntentId = current.stripe_payment_intent_id ?? null;
    let voidError: string | null = null;
    if (paymentIntentId) {
      try {
        await this.stripeService.cancelPaymentIntent({
          reservationId,
          paymentIntentId,
        });
      } catch (error) {
        voidError = errorMessage(error);
        this.logger.error(
          `Void failed for provider reservation ${reservationId} (${paymentIntentId}): ${voidError}`,
        );
      }
    }

    const saved = await this.reservationRepository.manager.transaction(
      async manager => {
        const repository = manager.getRepository(ReservationEntity);
        const reservation = await repository.findOne({
          where: { id: reservationId },
          lock: { mode: "pessimistic_write" },
        });
        if (
          !reservation ||
          reservation.provider_status === "confirmed" ||
          reservation.provider_status === "failed"
        ) {
          return null;
        }
        const now = new Date();
        const before = {
          status: reservation.status,
          provider_status: reservation.provider_status,
        };
        const record = readBookingRecord(reservation.provider_booking_json);
        reservation.provider_status = "failed";
        if (reservation.status !== "cancelled") {
          reservation.status = "cancelled";
          reservation.cancelled_at = now;
          reservation.cancel_reason = `provider_${reason}`;
        }
        if (record) {
          reservation.provider_booking_json = {
            ...record,
            failure: { reason, message, at: now.toISOString() },
          } satisfies ProviderBookingRecord;
        }
        await repository.save(reservation);
        // payment_status stays 'pending' (nothing was charged).
        await this.economics.recordPaymentFailed(
          manager,
          reservation.id,
          `provider_${reason}`,
          SYSTEM_ACTOR,
          null,
          message,
        );
        await this.economics.auditReservationChange(
          manager,
          reservation.id,
          "reservation.provider_failed",
          SYSTEM_ACTOR,
          before,
          { status: reservation.status, provider_status: "failed" },
          { reason, message, void_error: voidError },
        );
        await this.eventService.logEventInTransaction(
          manager,
          reservation.id,
          "provider_booking_failed",
          { reason, message, void_error: voidError },
        );
        return reservation;
      },
    );

    if (!saved) {
      return {
        reservationId,
        outcome: PROVIDER_BOOK_OUTCOME.NOOP,
        providerStatus: null,
        reason: "state_changed",
      };
    }
    if (voidError !== null) {
      await this.alertAdmin(
        saved,
        `No se pudo anular la autorización ${String(paymentIntentId)} tras fallar la reserva (${reason}): ${voidError}`,
      );
    }
    if (paymentIntentId) {
      await this.sendFailedEmail(saved);
    }
    return {
      reservationId,
      outcome: PROVIDER_BOOK_OUTCOME.FAILED,
      providerStatus: "failed",
      reason,
    };
  }

  // --------------------------------------------------------------- helpers

  private async claimForBooking(reservationId: number): Promise<ClaimResult> {
    return this.reservationRepository.manager.transaction(
      async (manager): Promise<ClaimResult> => {
        const repository = manager.getRepository(ReservationEntity);
        const reservation = await repository.findOne({
          where: { id: reservationId },
          lock: { mode: "pessimistic_write" },
        });
        if (!reservation || reservation.source !== "nuitee") {
          return {
            kind: "noop",
            reason: "not_provider_reservation",
            providerStatus: null,
          };
        }
        if (reservation.provider_status !== "prebooked") {
          return {
            kind: "noop",
            reason: "already_handled",
            providerStatus: reservation.provider_status ?? null,
          };
        }
        if (!reservation.stripe_payment_intent_id) {
          return {
            kind: "noop",
            reason: "not_authorized",
            providerStatus: "prebooked",
          };
        }
        if (reservation.status !== "pending") {
          return {
            kind: "fail",
            reason: PROVIDER_FAILURE_REASON.RESERVATION_NOT_PENDING,
          };
        }
        const record = readBookingRecord(reservation.provider_booking_json);
        const offer = await manager.getRepository(ProviderOfferEntity).findOne({
          where: { reservation_id: reservation.id },
          order: { id: "DESC" },
        });
        if (!record || !offer) {
          return { kind: "fail", reason: PROVIDER_FAILURE_REASON.UNAVAILABLE };
        }
        const startedRecord: ProviderBookingRecord = {
          ...record,
          booking_started_at: new Date().toISOString(),
        };
        reservation.provider_status = "booking";
        reservation.provider_booking_json = startedRecord;
        await repository.save(reservation);
        await this.eventService.logEventInTransaction(
          manager,
          reservation.id,
          "provider_booking_started",
          { offer_id: offer.id, prebook_id: offer.prebook_id ?? null },
        );
        return { kind: "proceed", reservation, offer, record: startedRecord };
      },
    );
  }

  /** booking -> prebooked when nothing reached the provider. */
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
      if (reservation?.provider_status !== "booking") {
        return;
      }
      reservation.provider_status = "prebooked";
      await repository.save(reservation);
      await this.eventService.logEventInTransaction(
        manager,
        reservationId,
        "provider_booking_retry_scheduled",
        { message },
      );
    });
  }

  private async refreshOffer(
    offer: ProviderOfferEntity,
    input: { prebookId: string; netCents: number; raw: unknown },
  ): Promise<ProviderOfferEntity> {
    const now = new Date();
    const patch: Partial<ProviderOfferEntity> = {
      prebook_id: input.prebookId,
      prebook_at: now,
      expires_at: new Date(
        now.getTime() + envs.PROVIDER_PREBOOK_TTL_MINUTES * 60_000,
      ),
      // The traveler keeps paying the original sell price.
      net_cents: input.netCents,
      raw_prebook_json: (input.raw ?? null) as object | null,
    };
    await this.offerRepository.update(offer.id, patch);
    return { ...offer, ...patch };
  }

  private async loadSite(siteId: number): Promise<Site> {
    try {
      const site = await this.mysqlService.queryOne<Site>(
        `SELECT * FROM ${envs.DB_PREFIX}sites1 WHERE id = ?`,
        [siteId],
      );
      if (site) {
        return site;
      }
    } catch (error) {
      this.logger.warn(`Site ${siteId} unavailable: ${errorMessage(error)}`);
    }
    return { id: siteId, name: "Alojamiento" } as Site;
  }

  private async sendConfirmedEmail(
    reservation: ReservationEntity,
    result: BookResult,
  ): Promise<void> {
    try {
      const [site, offer, property] = await Promise.all([
        this.loadSite(reservation.site_id),
        this.offerRepository.findOne({
          where: { reservation_id: reservation.id },
          order: { id: "DESC" },
        }),
        this.propertyRepository.findOne({
          where: { site_id: reservation.site_id },
        }),
      ]);
      const record = readBookingRecord(reservation.provider_booking_json);
      const details: ReservationEmailProviderDetails = {
        booking_id: result.bookingId,
        hotel_confirmation_code: result.hotelConfirmationCode,
        room_name: offer?.room_name ?? null,
        board_name: offer?.board_name ?? null,
        taxes_at_property: (offer?.taxes_not_included_json ?? []).map(tax =>
          formatTax(tax),
        ),
        cancellation_text: offer
          ? cancellationText(
              offer.refundable,
              offer.cancellation_json,
              reservation.timezone ?? "Europe/Madrid",
            )
          : null,
        pet_policy_text: petPolicyText(property?.pets_snapshot),
        dog_remarks: record?.remarks ?? null,
      };
      await this.emailService.sendProviderReservationConfirmedEmail(
        reservation,
        site,
        details,
      );
    } catch (error) {
      this.logger.error(
        `Confirmation email failed for provider reservation ${reservation.id}: ${errorMessage(error)}`,
      );
    }
  }

  private async sendFailedEmail(reservation: ReservationEntity): Promise<void> {
    try {
      const record = readBookingRecord(reservation.provider_booking_json);
      const [site, alternatives] = await Promise.all([
        this.loadSite(reservation.site_id),
        this.alternatives.find({
          siteId: reservation.site_id,
          provider: reservation.source,
          checkin: String(reservation.checkin).slice(0, 10),
          checkout: String(reservation.checkout).slice(0, 10),
          adults: record?.adults ?? Math.max(1, reservation.guests),
          childrenAges: record?.children_ages ?? [],
        }),
      ]);
      await this.emailService.sendProviderReservationFailedEmail(
        reservation,
        site,
        { alternatives },
      );
    } catch (error) {
      this.logger.error(
        `Failure email failed for provider reservation ${reservation.id}: ${errorMessage(error)}`,
      );
    }
  }

  private async alertAdmin(
    reservation: ReservationEntity,
    alert: string,
  ): Promise<void> {
    this.logger.error(`Provider reservation ${reservation.id}: ${alert}`);
    try {
      const site = await this.loadSite(reservation.site_id);
      await this.emailService.sendProviderReservationAdminAlert(
        reservation,
        site,
        alert,
      );
    } catch (error) {
      this.logger.error(
        `Admin alert failed for provider reservation ${reservation.id}: ${errorMessage(error)}`,
      );
    }
  }
}

function formatAmount(cents: number | null, currency: string | null): string {
  if (cents === null) {
    return "importe a confirmar";
  }
  const amount = (cents / 100).toLocaleString("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${amount} ${(currency ?? "").toUpperCase()}`.trim();
}

function formatTax(tax: ProviderTax): string {
  return `${tax.description ?? "Tasa"}: ${formatAmount(tax.amountCents, tax.currency)}`;
}

function formatDeadline(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  try {
    return new Intl.DateTimeFormat("es-ES", {
      timeZone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

/** Short Spanish summary of the provider cancellation policy. */
export function cancellationText(
  refundable: boolean,
  policies: readonly ProviderCancellationPolicy[],
  timeZone: string,
): string {
  if (!refundable) {
    return "Tarifa no reembolsable: si cancelas, no se devuelve el importe.";
  }
  const paid = policies
    .filter(policy => policy.amountCents > 0)
    .sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline));
  const first = paid.at(0);
  if (!first) {
    return "Cancelación gratuita.";
  }
  return `Cancelación gratuita hasta el ${formatDeadline(first.deadline, timeZone)} (hora local del alojamiento). Después se aplican gastos de cancelación.`;
}

function stripHtml(value: string): string {
  return value
    .replaceAll(/<[^>]*>/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function petPolicyText(snapshot: unknown): string | null {
  if (typeof snapshot !== "object" || snapshot === null) {
    return null;
  }
  const raw = snapshot as {
    text?: unknown;
    petPolicy?: { text?: unknown } | null;
  };
  const text = raw.petPolicy?.text ?? raw.text;
  if (typeof text !== "string" || text.trim() === "") {
    return null;
  }
  return stripHtml(text).slice(0, 1000);
}
