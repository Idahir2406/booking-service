import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, LessThanOrEqual, Repository } from "typeorm";

import { StripeService } from "../../stripe/services/stripe.service";
import { ReservationGuestFeedbackEntity } from "../entities/reservation-guest-feedback.entity";
import { ReservationEntity } from "../entities/reservation.entity";
import { ReservationEmailService } from "./reservation-email.service";
import { ReservationService } from "./reservation.service";

export interface ReleasePayoutResult {
  released: boolean;
  transferId?: string;
  reason?: string;
}

@Injectable()
export class ReservationPayoutService {
  private readonly logger = new Logger(ReservationPayoutService.name);

  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    @InjectRepository(ReservationGuestFeedbackEntity)
    private readonly feedbackRepository: Repository<ReservationGuestFeedbackEntity>,
    @Inject(
      forwardRef(
        () => require("../../stripe/services/stripe.service").StripeService,
      ),
    )
    private readonly stripeService: StripeService,
    @Inject(
      forwardRef(
        () => require("./reservation.service").ReservationService,
      ),
    )
    private readonly reservationService: ReservationService,
    private readonly reservationEmailService: ReservationEmailService,
  ) {}

  async releaseHostPayout(reservationId: number): Promise<ReleasePayoutResult> {
    const reservation = await this.reservationRepository.findOne({
      where: { id: reservationId },
    });
    if (!reservation) {
      throw new NotFoundException(
        `Reservation with id ${reservationId} not found`,
      );
    }

    if (reservation.stripe_transfer_id) {
      return {
        released: false,
        transferId: reservation.stripe_transfer_id,
        reason: "already_transferred",
      };
    }

    if (reservation.payout_status !== "held") {
      return {
        released: false,
        reason: `payout_status=${reservation.payout_status ?? "null"}`,
      };
    }

    if (!reservation.stripe_payment_intent_id) {
      throw new BadRequestException(
        `Reservation ${reservationId} has no payment intent`,
      );
    }

    const site = await this.reservationService.getSiteById(reservation.site_id);
    const hostUserId = site.user_id ?? 0;
    if (!hostUserId) {
      throw new BadRequestException(
        `Site ${reservation.site_id} has no host user`,
      );
    }

    const totalPaidCents = Math.round(Number(reservation.total ?? 0) * 100);
    if (totalPaidCents <= 0) {
      throw new BadRequestException(
        `Reservation ${reservationId} has invalid total`,
      );
    }

    try {
      const transfer = await this.stripeService.transferHostPayout({
        paymentIntentId: reservation.stripe_payment_intent_id,
        hostUserId,
        totalPaidCents,
      });

      const transferId = transfer?.id ?? undefined;
      const now = new Date();

      const updated = await this.reservationRepository.preload({
        id: reservation.id,
        payout_status: "released",
        payout_released_at: now,
        stripe_transfer_id: transferId,
      });
      if (!updated) {
        throw new NotFoundException(
          `Reservation with id ${reservationId} not found`,
        );
      }
      const saved = await this.reservationRepository.save(updated);

      await this.reservationEmailService.sendPayoutReleasedEmails(saved, site);

      return { released: true, transferId };
    } catch (error) {
      this.logger.error(
        `Failed to release payout for reservation ${reservationId}`,
        error instanceof Error ? error.stack : String(error),
      );
      await this.reservationEmailService.sendPayoutFailedEmails(
        reservation,
        site,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async refundReservation(
    reservationId: number,
    amountCents?: number,
  ): Promise<{ refundId: string }> {
    const reservation = await this.reservationRepository.findOne({
      where: { id: reservationId },
    });
    if (!reservation) {
      throw new NotFoundException(
        `Reservation with id ${reservationId} not found`,
      );
    }

    if (!reservation.stripe_payment_intent_id) {
      throw new BadRequestException(
        `Reservation ${reservationId} has no payment intent to refund`,
      );
    }

    const refund = await this.stripeService.refundPaymentIntent({
      paymentIntentId: reservation.stripe_payment_intent_id,
      amountCents,
    });

    const isPartial =
      amountCents !== undefined &&
      amountCents <
        Math.round(
          (Number(reservation.subtotal) + Number(reservation.commission)) * 100,
        );

    const updated = await this.reservationRepository.preload({
      id: reservation.id,
      payment_status: isPartial ? "partially_refunded" : "refunded",
      stripe_refund_id: refund.id,
    });
    if (!updated) {
      throw new NotFoundException(
        `Reservation with id ${reservationId} not found`,
      );
    }
    const saved = await this.reservationRepository.save(updated);

    const site = await this.reservationService.getSiteById(reservation.site_id);
    await this.reservationEmailService.sendRefundProcessedEmails(saved, site);

    return { refundId: refund.id };
  }

  @Cron("*/15 * * * *")
  async processPayoutReleases(): Promise<void> {
    const now = new Date();
    const due = await this.reservationRepository.find({
      where: {
        status: "finalized",
        payout_status: "held",
        feedback_deadline_at: LessThanOrEqual(now),
        stripe_transfer_id: IsNull(),
      },
    });

    if (due.length === 0) {
      return;
    }

    for (const reservation of due) {
      const report = await this.feedbackRepository.findOne({
        where: { reservation_id: reservation.id, type: "report" },
      });
      if (report) {
        continue;
      }

      const feedback = await this.feedbackRepository.findOne({
        where: { reservation_id: reservation.id },
      });
      if (feedback) {
        continue;
      }

      try {
        await this.releaseHostPayout(reservation.id);
        this.logger.log(
          `Cron released payout for reservation ${reservation.id}`,
        );
      } catch (error) {
        this.logger.error(
          `Cron failed to release payout for reservation ${reservation.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }
}
