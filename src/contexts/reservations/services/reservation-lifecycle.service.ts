import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { envs } from "../../shared/configs/envs";
import { CancelReservationDto } from "../dto/cancel-reservation.dto";
import {
  PaymentStatusValue,
  PayoutStatusValue,
  ReservationEntity,
  StatusValue,
} from "../entities/reservation.entity";
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
  ) {}

  private assertHostAccess(
    reservation: ReservationEntity,
    siteId?: number,
  ): void {
    if (!siteId || siteId !== reservation.site_id) {
      throw new ForbiddenException("Site access denied");
    }
  }

  async cancelReservation(id: number, dto: CancelReservationDto) {
    const reservation = await this.reservationRepository.findOne({
      where: { id },
    });
    if (!reservation) {
      throw new NotFoundException(`Reservation with id ${id} not found`);
    }

    this.assertHostAccess(reservation, dto.site_id);

    if (reservation.payout_status === "blocked") {
      throw new BadRequestException(
        "Cannot cancel reservation with blocked payout pending dispute resolution",
      );
    }

    if (reservation.status === "cancelled") {
      return reservation;
    }

    if (reservation.payout_status === "released" && dto.refund) {
      throw new BadRequestException(
        "Cannot refund: host payout already released",
      );
    }

    const now = new Date();
    const policy = computeReservationPolicyCapabilities(reservation, now);
    let refundProcessed = false;

    if (reservation.status === "pending") {
      const updated = await this.reservationRepository.preload({
        id,
        status: "cancelled" as StatusValue,
        cancelled_at: now,
        cancel_reason: dto.reason,
        refund_on_cancel: false,
      });
      if (!updated) {
        throw new NotFoundException(`Reservation with id ${id} not found`);
      }
      const saved = await this.reservationRepository.save(updated);
      await this.reservationService.releaseAvailabilityForReservation(saved);
      const site = await this.reservationService.getSiteById(saved.site_id);
      await this.reservationEmailService.sendCancelledEmails(
        saved,
        site,
        false,
      );
      await this.reservationEventService.logEvent(id, "cancelled", {
        refund: false,
        reason: dto.reason,
      });
      return saved;
    }

    if (reservation.status === "confirmed") {
      if (!policy.can_cancel) {
        const checkoutStart = getCheckoutStartUtc(reservation.checkout);
        if (now.getTime() >= checkoutStart.getTime()) {
          throw new BadRequestException(
            "Cannot cancel after checkout; please finalize the stay",
          );
        }
        throw new BadRequestException(
          `Cannot cancel reservation in status ${reservation.status}`,
        );
      }

      if (dto.refund) {
        if (!policy.can_refund) {
          throw new BadRequestException(
            "Refund is not allowed: less than 24 hours before check-in or payout already released",
          );
        }
        if (reservation.payment_status !== "paid") {
          throw new BadRequestException(
            "Cannot refund: reservation is not paid",
          );
        }
        await this.payoutService.refundReservation(id);
        refundProcessed = true;
      }

      const updated = await this.reservationRepository.preload({
        id,
        status: "cancelled" as StatusValue,
        cancelled_at: now,
        cancel_reason: dto.reason,
        refund_on_cancel: dto.refund,
        payment_status: refundProcessed
          ? ("refunded" as PaymentStatusValue)
          : reservation.payment_status,
        payout_status: refundProcessed
          ? reservation.payout_status
          : reservation.payout_status,
      });
      if (!updated) {
        throw new NotFoundException(`Reservation with id ${id} not found`);
      }
      const saved = await this.reservationRepository.save(updated);
      await this.reservationService.releaseAvailabilityForReservation(saved);
      const site = await this.reservationService.getSiteById(saved.site_id);
      await this.reservationEmailService.sendCancelledEmails(
        saved,
        site,
        refundProcessed,
      );
      await this.reservationEventService.logEvent(id, "cancelled", {
        refund: dto.refund,
        reason: dto.reason,
      });
      return saved;
    }

    throw new BadRequestException(
      `Cannot cancel reservation in status ${reservation.status}`,
    );
  }

  async finalizeReservation(id: number, siteId?: number) {
    const reservation = await this.reservationRepository.findOne({
      where: { id },
    });
    if (!reservation) {
      throw new NotFoundException(`Reservation with id ${id} not found`);
    }

    this.assertHostAccess(reservation, siteId);

    if (reservation.status === "finalized") {
      return reservation;
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
        throw new BadRequestException("Cannot finalize before check-in date");
      }
      throw new BadRequestException(
        "Cannot finalize reservation in its current state",
      );
    }

    const deadline = new Date(
      now.getTime() + envs.FEEDBACK_PAYOUT_DELAY_HOURS * 60 * 60 * 1000,
    );

    const updated = await this.reservationRepository.preload({
      id,
      status: "finalized" as StatusValue,
      finalized_at: now,
      feedback_deadline_at: deadline,
      payout_status: reservation.payout_status ?? ("held" as PayoutStatusValue),
    });
    if (!updated) {
      throw new NotFoundException(`Reservation with id ${id} not found`);
    }
    const saved = await this.reservationRepository.save(updated);

    await this.reservationService.releaseRemainingAvailabilityForReservation(
      saved,
    );

    const feedbackToken = await this.feedbackService.createFeedbackToken(
      saved.id,
      deadline,
    );

    const site = await this.reservationService.getSiteById(saved.site_id);
    const webBase = (envs.BOOKING_WEB_URL ?? envs.FRONTEND_URL).replace(
      /\/+$/,
      "",
    );
    const feedbackUrl = `${webBase}/reserva-feedback/${feedbackToken}`;

    await this.reservationEmailService.sendFinalizedEmails(
      saved,
      site,
      feedbackUrl,
    );
    await this.reservationEventService.logEvent(id, "finalized", {
      feedback_deadline_at: deadline.toISOString(),
    });

    return saved;
  }
}
