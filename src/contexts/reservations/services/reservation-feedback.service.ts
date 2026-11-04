import type { TravelerFeedbackTokenDto } from "../dto/traveler-panel.dto";

import { createHash, randomBytes } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";

import { Site } from "@/src/types/site.types";

import { actors } from "../../payments/domain/audit-actor";
import { payoutStateMachine } from "../../payments/domain/payout-state-machine";
import { AUDIT_ENTITY } from "../../payments/entities/audit-log.entity";
import { ReservationEconomicsService } from "../../payments/services/reservation-economics.service";
import { envs } from "../../shared/configs/envs";
import { MysqlService } from "../../shared/services/mysql.service";
import { FeedbackSummaryDto } from "../dto/feedback-summary.dto";
import { SubmitFeedbackDto } from "../dto/submit-feedback.dto";
import {
  PayoutStatusValue,
  ReservationEntity,
} from "../entities/reservation.entity";
import { ReservationDisputeEntity } from "../entities/reservation-dispute.entity";
import { ReservationFeedbackTokenEntity } from "../entities/reservation-feedback-token.entity";
import { ReservationGuestFeedbackEntity } from "../entities/reservation-guest-feedback.entity";
import { ReservationEmailService } from "./reservation-email.service";
import { ReservationEventService } from "./reservation-event.service";
import { ReservationPayoutService } from "./reservation-payout.service";

@Injectable()
export class ReservationFeedbackService {
  private readonly logger = new Logger(ReservationFeedbackService.name);

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
    private readonly economics: ReservationEconomicsService,
  ) {}

  hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  async createFeedbackToken(
    reservationId: number,
    expiresAt: Date,
    manager?: EntityManager,
  ): Promise<string> {
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = this.hashToken(rawToken);

    const repository = manager
      ? manager.getRepository(ReservationFeedbackTokenEntity)
      : this.tokenRepository;
    const entity = repository.create({
      reservation_id: reservationId,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });
    await repository.save(entity);

    return rawToken;
  }

  /**
   * Traveler panel (F-PV1): the email token is stored hashed and cannot be
   * recovered, so the owner gets a fresh token valid until the feedback
   * deadline. Submitting a review releases the payout; a report blocks it.
   */
  async issueTravelerFeedbackToken(
    userId: number,
    reservationId: number,
  ): Promise<TravelerFeedbackTokenDto> {
    const reservation = await this.reservationRepository.findOne({
      where: { id: reservationId },
    });
    if (!reservation) {
      throw new NotFoundException(
        `Reservation with id ${reservationId} not found`,
      );
    }
    if (userId < 1 || reservation.user_id !== userId) {
      throw new ForbiddenException("Reservation access denied");
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
      throw new ConflictException("Feedback already submitted");
    }
    const deadline = reservation.feedback_deadline_at
      ? new Date(reservation.feedback_deadline_at)
      : null;
    if (!deadline || deadline.getTime() <= Date.now()) {
      throw new GoneException("Feedback window expired");
    }

    const token = await this.createFeedbackToken(reservation.id, deadline);
    return { token, expires_at: deadline.toISOString() };
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
    // used_at comes back as null (not undefined) from the DB: truthiness covers both.
    const tokenExpired = record.used_at
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
    } else if (!dto.report_reason || dto.report_reason.trim() === "") {
      throw new BadRequestException("Report reason is required");
    }

    const feedback = this.feedbackRepository.create({
      reservation_id: reservation.id,
      type: dto.type,
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
      try {
        await this.payoutService.releaseHostPayout(
          reservation.id,
          actors.traveler(reservation.user_id),
        );
      } catch (error) {
        // Feedback is already stored; the payout cron retries the release
        // (it no longer skips reservations that have a review) (F0).
        this.logger.error(
          `Payout release after review failed for reservation ${reservation.id}; cron will retry`,
          error instanceof Error ? error.stack : String(error),
        );
      }
      if (site) {
        await this.reservationEmailService.sendFeedbackReviewEmails(
          reservation,
          site,
          feedback,
        );
      }
      await this.reservationEventService.logEvent(
        reservation.id,
        "feedback_review",
        {
          rating: dto.rating,
        },
      );
    } else {
      const previousPayout = reservation.payout_status ?? null;
      // A payout already released stays released (A21: debt handled in F4).
      const canBlock =
        previousPayout === null ||
        payoutStateMachine.canTransition(previousPayout, "blocked");
      await this.economics.auditDetached(
        AUDIT_ENTITY.PAYOUT,
        reservation.id,
        canBlock ? "payout.status_changed" : "payout.transition_rejected",
        actors.traveler(reservation.user_id),
        { from: previousPayout, to: "blocked", trigger: "guest_report" },
      );
      if (canBlock) {
        const updated = await this.reservationRepository.preload({
          id: reservation.id,
          payout_status: "blocked" as PayoutStatusValue,
        });
        if (updated) {
          await this.reservationRepository.save(updated);
        }
      }

      const dispute = this.disputeRepository.create({
        reservation_id: reservation.id,
        status: "open",
        source: "guest_report",
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
      await this.reservationEventService.logEvent(
        reservation.id,
        "feedback_report",
        {
          report_reason: dto.report_reason,
        },
      );
    }

    return { already_submitted: false, feedback };
  }
}
