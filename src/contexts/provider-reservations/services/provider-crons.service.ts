import type { HotelSyncSummary } from "./provider-hotel-sync.service";
import type { ReconcileSummary } from "./provider-reconciliation.service";

import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Not, Repository } from "typeorm";

import { ReservationEntity } from "../../reservations/entities/reservation.entity";
import { envs } from "../../shared/configs/envs";
import { PROVIDER_CANCELLATION_STATUS } from "../domain/provider-reservation.types";
import { ProviderBookingService } from "./provider-booking.service";
import { ProviderCancellationService } from "./provider-cancellation.service";
import { ProviderHotelSyncService } from "./provider-hotel-sync.service";
import { ProviderReconciliationService } from "./provider-reconciliation.service";

const PENDING_BATCH = 50;

export const PROVIDER_CRON_JOB = {
  PENDING: "pending",
  RECONCILE: "reconcile",
  HOTEL_SYNC: "hotel_sync",
} as const;

export type ProviderCronJob =
  (typeof PROVIDER_CRON_JOB)[keyof typeof PROVIDER_CRON_JOB];

export interface PendingRunSummary {
  bookings: number;
  cancellations: number;
  errors: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Phase 5 crons for provider reservations. Each job has an in-process
 * "running" flag so a slow run is never overlapped by the next tick (single
 * instance; PROVIDER_CRONS_ENABLED=false turns them off elsewhere).
 */
@Injectable()
export class ProviderCronsService {
  private readonly logger = new Logger(ProviderCronsService.name);
  private readonly running = new Set<ProviderCronJob>();

  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    private readonly bookingService: ProviderBookingService,
    private readonly cancellationService: ProviderCancellationService,
    private readonly reconciliation: ProviderReconciliationService,
    private readonly hotelSync: ProviderHotelSyncService,
  ) {}

  /** Runs `task` unless disabled or the same job is still running. */
  async guarded<T>(
    job: ProviderCronJob,
    task: () => Promise<T>,
  ): Promise<T | null> {
    if (!envs.PROVIDER_CRONS_ENABLED) {
      return null;
    }
    if (this.running.has(job)) {
      this.logger.warn(`Provider cron ${job} still running; tick skipped`);
      return null;
    }
    this.running.add(job);
    try {
      return await task();
    } catch (error) {
      this.logger.error(`Provider cron ${job} failed: ${errorMessage(error)}`);
      return null;
    } finally {
      this.running.delete(job);
    }
  }

  @Cron("*/5 * * * *")
  processPendingCron(): Promise<PendingRunSummary | null> {
    return this.guarded(PROVIDER_CRON_JOB.PENDING, () => this.processPending());
  }

  @Cron("30 4 * * *")
  reconcileCron(): Promise<ReconcileSummary | null> {
    return this.guarded(PROVIDER_CRON_JOB.RECONCILE, () =>
      this.reconciliation.run(),
    );
  }

  @Cron("0 5 * * 1")
  hotelSyncCron(): Promise<HotelSyncSummary | null> {
    return this.guarded(PROVIDER_CRON_JOB.HOTEL_SYNC, () =>
      this.hotelSync.run(),
    );
  }

  /** Bookings with an unknown outcome (booking, or prebooked + authorized). */
  findPendingBookings(): Promise<ReservationEntity[]> {
    return this.reservationRepository.find({
      select: { id: true },
      where: [
        { source: "nuitee", provider_status: "booking" },
        {
          source: "nuitee",
          provider_status: "prebooked",
          stripe_payment_intent_id: Not(IsNull()),
        },
      ],
      order: { id: "ASC" },
      take: PENDING_BATCH,
    });
  }

  /** Confirmed bookings whose V4P cancellation is requested/pending. */
  findPendingCancellations(): Promise<ReservationEntity[]> {
    return this.reservationRepository
      .createQueryBuilder("r")
      .select(["r.id"])
      .where("r.source = :source", { source: "nuitee" })
      .andWhere("r.provider_status = :providerStatus", {
        providerStatus: "confirmed",
      })
      .andWhere(
        "JSON_UNQUOTE(JSON_EXTRACT(r.provider_booking_json, '$.cancellation.status')) IN (:...cancellationStatuses)",
        {
          cancellationStatuses: [
            PROVIDER_CANCELLATION_STATUS.REQUESTED,
            PROVIDER_CANCELLATION_STATUS.PENDING,
          ],
        },
      )
      .orderBy("r.id", "ASC")
      .take(PENDING_BATCH)
      .getMany();
  }

  async processPending(now: Date = new Date()): Promise<PendingRunSummary> {
    const summary: PendingRunSummary = {
      bookings: 0,
      cancellations: 0,
      errors: 0,
    };
    for (const row of await this.findPendingBookings()) {
      try {
        await this.bookingService.resolvePending(row.id, now);
        summary.bookings += 1;
      } catch (error) {
        summary.errors += 1;
        this.logger.error(
          `resolvePending(${row.id}) failed: ${errorMessage(error)}`,
        );
      }
    }
    for (const row of await this.findPendingCancellations()) {
      try {
        await this.cancellationService.resolvePendingCancellation(row.id, now);
        summary.cancellations += 1;
      } catch (error) {
        summary.errors += 1;
        this.logger.error(
          `resolvePendingCancellation(${row.id}) failed: ${errorMessage(error)}`,
        );
      }
    }
    return summary;
  }
}
