import type {
  BuiltReservationEmail,
  HostNoticeEmailPayload,
  HostNoticeEmailType,
  IncidentMessageEmailPayload,
  IncidentMessageEmailType,
  ReservationEmailDeposit,
  ReservationEmailDog,
  ReservationEmailPayload,
  ReservationEmailPriceLine,
  ReservationEmailType,
} from "../types/reservation-email.types";

import { Injectable, Logger } from "@nestjs/common";

import { Site } from "@/src/types/site.types";

import { MailQueueService } from "../../mail/mail-queue.service";
import { ReservationEconomicsService } from "../../payments/services/reservation-economics.service";
import { envs } from "../../shared/configs/envs";
import {
  formatScheduleText,
  type SiteSchedule,
} from "../../site-wizard/utils/site-schedule.utils";
import { ReservationEntity } from "../entities/reservation.entity";
import { ReservationGuestFeedbackEntity } from "../entities/reservation-guest-feedback.entity";
import { ReservationEmailTemplateService } from "./reservation-email-template.service";

export type { ReservationEmailType } from "../types/reservation-email.types";

/** Fase 4: «Pagar reserva» link (traveler panel, reservations tab). */
export function travelerReservationPayUrl(reservationId: number): string {
  const base = (envs.BOOKING_WEB_URL ?? envs.FRONTEND_URL).replace(/\/+$/, "");
  return `${base}/mi-perfil-textos?selTab=tv_reservas&res=${reservationId}`;
}

@Injectable()
export class ReservationEmailService {
  private readonly logger = new Logger(ReservationEmailService.name);

  constructor(
    private readonly mailQueueService: MailQueueService,
    private readonly templateService: ReservationEmailTemplateService,
    private readonly economics: ReservationEconomicsService,
  ) {}

