import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, In, LessThanOrEqual, Not, Repository } from "typeorm";

import { type Actor, actors } from "../../payments/domain/audit-actor";
import { ReservationEconomicsService } from "../../payments/services/reservation-economics.service";
import { envs } from "../../shared/configs/envs";
import { CancelReservationDto } from "../dto/cancel-reservation.dto";
import { ReservationEntity } from "../entities/reservation.entity";
import { ReservationIncidentEntity } from "../entities/reservation-incident.entity";
import { isProviderReservation } from "../utils/provider-reservation.util";
import {
  AUTO_FINALIZE_AFTER_HOURS,
  computeReservationPolicyCapabilities,
  getAutoFinalizeAtUtc,
} from "../utils/reservation-policy.util";
import { ReservationService } from "./reservation.service";
import { ReservationEmailService } from "./reservation-email.service";
import { ReservationEventService } from "./reservation-event.service";
import { ReservationFeedbackService } from "./reservation-feedback.service";
import { ReservationPayoutService } from "./reservation-payout.service";

interface FinalizeOutcome {
  reservation: ReservationEntity;
  changed: boolean;
  feedbackToken?: string;
  deadline?: Date;
}

/**
 * Host actions (internal routes behind InternalApiKeyGuard, reached via the
 * PHP host proxy). Every money-moving path locks the reservation row
 * (SELECT ... FOR UPDATE) for the whole transaction; emails go out only
 * after commit (F0).
 */
