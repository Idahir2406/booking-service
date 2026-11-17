import type {
  TravelerIncidentInboxDto,
  TravelerIncidentInboxItemDto,
  TravelerIncidentThreadDto,
} from "../dto/reservation-incident.dto";

import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";

import { envs } from "../../shared/configs/envs";
import { MysqlService } from "../../shared/services/mysql.service";
import { ReservationEntity } from "../entities/reservation.entity";
import { ReservationIncidentEntity } from "../entities/reservation-incident.entity";
import { ReservationIncidentAttachmentEntity } from "../entities/reservation-incident-attachment.entity";
import { ReservationIncidentMessageEntity } from "../entities/reservation-incident-message.entity";
import { latestIso } from "../utils/incident-admin.util";
import {
  INCIDENT_AUTHOR,
  type IncidentAuthor,
  incidentRef,
  isHiddenFromTraveler,
  isOpenIncidentStatus,
} from "../utils/reservation-incident.util";
import { ReservationIncidentService } from "./reservation-incident.service";

/** Legacy site columns for the group header (jsites1). */
interface InboxSiteRow {
  id: number | string;
  name: string | null;
  poblacio: string | null;
}

interface InboxSite {
  name: string | null;
  town: string | null;
}

export const INCIDENT_PREVIEW_MAX = 140;

