import type { BookResult } from "../../providers/domain/provider.types";
import type { ParsedProviderWebhook } from "../domain/provider-webhook.util";

import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { PROVIDER_BOOKING_STATUS } from "../../providers/domain/provider.types";
import { ProviderOfferEntity } from "../../providers/entities/provider-offer.entity";
import { AccommodationProviderRegistry } from "../../providers/services/accommodation-provider.registry";
import { ReservationEntity } from "../../reservations/entities/reservation.entity";
import { envs } from "../../shared/configs/envs";
import { readCancellationRecord } from "../domain/provider-cancellation";
import { PROVIDER_CANCELLATION_STATUS } from "../domain/provider-reservation.types";
import {
  checkNuiteeSignature,
  NUITEE_AUTH_HEADER,
  NUITEE_INCIDENT_EVENTS,
  NUITEE_SIGNATURE_HEADER,
  NUITEE_TIMESTAMP_HEADER,
  NUITEE_WEBHOOK_EVENT,
  parseProviderWebhook,
  verifyAuthToken,
  webhookSummary,
} from "../domain/provider-webhook.util";
import {
  PROVIDER_WEBHOOK_STATUS,
  ProviderWebhookEventEntity,
  type ProviderWebhookStatus,
} from "../entities/provider-webhook-event.entity";
import { ProviderBookingService } from "./provider-booking.service";
import { ProviderCancellationService } from "./provider-cancellation.service";
import { ProviderIncidentService } from "./provider-incident.service";
import { ProviderNotifierService } from "./provider-notifier.service";

/** A delivery stuck in `processing` longer than this can be retried. */
const PROCESSING_LEASE_MS = 5 * 60_000;
const PROVIDER = "nuitee";

