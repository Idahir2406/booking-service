import type { BookResult } from "../../providers/domain/provider.types";
import type { ParsedProviderWebhook } from "../domain/provider-webhook.util";

import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { PROVIDER_BOOKING_STATUS } from "../../providers/domain/provider.types";
import { AccommodationProviderRegistry } from "../../providers/services/accommodation-provider.registry";
import { ReservationEntity } from "../../reservations/entities/reservation.entity";
import { envs } from "../../shared/configs/envs";
import {
  NUITEE_SIGNATURE_HEADERS,
  parseProviderWebhook,
  verifyHmacSignature,
} from "../domain/provider-webhook.util";
import {
  PROVIDER_WEBHOOK_STATUS,
  ProviderWebhookEventEntity,
  type ProviderWebhookStatus,
} from "../entities/provider-webhook-event.entity";
import { ProviderBookingService } from "./provider-booking.service";
import { ProviderCancellationService } from "./provider-cancellation.service";

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

/**
 * POST /v1/providers/nuitee/webhook. Verifies the signature when
 * NUITEE_WEBHOOK_SECRET is set (otherwise accepts with a warning), dedupes
 * by event id and always re-reads the booking (getBooking / listBookings)
 * before acting: payload statuses and amounts are never trusted.
 */
@Injectable()
export class ProviderWebhookService {
  private readonly logger = new Logger(ProviderWebhookService.name);

  constructor(
    @InjectRepository(ProviderWebhookEventEntity)
    private readonly eventRepository: Repository<ProviderWebhookEventEntity>,
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    private readonly registry: AccommodationProviderRegistry,
    private readonly bookingService: ProviderBookingService,
    private readonly cancellationService: ProviderCancellationService,
  ) {}

  verify(request: ProviderWebhookRequest): boolean {
    const secret = envs.NUITEE_WEBHOOK_SECRET?.trim() ?? "";
    if (secret === "") {
      this.logger.warn(
        "NUITEE_WEBHOOK_SECRET is not set: accepting an unsigned Nuitee webhook (the booking is re-read before acting)",
      );
      return false;
    }
    for (const header of NUITEE_SIGNATURE_HEADERS) {
      if (
        verifyHmacSignature(
          request.rawBody,
          headerValue(request.headers, header),
          secret,
        )
      ) {
        return true;
      }
    }
    throw new UnauthorizedException("Invalid provider webhook signature");
  }

  async handle(
    request: ProviderWebhookRequest,
    now: Date = new Date(),
  ): Promise<ProviderWebhookResponse> {
    const verified = this.verify(request);
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
        `Nuitee webhook ${parsed.eventId} (${parsed.eventType}) failed: ${errorMessage(error)}`,
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
          event_type: parsed.eventType,
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

  private async findReservation(
    parsed: ParsedProviderWebhook,
  ): Promise<ReservationEntity | null> {
    if (parsed.bookingId) {
      const byBooking = await this.reservationRepository.findOne({
        where: { source: "nuitee", external_reservation_id: parsed.bookingId },
      });
      if (byBooking) {
        return byBooking;
      }
    }
    if (parsed.clientReference) {
      return this.reservationRepository.findOne({
        where: { source: "nuitee", client_reference: parsed.clientReference },
      });
    }
    return null;
  }

  private async process(parsed: ParsedProviderWebhook): Promise<{
    status: ProviderWebhookStatus;
    action: string;
    reservationId: number | null;
  }> {
    const reservation = await this.findReservation(parsed);
    if (!reservation) {
      this.logger.warn(
        `Nuitee webhook ${parsed.eventId} (${parsed.eventType}): no reservation for booking ${parsed.bookingId ?? "?"} / ${parsed.clientReference ?? "?"}`,
      );
      return {
        status: PROVIDER_WEBHOOK_STATUS.IGNORED,
        action: "unknown_reservation",
        reservationId: null,
      };
    }
    const reservationId = reservation.id;

    // Booking outcome still open on our side: the booking service re-reads
    // by clientReference and confirms (capture) or fails (void).
    if (
      reservation.provider_status === "booking" ||
      (reservation.provider_status === "prebooked" &&
        reservation.stripe_payment_intent_id)
    ) {
      const result = await this.bookingService.resolvePending(reservationId);
      return {
        status: PROVIDER_WEBHOOK_STATUS.PROCESSED,
        action: `resolve_pending:${result.outcome}`,
        reservationId,
      };
    }

    if (
      reservation.provider_status !== "confirmed" ||
      reservation.status === "cancelled"
    ) {
      return {
        status: PROVIDER_WEBHOOK_STATUS.IGNORED,
        action: `no_action:${reservation.provider_status ?? "null"}`,
        reservationId,
      };
    }

    const bookingId =
      reservation.external_reservation_id ?? parsed.bookingId ?? null;
    if (!bookingId) {
      return {
        status: PROVIDER_WEBHOOK_STATUS.IGNORED,
        action: "no_booking_id",
        reservationId,
      };
    }
    const booking: BookResult = await this.registry
      .get(reservation.source)
      .getBooking(bookingId);
    if (booking.status === PROVIDER_BOOKING_STATUS.CANCELLED) {
      const result = await this.cancellationService.handleProviderCancelled(
        reservationId,
        booking.rawStatus,
        `webhook:${parsed.eventType}`,
      );
      return {
        status: PROVIDER_WEBHOOK_STATUS.PROCESSED,
        action: `provider_cancelled:${result.outcome}`,
        reservationId,
      };
    }
    // CONFIRMED / PENDING_UNKNOWN: nothing to change; amount or detail
    // differences are reported by the daily reconciliation.
    return {
      status: PROVIDER_WEBHOOK_STATUS.PROCESSED,
      action: `no_change:${booking.status}`,
      reservationId,
    };
  }
}
