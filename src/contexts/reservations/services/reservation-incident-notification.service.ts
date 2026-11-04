import type {
  IncidentMessageEmailPayload,
  IncidentMessageEmailType,
  IncidentMessageEvent,
} from "../types/reservation-email.types";

import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { envs } from "../../shared/configs/envs";
import { MysqlService } from "../../shared/services/mysql.service";
import { ReservationEntity } from "../entities/reservation.entity";
import { ReservationIncidentEntity } from "../entities/reservation-incident.entity";
import { INCIDENT_MESSAGE_EMAIL } from "../types/reservation-email.types";
import { type IncidentAuthor } from "../utils/reservation-incident.util";
import { ReservationEmailService } from "./reservation-email.service";

export interface IncidentMessageNotification {
  incident: ReservationIncidentEntity;
  author: IncidentAuthor;
  body: string;
  event: IncidentMessageEvent;
  /** Backoffice actor (x-actor-name) for the admin copy of a V4P message. */
  actorName?: string | null;
  /** Default both. Creation: traveler only (the admin gets incident_opened_admin). */
  recipients?: readonly IncidentMessageEmailType[];
}

const ALL_RECIPIENTS: readonly IncidentMessageEmailType[] = [
  INCIDENT_MESSAGE_EMAIL.ADMIN,
  INCIDENT_MESSAGE_EMAIL.TRAVELER,
];

interface ProfileRow {
  name: string | null;
  email: string | null;
}

interface SiteRow {
  name: string | null;
  poblacio: string | null;
}

/** Legacy text columns store "" for missing values. */
function nonEmpty(value: string | null | undefined): string | null {
  return value === null || value === undefined || value.trim() === ""
    ? null
    : value.trim();
}

/** DATE columns: mysql2/TypeORM may return a Date or "YYYY-MM-DD". */
function isoDate(value: unknown): string | null {
  if (typeof value === "string" && value !== "") {
    return value.slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return null;
}

function webBase(): string {
  return (envs.BOOKING_WEB_URL ?? envs.FRONTEND_URL).replace(/\/+$/, "");
}

/** Traveler link: "Incidencias" tab of the unified account, thread open. */
export function incidentPanelUrl(incidentId: number): string {
  return `${webBase()}/mi-perfil-textos?selTab=tv_incidencias&inc=${incidentId}`;
}

/** Admin link: admino incident detail (BOOKING_ADMIN_URL or web + /admino). */
export function incidentAdminUrl(incidentId: number): string {
  const base = (envs.BOOKING_ADMIN_URL ?? `${webBase()}/admino`).replace(
    /\/+$/,
    "",
  );
  return `${base}/php/admIncidencia.php?id=${incidentId}`;
}

/**
 * Incident chat emails (2026-10-25): every message (traveler or V4P) sends
 * one email to the admin (BOOKING_ADMIN_EMAIL) and one to the traveler
 * (legacy profile email, else reservation.guest_email). Called AFTER the
 * transaction committed; best effort: never throws, every failure is logged
 * and the request keeps its result.
 */
@Injectable()
export class ReservationIncidentNotificationService {
  private readonly logger = new Logger(
    ReservationIncidentNotificationService.name,
  );

  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    private readonly reservationEmailService: ReservationEmailService,
    private readonly mysqlService: MysqlService,
  ) {}

  async notifyMessage(input: IncidentMessageNotification): Promise<void> {
    const { incident } = input;
    let payload: IncidentMessageEmailPayload;
    try {
      payload = await this.buildPayload(input);
    } catch (error) {
      this.logger.error(
        `Incident ${incident.id} message email: payload failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return;
    }
    for (const emailType of input.recipients ?? ALL_RECIPIENTS) {
      try {
        const queued =
          await this.reservationEmailService.sendIncidentMessageEmail(
            emailType,
            payload,
          );
        if (!queued) {
          this.logger.warn(
            `Incident ${incident.id}: ${emailType} not queued (${input.event})`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Incident ${incident.id}: ${emailType} failed (${input.event})`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  private async buildPayload(
    input: IncidentMessageNotification,
  ): Promise<IncidentMessageEmailPayload> {
    const { incident } = input;
    const reservation = await this.reservationRepository.findOne({
      where: { id: incident.reservation_id },
    });
    const [profile, site] = await Promise.all([
      reservation ? this.loadProfile(reservation.user_id) : null,
      reservation ? this.loadSite(reservation.site_id) : null,
    ]);
    return {
      incident_id: incident.id,
      reservation_id: incident.reservation_id,
      incident_type: incident.type,
      incident_status: incident.status,
      event: input.event,
      author: input.author,
      body: input.body,
      site_name: nonEmpty(site?.name),
      site_town: nonEmpty(site?.poblacio),
      checkin: isoDate(reservation?.checkin),
      checkout: isoDate(reservation?.checkout),
      traveler_name:
        nonEmpty(profile?.name) ?? nonEmpty(reservation?.guest_name),
      traveler_email:
        nonEmpty(profile?.email) ?? nonEmpty(reservation?.guest_email) ?? "",
      admin_email: envs.BOOKING_ADMIN_EMAIL,
      actor_name: nonEmpty(input.actorName),
      panel_url: incidentPanelUrl(incident.id),
      admin_url: incidentAdminUrl(incident.id),
    };
  }

  /** Legacy profile (PHP-owned table); null when missing or unreadable. */
  private async loadProfile(userId: number): Promise<ProfileRow | null> {
    if (!Number.isInteger(userId) || userId < 1) {
      return null;
    }
    try {
      const row = await this.mysqlService.queryOne<ProfileRow>(
        `SELECT name, email FROM \`${envs.DB_PREFIX}user_profiles\` WHERE id = ? LIMIT 1`,
        [userId],
      );
      return row ?? null;
    } catch (error) {
      this.logger.warn(
        `Incident email profile lookup failed for user ${userId}`,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  private async loadSite(siteId: number): Promise<SiteRow | null> {
    try {
      const row = await this.mysqlService.queryOne<SiteRow>(
        `SELECT name, poblacio FROM \`${envs.DB_PREFIX}sites1\` WHERE id = ? LIMIT 1`,
        [siteId],
      );
      return row ?? null;
    } catch (error) {
      this.logger.warn(
        `Incident email site lookup failed for site ${siteId}`,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }
}