export interface ProviderWebhookRequest {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

export interface ProviderWebhookResponse {
  received: true;
  duplicate: boolean;
  status: ProviderWebhookStatus;
  action?: string;
}

interface ProcessOutcome {
  status: ProviderWebhookStatus;
  action: string;
  reservationId: number | null;
}

function headerValue(
  headers: ProviderWebhookRequest["headers"],
  name: string,
): string | null {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ignored(action: string, reservationId: number | null = null) {
  return { status: PROVIDER_WEBHOOK_STATUS.IGNORED, action, reservationId };
}

function processed(action: string, reservationId: number) {
  return { status: PROVIDER_WEBHOOK_STATUS.PROCESSED, action, reservationId };
}

/** booking.cancel_error `response.error.message` (or a JSON fallback). */
function cancelErrorMessage(parsed: ParsedProviderWebhook): string {
  const response =
    typeof parsed.response === "object" && parsed.response !== null
      ? (parsed.response as Record<string, unknown>)
      : null;
  const error =
    typeof response?.error === "object" && response.error !== null
      ? (response.error as Record<string, unknown>)
      : null;
  const code =
    typeof error?.code === "string" || typeof error?.code === "number"
      ? String(error.code)
      : null;
  const message = typeof error?.message === "string" ? error.message : null;
  if (code !== null || message !== null) {
    return [code, message].filter(Boolean).join(": ").slice(0, 500);
  }
  return webhookSummary(parsed, 500);
}

/**
 * POST /v1/providers/nuitee/webhook (public route: authenticated here, not
 * by InternalApiKeyGuard).
 *
 * Authentication, before anything is written:
 * 1. NUITEE_WEBHOOK_AUTH_TOKEN set -> `authorization` must equal it (raw or
 *    "Bearer <token>"), else 401.
 * 2. NUITEE_WEBHOOK_SECRET set -> X-Request-Timestamp + X-Request-Signature
 *    must verify (sha512(body + secret + timestamp)), else 401.
 * 3. Neither set -> FAIL CLOSED in production (503 "webhook auth not
 *    configured", so Nuitee keeps retrying until it is configured); outside
 *    production accepted with a warning (local / sandbox testing).
 *
 * Then: dedupe by event_id (lease semantics unchanged), branch on the exact
 * event_name and always re-read the booking (getBooking / listBookings)
 * before acting. Processing errors mark the event failed and propagate
 * (5xx) so Nuitee retries.
 */
@Injectable()
export class ProviderWebhookService {
  private readonly logger = new Logger(ProviderWebhookService.name);

  constructor(
    @InjectRepository(ProviderWebhookEventEntity)
    private readonly eventRepository: Repository<ProviderWebhookEventEntity>,
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    @InjectRepository(ProviderOfferEntity)
    private readonly offerRepository: Repository<ProviderOfferEntity>,
    private readonly registry: AccommodationProviderRegistry,
    private readonly bookingService: ProviderBookingService,
    private readonly cancellationService: ProviderCancellationService,
    private readonly incidents: ProviderIncidentService,
    private readonly notifier: ProviderNotifierService,
  ) {}

  /** Throws 401/503; returns whether a credential was actually verified. */
  authenticate(request: ProviderWebhookRequest, now: Date): boolean {
    const token = envs.NUITEE_WEBHOOK_AUTH_TOKEN?.trim() ?? "";
    const secret = envs.NUITEE_WEBHOOK_SECRET?.trim() ?? "";
    if (token === "" && secret === "") {
      if (envs.NODE_ENV === "production") {
        this.logger.error(
          "Nuitee webhook rejected: NUITEE_WEBHOOK_AUTH_TOKEN (and NUITEE_WEBHOOK_SECRET) not configured",
        );
        throw new ServiceUnavailableException("webhook auth not configured");
      }
      this.logger.warn(
        "NUITEE_WEBHOOK_AUTH_TOKEN is not set: accepting an unauthenticated Nuitee webhook (non-production only)",
      );
      return false;
    }
    if (
      token !== "" &&
      !verifyAuthToken(headerValue(request.headers, NUITEE_AUTH_HEADER), token)
    ) {
      throw new UnauthorizedException("Invalid provider webhook token");
    }
    if (secret !== "") {
      const failure = checkNuiteeSignature({
        rawBody: request.rawBody,
        secret,
        timestamp: headerValue(request.headers, NUITEE_TIMESTAMP_HEADER),
        signature: headerValue(request.headers, NUITEE_SIGNATURE_HEADER),
        maxAgeSeconds: envs.NUITEE_WEBHOOK_MAX_AGE_SECONDS,
        now,
      });
      if (failure) {
        this.logger.warn(`Nuitee webhook signature rejected: ${failure}`);
        throw new UnauthorizedException("Invalid provider webhook signature");
      }
    }
    return true;
  }

  async handle(
    request: ProviderWebhookRequest,
    now: Date = new Date(),
  ): Promise<ProviderWebhookResponse> {
    const verified = this.authenticate(request, now);
    let payload: unknown;
    try {
      payload = JSON.parse(request.rawBody.toString("utf8"));
    } catch {
      throw new BadRequestException("Invalid JSON body");
    }
    const parsed = parseProviderWebhook(payload, request.rawBody);

    const claimed = await this.claimEvent(parsed, payload, verified, now);
    if (!claimed) {
      return {
        received: true,
        duplicate: true,
        status: PROVIDER_WEBHOOK_STATUS.PROCESSED,
      };
    }

    try {
      const { status, action, reservationId } = await this.process(parsed);
      await this.eventRepository.update(claimed.id, {
        status,
        reservation_id: reservationId,
        processed_at: new Date(),
        last_error: null,
      });
      return { received: true, duplicate: false, status, action };
    } catch (error) {
      await this.eventRepository.update(claimed.id, {
        status: PROVIDER_WEBHOOK_STATUS.FAILED,
        last_error: errorMessage(error).slice(0, 2000),
      });
      this.logger.error(
        `Nuitee webhook ${parsed.eventId} (${parsed.eventName}) failed: ${errorMessage(error)}`,
      );
      // 5xx: the provider retries; the failed row is reprocessed then.
      throw error;
    }
  }

  /** Dedupe: returns the row to process, or null for a duplicate. */
  private async claimEvent(
    parsed: ParsedProviderWebhook,
    payload: unknown,
    verified: boolean,
    now: Date,
  ): Promise<ProviderWebhookEventEntity | null> {
    const existing = await this.eventRepository.findOne({
      where: { provider: PROVIDER, event_id: parsed.eventId },
    });
    if (existing) {
      const done =
        existing.status === PROVIDER_WEBHOOK_STATUS.PROCESSED ||
        existing.status === PROVIDER_WEBHOOK_STATUS.IGNORED;
      const leased =
        existing.status === PROVIDER_WEBHOOK_STATUS.PROCESSING &&
        existing.received_at instanceof Date &&
        now.getTime() - existing.received_at.getTime() < PROCESSING_LEASE_MS;
      if (done || leased) {
        return null;
      }
      const patch = {
        status: PROVIDER_WEBHOOK_STATUS.PROCESSING,
        attempts: existing.attempts + 1,
        received_at: now,
      };
      await this.eventRepository.update(existing.id, patch);
      return { ...existing, ...patch };
    }
    try {
      return await this.eventRepository.save(
        this.eventRepository.create({
          provider: PROVIDER,
          event_id: parsed.eventId,
          event_type: parsed.eventName,
          booking_id: parsed.bookingId,
          status: PROVIDER_WEBHOOK_STATUS.PROCESSING,
          signature_verified: verified,
          attempts: 1,
          payload,
          received_at: now,
        }),
      );
    } catch (error) {
      // Concurrent delivery won the unique (provider, event_id) insert.
      this.logger.warn(
        `Nuitee webhook ${parsed.eventId} insert raced: ${errorMessage(error)}`,
      );
      return null;
    }
  }

  // ------------------------------------------------------------ correlation

  /** clientReference -> bookingId -> prebookId (provider_offers). */
  private async findReservation(
    parsed: ParsedProviderWebhook,
  ): Promise<ReservationEntity | null> {
    if (parsed.clientReference) {
      const byReference = await this.reservationRepository.findOne({
        where: { source: PROVIDER, client_reference: parsed.clientReference },
      });
      if (byReference) {
        return byReference;
      }
    }
    if (parsed.bookingId) {
      const byBooking = await this.reservationRepository.findOne({
        where: { source: PROVIDER, external_reservation_id: parsed.bookingId },
      });
      if (byBooking) {
        return byBooking;
      }
    }
    if (parsed.prebookId) {
      const offer = await this.offerRepository.findOne({
        where: { provider: PROVIDER, prebook_id: parsed.prebookId },
        order: { id: "DESC" },
      });
      if (offer?.reservation_id) {
        return this.reservationRepository.findOne({
          where: { id: offer.reservation_id, source: PROVIDER },
        });
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- routing

  private async process(
    parsed: ParsedProviderWebhook,
  ): Promise<ProcessOutcome> {
    if (
      parsed.sandbox &&
      envs.NODE_ENV === "production" &&
      !envs.NUITEE_WEBHOOK_ACCEPT_SANDBOX
    ) {
      return ignored("sandbox");
    }
    const handler = this.handlerFor(parsed.eventName);
    if (!handler) {
      return ignored(`event:${parsed.eventName}`);
    }
    const reservation = await this.findReservation(parsed);
    if (!reservation) {
      this.logger.warn(
        `Nuitee webhook ${parsed.eventId} (${parsed.eventName}): no reservation for clientReference ${parsed.clientReference ?? "?"} / booking ${parsed.bookingId ?? "?"} / prebook ${parsed.prebookId ?? "?"}`,
      );
      return ignored("unknown_reservation");
    }
    return handler(parsed, reservation);
  }

  private handlerFor(
    eventName: string,
  ):
    | ((
        parsed: ParsedProviderWebhook,
        reservation: ReservationEntity,
      ) => Promise<ProcessOutcome>)
    | null {
    switch (eventName) {
      case NUITEE_WEBHOOK_EVENT.BOOK:
      case NUITEE_WEBHOOK_EVENT.BOOK_ERROR: {
        return (parsed, reservation) =>
          this.handleBookOutcome(parsed, reservation);
      }
      case NUITEE_WEBHOOK_EVENT.CANCEL: {
        return (parsed, reservation) => this.handleCancel(parsed, reservation);
      }
      case NUITEE_WEBHOOK_EVENT.CANCEL_ERROR: {
        return (parsed, reservation) =>
          this.handleCancelError(parsed, reservation);
      }
      case NUITEE_WEBHOOK_EVENT.HOTEL_CONFIRMATION_NUMBER: {
        return (parsed, reservation) =>
          this.handleHotelConfirmation(parsed, reservation);
      }
      case NUITEE_WEBHOOK_EVENT.CHECKIN_INSTRUCTION: {
        return (parsed, reservation) =>
          this.handleCheckinInstruction(parsed, reservation);
      }
      default: {
        return NUITEE_INCIDENT_EVENTS.includes(eventName)
          ? (parsed, reservation) => this.handleIncident(parsed, reservation)
          : null;
      }
    }
  }

  // --------------------------------------------------------------- handlers

  /**
   * booking.book / booking.book_error: only while our outcome is open.
   * resolvePending re-reads the provider (listBookings by clientReference)
   * and confirms (capture) or, after the pending timeout, fails (void): a
   * book_error never fails blindly if the provider shows CONFIRMED.
   */
  private async handleBookOutcome(
    parsed: ParsedProviderWebhook,
    reservation: ReservationEntity,
  ): Promise<ProcessOutcome> {
    if (parsed.eventName === NUITEE_WEBHOOK_EVENT.BOOK_ERROR) {
      this.logger.warn(
        `Nuitee booking.book_error for reservation ${reservation.id} (prebook ${parsed.prebookId ?? "?"}): ${String(JSON.stringify(parsed.errorDetail)).slice(0, 500)}`,
      );
    }
    const open =
      reservation.provider_status === "booking" ||
      (reservation.provider_status === "prebooked" &&
        Boolean(reservation.stripe_payment_intent_id));
    if (!open) {
      return ignored(
        `no_action:${reservation.provider_status ?? "null"}`,
        reservation.id,
      );
    }
    const result = await this.bookingService.resolvePending(reservation.id);
    return processed(`resolve_pending:${result.outcome}`, reservation.id);
  }

  /** Confirmed, not cancelled locally, with a provider booking id. */
  private liveBookingId(reservation: ReservationEntity): string | null {
    if (
      reservation.provider_status !== "confirmed" ||
      reservation.status === "cancelled"
    ) {
      return null;
    }
    return reservation.external_reservation_id ?? null;
  }

  private fetchBooking(
    reservation: ReservationEntity,
    bookingId: string,
  ): Promise<BookResult> {
    return this.registry.get(reservation.source).getBooking(bookingId);
  }

  /**
   * booking.cancel: re-read; CANCELLED -> handleProviderCancelled, which
   * completes OUR cancellation when a claim exists (traveler/admin policy)
   * or runs the hotel-cancellation path (100 % refund + incident) when not.
   */
  private async handleCancel(
    parsed: ParsedProviderWebhook,
    reservation: ReservationEntity,
  ): Promise<ProcessOutcome> {
    const bookingId = this.liveBookingId(reservation);
    if (!bookingId) {
      return ignored(
        `no_action:${reservation.provider_status ?? "null"}`,
        reservation.id,
      );
    }
    const booking = await this.fetchBooking(reservation, bookingId);
    if (booking.status !== PROVIDER_BOOKING_STATUS.CANCELLED) {
      return processed(`no_change:${booking.status}`, reservation.id);
    }
    const ours = readCancellationRecord(reservation.provider_booking_json);
    const result = await this.cancellationService.handleProviderCancelled(
      reservation.id,
      booking.rawStatus,
      `webhook:${parsed.eventName}`,
    );
    return processed(
      `${ours ? "cancellation_completed" : "provider_cancelled"}:${result.outcome}`,
      reservation.id,
    );
  }

  /**
   * booking.cancel_error: our pending cancellation was refused. Re-read
   * first (a later success wins); otherwise drop the claim (no refund) and
   * alert V4P.
   */
  private async handleCancelError(
    parsed: ParsedProviderWebhook,
    reservation: ReservationEntity,
  ): Promise<ProcessOutcome> {
    const record = readCancellationRecord(reservation.provider_booking_json);
    const bookingId = this.liveBookingId(reservation);
    if (
      !bookingId ||
      !record ||
      record.status === PROVIDER_CANCELLATION_STATUS.CANCELLED
    ) {
      return ignored("no_pending_cancellation", reservation.id);
    }
    const booking = await this.fetchBooking(reservation, bookingId);
    if (booking.status === PROVIDER_BOOKING_STATUS.CANCELLED) {
      const result = await this.cancellationService.handleProviderCancelled(
        reservation.id,
        booking.rawStatus,
        `webhook:${parsed.eventName}`,
      );
      return processed(
        `cancellation_completed:${result.outcome}`,
        reservation.id,
      );
    }
    const failed = await this.cancellationService.failPendingCancellation(
      reservation.id,
      cancelErrorMessage(parsed),
    );
    return processed(
      failed ? "cancellation_failed" : "no_pending_cancellation",
      reservation.id,
    );
  }

  /** booking.book.hotelConfirmationNumber: store + re-send confirmation. */
  private async handleHotelConfirmation(
    _parsed: ParsedProviderWebhook,
    reservation: ReservationEntity,
  ): Promise<ProcessOutcome> {
    const bookingId = this.liveBookingId(reservation);
    if (!bookingId) {
      return ignored(
        `no_action:${reservation.provider_status ?? "null"}`,
        reservation.id,
      );
    }
    const booking = await this.fetchBooking(reservation, bookingId);
    const changed = await this.bookingService.updateHotelConfirmation(
      reservation.id,
      booking,
    );
    return processed(
      changed ? "hotel_confirmation_updated" : "hotel_confirmation_unchanged",
      reservation.id,
    );
  }

  /** booking.checkinInstruction: stored raw for later use (no email yet). */
  private async handleCheckinInstruction(
    parsed: ParsedProviderWebhook,
    reservation: ReservationEntity,
  ): Promise<ProcessOutcome> {
    const instructions = parsed.response ?? parsed.request;
    await this.reservationRepository.manager.transaction(async manager => {
      const repository = manager.getRepository(ReservationEntity);
      const locked = await repository.findOne({
        where: { id: reservation.id },
        lock: { mode: "pessimistic_write" },
      });
      if (!locked) {
        return;
      }
      const base =
        typeof locked.provider_booking_json === "object" &&
        locked.provider_booking_json !== null &&
        !Array.isArray(locked.provider_booking_json)
          ? (locked.provider_booking_json as Record<string, unknown>)
          : {};
      locked.provider_booking_json = {
        ...base,
        checkin_instructions: instructions,
      };
      await repository.save(locked);
    });
    this.logger.log(
      `Nuitee check-in instructions stored for reservation ${reservation.id}`,
    );
    return processed("checkin_instructions_stored", reservation.id);
  }

  /**
   * Amendment / relocation / refund / compensation / rebook: V4P handles
   * them by hand. One incident per delivery (event_id in the key) + alert.
   * No money movement here.
   */
  private async handleIncident(
    parsed: ParsedProviderWebhook,
    reservation: ReservationEntity,
  ): Promise<ProcessOutcome> {
    const summary = webhookSummary(parsed);
    const incident = await this.incidents.openOnce({
      reservationId: reservation.id,
      userId: reservation.user_id,
      key: `webhook:${parsed.eventName}:${parsed.eventId}`,
      description: `Nuitee envió ${parsed.eventName} para la reserva ${String(reservation.external_reservation_id ?? reservation.id)}. Revisar en Nuitee; V4P no ha movido dinero. Datos: ${summary}`,
    });
    if (incident) {
      await this.notifier.alertAdmin(
        reservation,
        `Webhook Nuitee ${parsed.eventName}: incidencia abierta, requiere revisión manual (sin movimientos de dinero). Datos: ${summary}`,
      );
    }
    return processed(
      incident ? "incident_opened" : "incident_exists",
      reservation.id,
    );
  }
}