  /**
   * F2: line breakdown + deposit + dogs for the confirmation emails, read
   * from the immutable snapshot (what the traveler accepted). Never throws:
   * a missing/legacy snapshot just means the classic email.
   */
  private async confirmationDetails(
    reservation: ReservationEntity,
  ): Promise<Record<string, unknown>> {
    const reservationId = reservation.id;
    try {
      const snapshot = await this.economics.findLatestSnapshot(reservationId);
      const payload = snapshot?.payload ?? null;
      if (!payload || !Array.isArray(payload.price_lines)) {
        return {};
      }
      const lines = (payload.price_lines as Record<string, unknown>[]).map(
        (line): ReservationEmailPriceLine => {
          const metadata = (line.metadata ?? {}) as Record<string, unknown>;
          return {
            description: String(line.description ?? ""),
            detail:
              typeof metadata.detail === "string" ? metadata.detail : null,
            amount_cents: Number(line.amount_cents ?? 0),
            is_optional: Boolean(line.is_optional),
          };
        },
      );
      const deposit = (payload.deposit ??
        null) as ReservationEmailDeposit | null;
      const dogs = Array.isArray(payload.dogs)
        ? (payload.dogs as Record<string, unknown>[]).map(
            (dog): ReservationEmailDog => ({
              name: typeof dog.name === "string" ? dog.name : null,
              weight_kg: Number(dog.weight_kg ?? 0),
              size:
                typeof dog.size === "object" && dog.size !== null
                  ? String((dog.size as { name?: unknown }).name ?? "")
                  : null,
              is_ppp: Boolean(dog.is_ppp),
            }),
          )
        : [];
      const refundPolicy = (payload.refund_policy ?? null) as Record<
        string,
        unknown
      > | null;
      const policyText =
        refundPolicy?.cancellation &&
        typeof refundPolicy.generated_text === "string" &&
        refundPolicy.generated_text.trim() !== ""
          ? refundPolicy.generated_text.trim()
          : undefined;
      const scheduleText = formatScheduleText(
        (payload.schedule ?? null) as Partial<SiteSchedule> | null,
        reservation.arrival_time ?? null,
      );
      return {
        price_lines: lines,
        total_cents: Number(payload.total_cents ?? 0),
        deposit,
        dogs,
        ...(policyText ? { policy_text: policyText } : {}),
        ...(scheduleText ? { schedule_text: scheduleText } : {}),
        ...(reservation.cribs ? { cribs_count: reservation.cribs } : {}),
      };
    } catch (error) {
      this.logger.warn(
        `Confirmation breakdown unavailable for reservation ${reservationId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {};
    }
  }

  private reservationPayload(
    reservation: ReservationEntity,
    site: Site,
    extras: Record<string, unknown> = {},
  ): ReservationEmailPayload {
    return {
      reservation_id: reservation.id,
      guest_name: reservation.guest_name ?? "",
      guest_email: reservation.guest_email ?? "",
      guest_phone: reservation.guest_phone ?? "",
      checkin: reservation.checkin,
      checkout: reservation.checkout,
      guests: reservation.guests,
      pets: reservation.pets,
      total: Number(reservation.total),
      site_id: reservation.site_id,
      site_name: site.name ?? "Alojamiento",
      host_email: site.email ?? "",
      ...extras,
    };
  }

  private resolveRecipient(built: BuiltReservationEmail): {
    to: string;
    subject: string;
    html: string;
    text?: string;
  } {
    const intendedEmail = built.to;
    if (envs.NODE_ENV === "production") {
      return {
        to: intendedEmail,
        subject: built.subject,
        html: built.html,
        ...(built.text ? { text: built.text } : {}),
      };
    }

    const devBanner = `<p><em>Destinatario real: ${this.escapeHtml(intendedEmail)}</em></p>`;
    return {
      to: envs.BOOKING_DEV_EMAIL,
      subject: `[DEV ${built.roleLabel} → ${intendedEmail}] ${built.subject}`,
      html: devBanner + built.html,
      ...(built.text
        ? { text: `Destinatario real: ${intendedEmail}\n\n${built.text}` }
        : {}),
    };
  }

  /**
   * Incident chat (2026-10-25): one email for one recipient (admin or
   * traveler). Never throws; returns false when nothing was queued so the
   * caller can log it.
   */
  async sendIncidentMessageEmail(
    emailType: IncidentMessageEmailType,
    payload: IncidentMessageEmailPayload,
  ): Promise<boolean> {
    try {
      const built = this.templateService.buildIncidentMessage(
        emailType,
        payload,
      );
      if (!built) {
        return false;
      }
      const result = await this.mailQueueService.enqueue(
        this.resolveRecipient(built),
      );
      return result.queued;
    } catch (error) {
      this.logger.error(
        `Failed to send email ${emailType} for incident ${payload.incident_id}`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  /** Punto 9: host-level notice (bank payout failed / reservations paused). Never throws. */
  async sendHostNoticeEmail(
    emailType: HostNoticeEmailType,
    payload: HostNoticeEmailPayload,
  ): Promise<boolean> {
    try {
      const built = this.templateService.buildHostNotice(emailType, payload);
      if (!built) {
        return false;
      }
      const result = await this.mailQueueService.enqueue(
        this.resolveRecipient(built),
      );
      return result.queued;
    } catch (error) {
      this.logger.error(
        `Failed to send email ${emailType} for host user ${payload.host_user_id}`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  async sendReservationEmail(
    emailType: ReservationEmailType,
    reservation: ReservationEntity,
    site: Site,
    extras: Record<string, unknown> = {},
  ): Promise<void> {
    const payload = this.reservationPayload(reservation, site, extras);

    try {
      const built = this.templateService.build(emailType, payload);

      if (!built) {
        return;
      }

      const resolved = this.resolveRecipient(built);

      await this.mailQueueService.enqueue({
        to: resolved.to,
        subject: resolved.subject,
        html: resolved.html,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send email ${emailType}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async sendPaymentConfirmedEmails(
    reservation: ReservationEntity,
    site: Site,
  ): Promise<void> {
    const details = {
      ...(await this.confirmationDetails(reservation)),
      ...this.deferredChargeDetails(reservation),
    };
    await this.sendReservationEmail(
      "payment_confirmed_guest",
      reservation,
      site,
      details,
    );
    await this.sendReservationEmail(
      "payment_confirmed_host",
      reservation,
      site,
      details,
    );
  }

  /**
   * Fase 5: flexible reservation confirmed with a saved card and nothing
   * charged yet. The confirmation email says when the charge will happen.
   */
  private deferredChargeDetails(
    reservation: ReservationEntity,
  ): Record<string, unknown> {
    if (
      reservation.charge_mode !== "flexible" ||
      reservation.payment_status !== "pending" ||
      !reservation.charge_at
    ) {
      return {};
    }
    return {
      charge_pending: true,
      charge_at: new Date(reservation.charge_at).toISOString(),
      timezone: reservation.timezone ?? "Europe/Madrid",
    };
  }

  /** @deprecated Use sendPaymentConfirmedEmails */
  async sendConfirmationEmail(
    reservation: ReservationEntity,
    siteName: string,
    hostEmail: string,
  ): Promise<void> {
    const site = {
      id: reservation.site_id,
      name: siteName,
      email: hostEmail,
    } as Site;
    return this.sendPaymentConfirmedEmails(reservation, site);
  }

  async sendCancelledEmails(
    reservation: ReservationEntity,
    site: Site,
    withRefund: boolean,
  ): Promise<void> {
    await this.sendReservationEmail(
      withRefund ? "cancelled_guest_refund" : "cancelled_guest_no_refund",
      reservation,
      site,
      { cancel_reason: reservation.cancel_reason ?? "" },
    );
    await this.sendReservationEmail("cancelled_host", reservation, site, {
      cancel_reason: reservation.cancel_reason ?? "",
      refund: withRefund,
    });
  }

  async sendFinalizedEmails(
    reservation: ReservationEntity,
    site: Site,
    feedbackUrl: string,
  ): Promise<void> {
    await this.sendReservationEmail(
      "finalized_guest_feedback",
      reservation,
      site,
      { feedback_url: feedbackUrl },
    );
    await this.sendReservationEmail("finalized_host", reservation, site, {
      feedback_deadline_at:
        reservation.feedback_deadline_at?.toISOString() ?? "",
    });
  }

  async sendFeedbackReviewEmails(
    reservation: ReservationEntity,
    site: Site,
    feedback: ReservationGuestFeedbackEntity,
  ): Promise<void> {
    await this.sendReservationEmail(
      "feedback_review_guest",
      reservation,
      site,
      {
        rating: feedback.rating,
        comment: feedback.comment ?? "",
      },
    );
    await this.sendReservationEmail("feedback_review_host", reservation, site, {
      rating: feedback.rating,
      comment: feedback.comment ?? "",
    });
  }

  async sendFeedbackReportEmails(
    reservation: ReservationEntity,
    site: Site,
    feedback: ReservationGuestFeedbackEntity,
  ): Promise<void> {
    await this.sendReservationEmail(
      "feedback_report_guest",
      reservation,
      site,
      {
        report_reason: feedback.report_reason ?? "",
      },
    );
    await this.sendReservationEmail("feedback_report_host", reservation, site, {
      report_reason: feedback.report_reason ?? "",
    });
    await this.sendReservationEmail(
      "feedback_report_admin",
      reservation,
      site,
      {
        report_reason: feedback.report_reason ?? "",
        comment: feedback.comment ?? "",
        admin_email: envs.BOOKING_ADMIN_EMAIL,
      },
    );
  }

  async sendPayoutReleasedEmails(
    reservation: ReservationEntity,
    site: Site,
  ): Promise<void> {
    await this.sendReservationEmail("payout_released_host", reservation, site);
    await this.sendReservationEmail("payout_released_guest", reservation, site);
  }

  async sendPayoutFailedEmails(
    reservation: ReservationEntity,
    site: Site,
    errorMessage: string,
  ): Promise<void> {
    await this.sendReservationEmail("payout_failed_host", reservation, site, {
      error_message: errorMessage,
    });
    await this.sendReservationEmail("payout_failed_admin", reservation, site, {
      error_message: errorMessage,
      admin_email: envs.BOOKING_ADMIN_EMAIL,
    });
  }

  async sendRefundProcessedEmails(
    reservation: ReservationEntity,
    site: Site,
  ): Promise<void> {
    await this.sendReservationEmail(
      "refund_processed_guest",
      reservation,
      site,
    );
    await this.sendReservationEmail("refund_processed_host", reservation, site);
  }

  async sendRefundFailedEmails(
    reservation: ReservationEntity,
    site: Site,
    failureReason: string,
  ): Promise<void> {
    await this.sendReservationEmail("refund_failed_guest", reservation, site, {
      error_message: failureReason,
    });
    await this.sendReservationEmail("refund_failed_host", reservation, site, {
      error_message: failureReason,
    });
    await this.sendReservationEmail("refund_failed_admin", reservation, site, {
      error_message: failureReason,
      admin_email: envs.BOOKING_ADMIN_EMAIL,
    });
  }

  async sendForceMajeureReviewAdminEmail(
    reservation: ReservationEntity,
    site: Site,
    reason: string,
    notes?: string,
  ): Promise<void> {
    await this.sendReservationEmail(
      "force_majeure_review_admin",
      reservation,
      site,
      {
        cancel_reason: reason,
        comment: notes ?? "",
        admin_email: envs.BOOKING_ADMIN_EMAIL,
      },
    );
  }

  /**
   * F-PV7a: a traveler opened an incident. `payoutBlocked` reuses the
   * payload `refund` flag only to pick the subject line.
   */
  async sendIncidentAdminEmail(
    reservation: ReservationEntity,
    site: Site,
    incidentType: string,
    description: string,
    payoutBlocked: boolean,
  ): Promise<void> {
    await this.sendReservationEmail(
      "incident_opened_admin",
      reservation,
      site,
      {
        report_reason: incidentType,
        comment: description,
        refund: payoutBlocked,
        admin_email: envs.BOOKING_ADMIN_EMAIL,
      },
    );
  }

  async sendExceptionalRefundReviewAdminEmail(
    reservation: ReservationEntity,
    site: Site,
    amountCents: number,
    reason: string,
  ): Promise<void> {
    await this.sendReservationEmail(
      "exceptional_refund_review_admin",
      reservation,
      site,
      {
        cancel_reason: reason,
        total_cents: amountCents,
        admin_email: envs.BOOKING_ADMIN_EMAIL,
      },
    );
  }

  /** Payment arrived for an expired/cancelled reservation whose dates are gone: full refund. */
  async sendPaymentAfterExpiryRefundEmails(
    reservation: ReservationEntity,
    site: Site,
  ): Promise<void> {
    await this.sendReservationEmail(
      "payment_after_expiry_refund_guest",
      reservation,
      site,
    );
    await this.sendReservationEmail(
      "payment_after_expiry_refund_admin",
      reservation,
      site,
      { admin_email: envs.BOOKING_ADMIN_EMAIL },
    );
  }

  /** Fase 4: the off-session deferred charge succeeded. */
  async sendDeferredChargeSucceededEmail(
    reservation: ReservationEntity,
    site: Site,
    amountCents: number,
  ): Promise<void> {
    await this.sendReservationEmail(
      "deferred_charge_succeeded_traveler",
      reservation,
      site,
      { amount_cents: amountCents },
    );
  }

  /**
   * Fase 4: the deferred charge failed. The traveler gets the panel link to
   * pay before the regularization deadline; the host is informed.
   */
  async sendDeferredChargeFailedEmails(
    reservation: ReservationEntity,
    site: Site,
  ): Promise<void> {
    const extras = {
      pay_url: travelerReservationPayUrl(reservation.id),
      deadline_at: reservation.regularization_deadline_at
        ? new Date(reservation.regularization_deadline_at).toISOString()
        : "",
      timezone: reservation.timezone ?? "Europe/Madrid",
    };
    await this.sendReservationEmail(
      "deferred_charge_failed_traveler",
      reservation,
      site,
      extras,
    );
    await this.sendReservationEmail(
      "deferred_charge_failed_host",
      reservation,
      site,
      extras,
    );
  }

  /** Fase 4: regularization window over without payment: cancelled. */
  async sendRegularizationExpiredEmails(
    reservation: ReservationEntity,
    site: Site,
  ): Promise<void> {
    await this.sendReservationEmail(
      "regularization_expired_traveler",
      reservation,
      site,
    );
    await this.sendReservationEmail(
      "regularization_expired_host",
      reservation,
      site,
    );
  }

  /** Fase 4: cancellation penalty could not be charged (incident opened). */
  async sendDeferredPenaltyFailedAdminEmail(
    reservation: ReservationEntity,
    site: Site,
    amountCents: number,
    failure: string,
  ): Promise<void> {
    await this.sendReservationEmail(
      "deferred_penalty_failed_admin",
      reservation,
      site,
      {
        amount_cents: amountCents,
        error_message: failure,
        admin_email: envs.BOOKING_ADMIN_EMAIL,
      },
    );
  }

  async sendStripeDisputeEmails(
    reservation: ReservationEntity,
    site: Site,
    reason: string,
  ): Promise<void> {
    await this.sendReservationEmail(
      "feedback_report_admin",
      reservation,
      site,
      {
        report_reason: reason,
        comment: "Stripe chargeback/dispute created",
        admin_email: envs.BOOKING_ADMIN_EMAIL,
      },
    );
    await this.sendReservationEmail("feedback_report_host", reservation, site, {
      report_reason: reason,
      comment: "Stripe chargeback/dispute created",
    });
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
}
