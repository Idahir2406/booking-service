import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { createHash, randomBytes } from "node:crypto";
import { Repository } from "typeorm";

import { envs } from "../../shared/configs/envs";
import { MysqlService } from "../../shared/services/mysql.service";
import { Site } from "@/src/types/site.types";

import { FeedbackSummaryDto } from "../dto/feedback-summary.dto";
import { SubmitFeedbackDto } from "../dto/submit-feedback.dto";
import { ReservationDisputeEntity } from "../entities/reservation-dispute.entity";
import { ReservationFeedbackTokenEntity } from "../entities/reservation-feedback-token.entity";
import {
  FeedbackTypeValue,
  ReservationGuestFeedbackEntity,
} from "../entities/reservation-guest-feedback.entity";
import {
  PayoutStatusValue,
  ReservationEntity,
} from "../entities/reservation.entity";
import { ReservationEmailService } from "./reservation-email.service";
import { ReservationEventService } from "./reservation-event.service";
import { ReservationPayoutService } from "./reservation-payout.service";

@Injectable()
export class ReservationFeedbackService {
  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    @InjectRepository(ReservationFeedbackTokenEntity)
    private readonly tokenRepository: Repository<ReservationFeedbackTokenEntity>,
    @InjectRepository(ReservationGuestFeedbackEntity)
    private readonly feedbackRepository: Repository<ReservationGuestFeedbackEntity>,
    @InjectRepository(ReservationDisputeEntity)
    private readonly disputeRepository: Repository<ReservationDisputeEntity>,
    private readonly mysqlService: MysqlService,
    private readonly payoutService: ReservationPayoutService,
    private readonly reservationEmailService: ReservationEmailService,
    private readonly reservationEventService: ReservationEventService,
  ) {}

  hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  async createFeedbackToken(reservationId: number, expiresAt: Date): Promise<string> {
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = this.hashToken(rawToken);

    const entity = this.tokenRepository.create({
      reservation_id: reservationId,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });
    await this.tokenRepository.save(entity);

    return rawToken;
  }

  private async resolveTokenRecord(token: string) {
    const tokenHash = this.hashToken(token);
    const record = await this.tokenRepository.findOne({
      where: { token_hash: tokenHash },
    });
    if (!record) {
      throw new NotFoundException("Feedback token not found");
    }
    return record;
  }

  async getFeedbackSummary(token: string): Promise<FeedbackSummaryDto> {
    const record = await this.resolveTokenRecord(token);
    const reservation = await this.reservationRepository.findOne({
      where: { id: record.reservation_id },
    });
    if (!reservation) {
      throw new NotFoundException("Reservation not found");
    }

    const site = await this.mysqlService.queryOne<Site>(
      `SELECT * FROM ${envs.DB_PREFIX}sites1 WHERE id = ?`,
      [reservation.site_id],
    );

    const existingFeedback = await this.feedbackRepository.findOne({
      where: { reservation_id: reservation.id },
    });

    const now = new Date();
    const tokenExpired =
      record.used_at !== undefined && record.used_at !== null
        ? true
        : record.expires_at.getTime() < now.getTime();

    if (tokenExpired && !existingFeedback) {
      throw new GoneException("Feedback token expired or already used");
    }

    return {
      reservation_id: reservation.id,
      code: `#RES-${reservation.id}`,
      site_name: site?.name ?? "",
      checkin: reservation.checkin,
      checkout: reservation.checkout,
      guest_name: reservation.guest_name ?? null,
      status: reservation.status,
      payout_status: reservation.payout_status ?? null,
      feedback_deadline_at: reservation.feedback_deadline_at
        ? reservation.feedback_deadline_at.toISOString()
        : null,
      already_submitted: !!existingFeedback,
      token_expired: tokenExpired,
    };
  }

  async submitFeedback(token: string, dto: SubmitFeedbackDto) {
    const record = await this.resolveTokenRecord(token);

    if (record.used_at) {
      throw new GoneException("Feedback token already used");
    }
    if (record.expires_at.getTime() < Date.now()) {
      throw new GoneException("Feedback token expired");
    }

    const reservation = await this.reservationRepository.findOne({
      where: { id: record.reservation_id },
    });
    if (!reservation) {
      throw new NotFoundException("Reservation not found");
    }

    if (reservation.status !== "finalized") {
      throw new BadRequestException(
        `Reservation ${reservation.id} is not finalized`,
      );
    }

    const existing = await this.feedbackRepository.findOne({
      where: { reservation_id: reservation.id },
    });
    if (existing) {
      return { already_submitted: true, feedback: existing };
    }

    if (dto.type === "review") {
      if (!dto.rating || dto.rating < 1 || dto.rating > 5) {
        throw new BadRequestException("Rating is required for reviews (1-5)");
      }
    } else if (dto.type === "report") {
      if (!dto.report_reason || dto.report_reason.trim() === "") {
        throw new BadRequestException("Report reason is required");
      }
    }

    const feedback = this.feedbackRepository.create({
      reservation_id: reservation.id,
      type: dto.type as FeedbackTypeValue,
      rating: dto.rating,
      comment: dto.comment,
      report_reason: dto.report_reason,
    });
    await this.feedbackRepository.save(feedback);

    const usedToken = await this.tokenRepository.preload({
      id: record.id,
      used_at: new Date(),
    });
    if (usedToken) {
      await this.tokenRepository.save(usedToken);
    }

    const site = await this.mysqlService.queryOne<Site>(
      `SELECT * FROM ${envs.DB_PREFIX}sites1 WHERE id = ?`,
      [reservation.site_id],
    );

    if (dto.type === "review") {
      await this.payoutService.releaseHostPayout(reservation.id);
      if (site) {
        await this.reservationEmailService.sendFeedbackReviewEmails(
          reservation,
          site,
          feedback,
        );
      }
      await this.reservationEventService.logEvent(reservation.id, "feedback_review", {
        rating: dto.rating,
      });
    } else {
      const updated = await this.reservationRepository.preload({
        id: reservation.id,
        payout_status: "blocked" as PayoutStatusValue,
      });
      if (updated) {
        await this.reservationRepository.save(updated);
      }

      const dispute = this.disputeRepository.create({
        reservation_id: reservation.id,
        status: "open",
        guest_report: [dto.report_reason, dto.comment]
          .filter(Boolean)
          .join(" — "),
      });
      await this.disputeRepository.save(dispute);

      if (site) {
        await this.reservationEmailService.sendFeedbackReportEmails(
          reservation,
          site,
          feedback,
        );
      }
      await this.reservationEventService.logEvent(reservation.id, "feedback_report", {
        report_reason: dto.report_reason,
      });
    }

    return { already_submitted: false, feedback };
  }
}