export const INCIDENT_AUTHOR_DISPLAY: Record<IncidentAuthor, string> = {
  [INCIDENT_AUTHOR.TRAVELER]: "Tú",
  [INCIDENT_AUTHOR.ADMIN]: "Equipo V4P",
};

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** DATE columns: TypeORM/mysql2 may return a Date or "YYYY-MM-DD". */
function isoDate(value: unknown): string | null {
  if (typeof value === "string" && value !== "") {
    return value.slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return null;
}

function nonEmpty(value: string | null | undefined): string | null {
  return value === null || value === undefined || value.trim() === ""
    ? null
    : value.trim();
}

/** One line, at most 140 chars (ellipsis included). */
export function incidentPreview(
  text: string | null | undefined,
): string | null {
  const flat = (text ?? "").replaceAll(/\s+/g, " ").trim();
  if (flat === "") {
    return null;
  }
  const chars = [...flat];
  return chars.length <= INCIDENT_PREVIEW_MAX
    ? flat
    : `${chars.slice(0, INCIDENT_PREVIEW_MAX - 1).join("")}…`;
}

function reservationRef(id: number): string {
  return `#RES-${id}`;
}

/**
 * "Incidencias" tab of the traveler account (2026-10-25). Read side only:
 * every write keeps going through ReservationIncidentService. Ownership is
 * strictly reservations.user_id (the incidents of the user's reservations).
 * The legacy site lookup never fails the request (site name/town → null).
 */
@Injectable()
export class TravelerIncidentInboxService {
  private readonly logger = new Logger(TravelerIncidentInboxService.name);

  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    @InjectRepository(ReservationIncidentEntity)
    private readonly incidentRepository: Repository<ReservationIncidentEntity>,
    @InjectRepository(ReservationIncidentMessageEntity)
    private readonly messageRepository: Repository<ReservationIncidentMessageEntity>,
    @InjectRepository(ReservationIncidentAttachmentEntity)
    private readonly attachmentRepository: Repository<ReservationIncidentAttachmentEntity>,
    private readonly incidentService: ReservationIncidentService,
    private readonly mysqlService: MysqlService,
  ) {}

  /** All incidents of the user's reservations, last activity first. */
  async listForTraveler(userId: number): Promise<TravelerIncidentInboxDto> {
    this.assertUserId(userId);
    const reservations = await this.reservationRepository.find({
      where: { user_id: userId },
    });
    if (reservations.length === 0) {
      return { items: [], total: 0 };
    }
    const byId = new Map(reservations.map(row => [row.id, row]));
    // host_cannot_host stays hidden while V4P reviews it.
    const allIncidents = await this.incidentRepository.find({
      where: { reservation_id: In([...byId.keys()]) },
    });
    const incidents = allIncidents.filter(row => !isHiddenFromTraveler(row));
    if (incidents.length === 0) {
      return { items: [], total: 0 };
    }
    const ids = incidents.map(row => row.id);
    const [messages, attachments, sites] = await Promise.all([
      this.messageRepository.find({
        where: { incident_id: In(ids) },
        order: { created_at: "ASC" },
      }),
      this.attachmentRepository.find({
        where: { incident_id: In(ids) },
        order: { created_at: "ASC" },
      }),
      this.loadSites([
        ...new Set(
          incidents
            .map(row => byId.get(row.reservation_id)?.site_id)
            .filter((id): id is number => typeof id === "number"),
        ),
      ]),
    ]);

    const items = incidents.map((incident): TravelerIncidentInboxItemDto => {
      const reservation = byId.get(incident.reservation_id);
      const ownMessages = messages.filter(
        row => row.incident_id === incident.id,
      );
      const ownAttachments = attachments.filter(
        row => row.incident_id === incident.id,
      );
      const last = ownMessages.at(-1) ?? null;
      const site = reservation ? sites.get(reservation.site_id) : undefined;
      const createdAt = iso(incident.created_at) ?? "";
      return {
        id: incident.id,
        incident_ref: incidentRef(incident.id),
        reservation_id: incident.reservation_id,
        reservation_ref: reservationRef(incident.reservation_id),
        type: incident.type,
        status: incident.status,
        blocks_payout: Boolean(incident.blocks_payout),
        is_open: isOpenIncidentStatus(incident.status),
        created_at: createdAt,
        updated_at: iso(incident.updated_at) ?? "",
        last_activity_at:
          latestIso(
            incident.created_at,
            incident.updated_at,
            last?.created_at,
            ownAttachments.at(-1)?.created_at,
          ) ?? createdAt,
        last_message_preview: incidentPreview(
          last ? last.body : incident.description,
        ),
        last_message_author: last ? last.author_type : null,
        message_count: ownMessages.length,
        attachment_count: ownAttachments.length,
        site_id: reservation?.site_id ?? 0,
        site_name: site?.name ?? null,
        site_town: site?.town ?? null,
        checkin: isoDate(reservation?.checkin),
        checkout: isoDate(reservation?.checkout),
      };
    });
    items.sort(
      (a, b) =>
        new Date(b.last_activity_at).getTime() -
          new Date(a.last_activity_at).getTime() || b.id - a.id,
    );
    return { items, total: items.length };
  }

  /** Full chat of one incident (403/404 from ReservationIncidentService). */
  async getThreadForTraveler(
    userId: number,
    incidentId: number,
  ): Promise<TravelerIncidentThreadDto> {
    const { incident, reservation } = await this.incidentService.getForTraveler(
      userId,
      incidentId,
    );
    const sites = await this.loadSites([reservation.site_id]);
    const site = sites.get(reservation.site_id);
    return {
      ...incident,
      incident_ref: incidentRef(incident.id),
      reservation_ref: reservationRef(incident.reservation_id),
      site_id: reservation.site_id,
      site_name: site?.name ?? null,
      site_town: site?.town ?? null,
      checkin: isoDate(reservation.checkin),
      checkout: isoDate(reservation.checkout),
      last_activity_at:
        latestIso(
          incident.created_at,
          incident.updated_at,
          incident.messages.at(-1)?.created_at,
          incident.attachments.at(-1)?.created_at,
        ) ?? incident.created_at,
      messages: incident.messages.map(message => ({
        ...message,
        author_display: INCIDENT_AUTHOR_DISPLAY[message.author_type],
      })),
    };
  }

  private assertUserId(userId: number): void {
    // Same rule as ReservationIncidentService (400 on an invalid id).
    if (!Number.isInteger(userId) || userId < 1) {
      throw new BadRequestException("Invalid traveler user_id");
    }
  }

  /** Never throws: a failed legacy lookup leaves name/town null. */
  private async loadSites(ids: number[]): Promise<Map<number, InboxSite>> {
    const sites = new Map<number, InboxSite>();
    if (ids.length === 0) {
      return sites;
    }
    try {
      const rows = await this.mysqlService.query<InboxSiteRow>(
        `SELECT id, name, poblacio FROM \`${envs.DB_PREFIX}sites1\` WHERE id IN (?)`,
        [ids],
      );
      for (const row of rows) {
        sites.set(Number(row.id), {
          name: nonEmpty(row.name),
          town: nonEmpty(row.poblacio),
        });
      }
    } catch (error) {
      this.logger.warn(
        `Traveler incidents site lookup failed for ids ${ids.join(",")}`,
        error instanceof Error ? error.message : String(error),
      );
    }
    return sites;
  }
}
