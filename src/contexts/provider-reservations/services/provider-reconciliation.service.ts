import type { BookResult } from "../../providers/domain/provider.types";

import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, IsNull, MoreThanOrEqual, Not, Repository } from "typeorm";

import { ProviderNotFoundError } from "../../providers/domain/provider.errors";
import { PROVIDER_BOOKING_STATUS } from "../../providers/domain/provider.types";
import { ProviderOfferEntity } from "../../providers/entities/provider-offer.entity";
import { AccommodationProviderRegistry } from "../../providers/services/accommodation-provider.registry";
import { ReservationEntity } from "../../reservations/entities/reservation.entity";
import { readCancellationRecord } from "../domain/provider-cancellation";
import { PROVIDER_CANCELLATION_STATUS } from "../domain/provider-reservation.types";
import { ProviderCancellationService } from "./provider-cancellation.service";
import { ProviderIncidentService } from "./provider-incident.service";
import { ProviderNotifierService } from "./provider-notifier.service";

const RECONCILE_BATCH = 500;
const RECENTLY_UPDATED_DAYS = 30;
const DAY_MS = 24 * 60 * 60_000;

export const RECONCILE_MISMATCH = {
  CANCELLED_AT_PROVIDER: "cancelled_at_provider",
  CONFIRMED_AT_PROVIDER: "confirmed_at_provider",
  NOT_FOUND_AT_PROVIDER: "not_found_at_provider",
  AMOUNT: "amount",
} as const;

export type ReconcileMismatch =
  (typeof RECONCILE_MISMATCH)[keyof typeof RECONCILE_MISMATCH];

export interface ReconcileSummary {
  checked: number;
  mismatches: number;
  incidentsOpened: number;
  autoCancelled: number;
  errors: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Daily reconciliation of provider reservations against the provider
 * (getBooking by external_reservation_id). Scope: confirmed/cancelled rows
 * with checkin >= yesterday or updated in the last 30 days.
 * - provider CANCELLED + V4P confirmed before the stay: hotel cancellation the
 *   webhook missed -> same path (full refund + incident + emails);
 * - any other status/amount difference -> incident (deduped by key, so the
 *   same mismatch is not re-created daily) + admin alert.
 */
@Injectable()
export class ProviderReconciliationService {
  private readonly logger = new Logger(ProviderReconciliationService.name);

  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    @InjectRepository(ProviderOfferEntity)
    private readonly offerRepository: Repository<ProviderOfferEntity>,
    private readonly registry: AccommodationProviderRegistry,
    private readonly cancellationService: ProviderCancellationService,
    private readonly incidents: ProviderIncidentService,
    private readonly notifier: ProviderNotifierService,
  ) {}

  findCandidates(now: Date): Promise<ReservationEntity[]> {
    const base = {
      source: "nuitee" as const,
      provider_status: In(["confirmed", "cancelled"]),
      external_reservation_id: Not(IsNull()),
    };
    return this.reservationRepository.find({
      where: [
        {
          ...base,
          checkin: MoreThanOrEqual(isoDate(new Date(now.getTime() - DAY_MS))),
        },
        {
          ...base,
          updated_at: MoreThanOrEqual(
            new Date(now.getTime() - RECENTLY_UPDATED_DAYS * DAY_MS),
          ),
        },
      ],
      order: { id: "ASC" },
      take: RECONCILE_BATCH,
    });
  }

  async run(now: Date = new Date()): Promise<ReconcileSummary> {
    const summary: ReconcileSummary = {
      checked: 0,
      mismatches: 0,
      incidentsOpened: 0,
      autoCancelled: 0,
      errors: 0,
    };
    const candidates = await this.findCandidates(now);
    for (const reservation of candidates) {
      try {
        await this.reconcileOne(reservation, now, summary);
      } catch (error) {
        summary.errors += 1;
        this.logger.error(
          `Reconciliation of provider reservation ${reservation.id} failed: ${errorMessage(error)}`,
        );
      }
    }
    this.logger.log(
      `Provider reconciliation: ${summary.checked} checked, ${summary.mismatches} mismatches, ${summary.incidentsOpened} incidents, ${summary.autoCancelled} auto-cancelled, ${summary.errors} errors`,
    );
    return summary;
  }

