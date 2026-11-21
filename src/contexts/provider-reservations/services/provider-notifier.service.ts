import type { Site } from "@/src/types/site.types";
import type { ReservationEntity } from "../../reservations/entities/reservation.entity";

import { Injectable, Logger } from "@nestjs/common";

import { MailQueueService } from "../../mail/mail-queue.service";
import { ReservationEmailService } from "../../reservations/services/reservation-email.service";
import { envs } from "../../shared/configs/envs";
import { MysqlService } from "../../shared/services/mysql.service";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Phase 5 side effects towards people (never throws): traveler cancellation
 * emails, per-reservation admin alerts and the weekly sync digest (not tied
 * to a reservation, sent through the mail queue like the other admin mails).
 */
@Injectable()
export class ProviderNotifierService {
  private readonly logger = new Logger(ProviderNotifierService.name);

  constructor(
    private readonly emailService: ReservationEmailService,
    private readonly mailQueue: MailQueueService,
    private readonly mysqlService: MysqlService,
  ) {}

  async loadSite(siteId: number): Promise<Site> {
    try {
      const site = await this.mysqlService.queryOne<Site>(
        `SELECT * FROM ${envs.DB_PREFIX}sites1 WHERE id = ?`,
        [siteId],
      );
      if (site) {
        return site;
      }
    } catch (error) {
      this.logger.warn(`Site ${siteId} unavailable: ${errorMessage(error)}`);
    }
    return { id: siteId, name: "Alojamiento" } as Site;
  }

  /** Existing cancellation templates (host copy skipped for nuitee). */
  async sendCancelled(
    reservation: ReservationEntity,
    withRefund: boolean,
  ): Promise<void> {
    try {
      const site = await this.loadSite(reservation.site_id);
      await this.emailService.sendCancelledEmails(
        reservation,
        site,
        withRefund,
      );
    } catch (error) {
      this.logger.error(
        `Cancellation email failed for provider reservation ${reservation.id}: ${errorMessage(error)}`,
      );
    }
  }

  async alertAdmin(
    reservation: ReservationEntity,
    alert: string,
  ): Promise<void> {
    this.logger.error(`Provider reservation ${reservation.id}: ${alert}`);
    try {
      const site = await this.loadSite(reservation.site_id);
      await this.emailService.sendProviderReservationAdminAlert(
        reservation,
        site,
        alert,
      );
    } catch (error) {
      this.logger.error(
        `Admin alert failed for provider reservation ${reservation.id}: ${errorMessage(error)}`,
      );
    }
  }

  /** Admin email with a list of lines (weekly hotel sync). */
  async sendAdminDigest(
    subject: string,
    lines: readonly string[],
  ): Promise<void> {
    if (lines.length === 0) {
      return;
    }
    const intended = envs.BOOKING_ADMIN_EMAIL;
    const production = envs.NODE_ENV === "production";
    const items = lines.map(line => `<li>${escapeHtml(line)}</li>`).join("");
    const html = `${production ? "" : `<p><em>Destinatario real: ${escapeHtml(intended)}</em></p>`}<p>${escapeHtml(subject)}</p><ul>${items}</ul>`;
    try {
      await this.mailQueue.enqueue({
        to: production ? intended : envs.BOOKING_DEV_EMAIL,
        subject: production ? subject : `[DEV admin → ${intended}] ${subject}`,
        html,
        text: lines.join("\n"),
      });
    } catch (error) {
      this.logger.error(`Admin digest failed: ${errorMessage(error)}`);
    }
  }
}