@Injectable()
export class ReservationLifecycleService {
  private readonly logger = new Logger(ReservationLifecycleService.name);

  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    private readonly reservationService: ReservationService,
    private readonly payoutService: ReservationPayoutService,
    private readonly feedbackService: ReservationFeedbackService,
    private readonly reservationEmailService: ReservationEmailService,
    private readonly reservationEventService: ReservationEventService,
    private readonly economics: ReservationEconomicsService,
  ) {}

  private assertHostAccess(
    reservation: ReservationEntity,
    siteId?: number,
  ): void {
    if (!siteId || siteId !== reservation.site_id) {
      throw new ForbiddenException("Site access denied");
    }
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

  async cancelReservation(_id: number, _dto: CancelReservationDto) {
    throw new BadRequestException(
      "Host unilateral cancellation is disabled; use exceptional refund review or traveler cancellation",
    );
  }

  /** Host action "Finalizar estancia" (from check-out, see reservation-policy.util). */
  async finalizeReservation(id: number, siteId?: number) {
    return this.finalize(id, { siteId });
  }

  /**
   * Auto-finalize: confirmed + paid stays whose check-out passed more than
   * AUTO_FINALIZE_AFTER_HOURS ago and the host did not finalize. Skips
   * blocked payouts and reservations with an open payout-blocking incident
   * (V4P resolves those). Same path as the host action, actor = system.
   */
  @Cron("17 * * * *")
  async processAutoFinalize(now: Date = new Date()): Promise<void> {
    // Coarse DB filter (checkout date + margin); the exact local instant is
    // checked per row with the reservation timezone.
    const cutoff = new Date(
      now.getTime() - AUTO_FINALIZE_AFTER_HOURS * 60 * 60 * 1000,
    );
    // payout_status is NULL until finalize (or held/blocked): filter in JS,
    // `Not("blocked")` would drop the NULL rows in SQL.
    const candidates = await this.reservationRepository.find({
      where: {
        status: "confirmed",
        payment_status: "paid",
        checkout: LessThanOrEqual(cutoff.toISOString().slice(0, 10)),
      },
      order: { checkout: "ASC" },
      take: 200,
    });
    const due = candidates.filter(
      row =>
        row.payout_status !== "blocked" &&
        getAutoFinalizeAtUtc(
          row.checkout,
          row.timezone,
          row.checkout_until,
        ).getTime() <= now.getTime(),
    );
    if (due.length === 0) {
      return;
    }

    const blocking = await this.reservationRepository.manager
      .getRepository(ReservationIncidentEntity)
      .find({
        where: {
          reservation_id: In(due.map(row => row.id)),
          blocks_payout: true,
          status: Not("resolved"),
        },
        select: { reservation_id: true },
      });
    const blocked = new Set(blocking.map(row => row.reservation_id));

    for (const reservation of due) {
      if (blocked.has(reservation.id)) {
        continue;
      }
      try {
        await this.finalize(reservation.id, { system: true, now });
        this.logger.log(`Auto-finalized reservation ${reservation.id}`);
      } catch (error) {
        this.logger.error(
          `Auto-finalize failed for reservation ${reservation.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  private async finalize(
    id: number,
    by: { siteId?: number; system?: boolean; now?: Date },
  ) {
    const outcome = await this.reservationRepository.manager.transaction(
      async (manager): Promise<FinalizeOutcome> => {
        const reservation = await this.lockReservation(manager, id);
        if (!by.system) {
          this.assertHostAccess(reservation, by.siteId);
        }

        if (reservation.status === "finalized") {
          return { reservation, changed: false };
        }

        if (
          reservation.status !== "confirmed" ||
          reservation.payment_status !== "paid"
        ) {
          throw new BadRequestException(
            "Only confirmed and paid reservations can be finalized",
          );
        }

        const now = by.now ?? new Date();
        const policy = computeReservationPolicyCapabilities(reservation, now);
        if (!policy.can_finalize) {
          if (now.getTime() < Date.parse(policy.finalize_available_from)) {
            throw new BadRequestException(
              "Cannot finalize before check-out date",
            );
          }
          throw new BadRequestException(
            "Cannot finalize reservation in its current state",
          );
        }

        const deadline = new Date(
          now.getTime() + envs.FEEDBACK_PAYOUT_DELAY_HOURS * 60 * 60 * 1000,
        );

        const actor: Actor = by.system
          ? actors.system("auto_finalize")
          : actors.host(by.siteId);
        reservation.status = "finalized";
        reservation.finalized_at = now;
        reservation.feedback_deadline_at = deadline;
        // Provider reservations (nuitee) have no host payout: payout_status
        // stays NULL (= not applicable).
        if (!reservation.payout_status && !isProviderReservation(reservation)) {
          await this.economics.transitionPayout(
            manager,
            reservation,
            "held",
            actor,
            { metadata: { trigger: "finalized" } },
          );
        }
        await this.economics.auditReservationChange(
          manager,
          id,
          "reservation.finalized",
          actor,
          { status: "confirmed" },
          {
            status: "finalized",
            feedback_deadline_at: deadline.toISOString(),
          },
        );
        const saved = await manager
          .getRepository(ReservationEntity)
          .save(reservation);

        await this.reservationService.releaseRemainingAvailabilityForReservation(
          saved,
          manager,
        );

        const feedbackToken = await this.feedbackService.createFeedbackToken(
          saved.id,
          deadline,
          manager,
        );
        await this.reservationEventService.logEventInTransaction(
          manager,
          id,
          "finalized",
          {
            feedback_deadline_at: deadline.toISOString(),
            by: by.system ? "system" : "host",
          },
        );

        return { reservation: saved, changed: true, feedbackToken, deadline };
      },
    );

    if (outcome.changed && outcome.feedbackToken) {
      const site = await this.reservationService.getSiteById(
        outcome.reservation.site_id,
      );
      const webBase = (envs.BOOKING_WEB_URL ?? envs.FRONTEND_URL).replace(
        /\/+$/,
        "",
      );
      const feedbackUrl = `${webBase}/reserva-feedback/${outcome.feedbackToken}`;
      await this.reservationEmailService.sendFinalizedEmails(
        outcome.reservation,
        site,
        feedbackUrl,
      );
    }

    return outcome.reservation;
  }
}
