import type {
  BuiltReservationEmail,
  ReservationEmailPayload,
  ReservationEmailType,
} from "../types/reservation-email.types";

import { Injectable, Logger } from "@nestjs/common";

import { Site } from "@/src/types/site.types";

import { MailQueueService } from "../../mail/mail-queue.service";
import { envs } from "../../shared/configs/envs";
import { ReservationEntity } from "../entities/reservation.entity";
import { ReservationGuestFeedbackEntity } from "../entities/reservation-guest-feedback.entity";
import { ReservationEmailTemplateService } from "./reservation-email-template.service";

export type { ReservationEmailType } from "../types/reservation-email.types";

@Injectable()
export class ReservationEmailService {
  private readonly logger = new Logger(ReservationEmailService.name);

  constructor(
    private readonly mailQueueService: MailQueueService,
    private readonly templateService: ReservationEmailTemplateService,
  ) {}

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
      total: Number(reservation.total ?? 0),
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
  } {
    const intendedEmail = built.to;
    if (envs.NODE_ENV === "production") {
      return {
        to: intendedEmail,
        subject: built.subject,
        html: built.html,
      };
    }

    const devBanner = `<p><em>Destinatario real: ${this.escapeHtml(intendedEmail)}</em></p>`;
    return {
      to: envs.BOOKING_DEV_EMAIL,
      subject: `[DEV ${built.roleLabel} → ${intendedEmail}] ${built.subject}`,
      html: devBanner + built.html,
    };
  }

  async sendReservationEmail(
    emailType: ReservationEmailType,
    reservation: ReservationEntity,
    site: Site,
    extras: Record<string, unknown> = {},
  ): Promise<void> {
    const payload = this.reservationPayload(reservation, site, extras);
    const customer = site.customer ?? "";

    try {
      const built = await this.templateService.build(
        emailType,
        payload,
        customer,
      );

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
    await this.sendReservationEmail(
      "payment_confirmed_guest",
      reservation,
      site,
    );
    await this.sendReservationEmail(
      "payment_confirmed_host",
      reservation,
      site,
    );
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
