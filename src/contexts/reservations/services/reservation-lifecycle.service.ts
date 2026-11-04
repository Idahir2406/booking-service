import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";

import { actors } from "../../payments/domain/audit-actor";
import { ReservationEconomicsService } from "../../payments/services/reservation-economics.service";
import { envs } from "../../shared/configs/envs";
import { CancelReservationDto } from "../dto/cancel-reservation.dto";
import { ReservationEntity } from "../entities/reservation.entity";
import {
  computeReservationPolicyCapabilities,
  getCheckinStartUtc,
  getCheckoutStartUtc,
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

  async finalizeReservation(id: number, siteId?: number) {
    const outcome = await this.reservationRepository.manager.transaction(
      async (manager): Promise<FinalizeOutcome> => {
        const reservation = await this.lockReservation(manager, id);
        this.assertHostAccess(reservation, siteId);

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

        const now = new Date();
        const policy = computeReservationPolicyCapabilities(reservation, now);
        if (!policy.can_finalize) {
          const checkinStart = getCheckinStartUtc(reservation.checkin);
          if (now.getTime() < checkinStart.getTime()) {
            throw new BadRequestException(
              "Cannot finalize before check-in date",
            );
          }
          throw new BadRequestException(
            "Cannot finalize reservation in its current state",
          );
        }

        const deadline = new Date(
          now.getTime() + envs.FEEDBACK_PAYOUT_DELAY_HOURS * 60 * 60 * 1000,
        );

        const actor = actors.host(siteId);
        reservation.status = "finalized";
        reservation.finalized_at = now;
        reservation.feedback_deadline_at = deadline;
        if (!reservation.payout_status) {
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
          { feedback_deadline_at: deadline.toISOString() },
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