  private async reconcileOne(
    reservation: ReservationEntity,
    now: Date,
    summary: ReconcileSummary,
  ): Promise<void> {
    const record = readCancellationRecord(reservation.provider_booking_json);
    if (record && record.status !== PROVIDER_CANCELLATION_STATUS.CANCELLED) {
      // Our own cancellation in flight: the 5-min cron owns it.
      return;
    }
    summary.checked += 1;
    const v4pLive = reservation.provider_status === "confirmed";
    let booking: BookResult;
    try {
      booking = await this.registry
        .get(reservation.source)
        .getBooking(String(reservation.external_reservation_id));
    } catch (error) {
      if (error instanceof ProviderNotFoundError && v4pLive) {
        await this.reportMismatch(
          reservation,
          RECONCILE_MISMATCH.NOT_FOUND_AT_PROVIDER,
          `La reserva ${String(reservation.external_reservation_id)} no existe en el proveedor pero en V4P está confirmada.`,
          summary,
        );
        return;
      }
      throw error;
    }

    if (booking.status === PROVIDER_BOOKING_STATUS.PENDING_UNKNOWN) {
      return;
    }
    if (booking.status === PROVIDER_BOOKING_STATUS.CANCELLED && v4pLive) {
      const beforeStay =
        reservation.status === "confirmed" &&
        String(reservation.checkin).slice(0, 10) > isoDate(now);
      if (beforeStay) {
        const result = await this.cancellationService.handleProviderCancelled(
          reservation.id,
          booking.rawStatus,
          "reconciliation",
        );
        summary.mismatches += 1;
        if (result.outcome === "cancelled") {
          summary.autoCancelled += 1;
        }
        return;
      }
      await this.reportMismatch(
        reservation,
        RECONCILE_MISMATCH.CANCELLED_AT_PROVIDER,
        `El proveedor marca la reserva ${booking.bookingId} como ${booking.rawStatus ?? "CANCELLED"} pero en V4P sigue ${reservation.status} (estancia iniciada o finalizada). Revisar reembolso.`,
        summary,
      );
      return;
    }
    if (booking.status === PROVIDER_BOOKING_STATUS.CONFIRMED && !v4pLive) {
      await this.reportMismatch(
        reservation,
        RECONCILE_MISMATCH.CONFIRMED_AT_PROVIDER,
        `La reserva ${booking.bookingId} sigue CONFIRMADA en el proveedor pero en V4P está cancelada. Cancélala en Nuitee para no pagarla.`,
        summary,
      );
      return;
    }
    if (booking.status === PROVIDER_BOOKING_STATUS.CONFIRMED && v4pLive) {
      await this.compareAmount(reservation, booking, summary);
    }
  }

  private async compareAmount(
    reservation: ReservationEntity,
    booking: BookResult,
    summary: ReconcileSummary,
  ): Promise<void> {
    if (booking.totalCents === null) {
      return;
    }
    const offer = await this.offerRepository.findOne({
      where: { reservation_id: reservation.id },
      order: { id: "DESC" },
    });
    if (!offer) {
      return;
    }
    const sameCurrency =
      !booking.currency ||
      booking.currency.toUpperCase() === offer.currency.toUpperCase();
    if (sameCurrency && booking.totalCents === offer.net_cents) {
      return;
    }
    await this.reportMismatch(
      reservation,
      `${RECONCILE_MISMATCH.AMOUNT}:${booking.totalCents}${booking.currency ?? ""}`,
      `Importe distinto: proveedor ${(booking.totalCents / 100).toFixed(2)} ${booking.currency ?? ""} frente a neto V4P ${(offer.net_cents / 100).toFixed(2)} ${offer.currency}.`,
      summary,
    );
  }

  private async reportMismatch(
    reservation: ReservationEntity,
    key: string,
    description: string,
    summary: ReconcileSummary,
  ): Promise<void> {
    summary.mismatches += 1;
    const incident = await this.incidents.openOnce({
      reservationId: reservation.id,
      userId: reservation.user_id,
      key: `reconcile:${key}`,
      description,
    });
    if (!incident) {
      return;
    }
    summary.incidentsOpened += 1;
    await this.notifier.alertAdmin(
      reservation,
      `Conciliación con el proveedor: ${description} (incidencia #${incident.id}).`,
    );
  }
}
