import type {
  AdminIncidentActorDto,
  AdminIncidentAttachmentDto,
  AdminIncidentAttachmentFileDto,
  AdminIncidentDetailDto,
  AdminIncidentDisputeDto,
  AdminIncidentHistoryEntryDto,
  AdminIncidentListDto,
  AdminIncidentListItemDto,
  AdminIncidentNoShowQuoteDto,
  AdminIncidentReleaseHoldDto,
  AdminIncidentReservationDto,
  AdminIncidentTimelineMessageDto,
  ListIncidentsQueryDto,
} from "../dto/incident-admin.dto";
import type { TravelerChangeSummaryDto } from "../utils/reservation-change.util";

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { type ReservationSnapshotPayload } from "../../payments/domain/reservation-snapshot";
import { ReservationSnapshotEntity } from "../../payments/entities/reservation-snapshot.entity";
import { ReservationEconomicsService } from "../../payments/services/reservation-economics.service";
import { envs } from "../../shared/configs/envs";
import { MysqlService } from "../../shared/services/mysql.service";
import { ReservationEntity } from "../entities/reservation.entity";
import { ReservationDisputeEntity } from "../entities/reservation-dispute.entity";
import { ReservationEventEntity } from "../entities/reservation-event.entity";
import { ReservationIncidentEntity } from "../entities/reservation-incident.entity";
import { ReservationIncidentAttachmentEntity } from "../entities/reservation-incident-attachment.entity";
import { ReservationIncidentMessageEntity } from "../entities/reservation-incident-message.entity";
import {
  allowedNextStatuses,
  buildIncidentListQuery,
  emptyStatusCounts,
  INCIDENT_LIST_LIMITS,
  incidentAgeHours,
  latestIso,
} from "../utils/incident-admin.util";
import { resolveNoShowQuote } from "../utils/refund-policy.util";
import { summarizeSnapshotForTraveler } from "../utils/reservation-change.util";
import {
  INCIDENT_STATUS,
  INCIDENT_STATUSES,
  INCIDENT_TYPE,
  type IncidentStatus,
  type IncidentType,
  isOpenIncidentStatus,
} from "../utils/reservation-incident.util";

/** Row of the inbox query (mysql2 raw types). */
interface IncidentListRow {
  id: number | string;
  reservation_id: number | string;
  type: IncidentType;
  status: IncidentStatus;
  blocks_payout: number | string | boolean | null;
  dispute_id: number | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  resolved_at: Date | string | null;
  reservation_status: string | null;
  payment_status: string | null;
  payout_status: string | null;
  checkin: Date | string | null;
  checkout: Date | string | null;
  site_name: string | null;
  profile_name: string | null;
  profile_email: string | null;
  guest_name: string | null;
  guest_email: string | null;
  message_count: number | string | null;
  attachment_count: number | string | null;
  last_message_at: Date | string | null;
  last_attachment_at: Date | string | null;
}

interface CountRow {
  total: number | string;
}

interface StatusCountRow {
  status: string;
  total: number | string;
}

interface ProfileRow {
  name: string | null;
  email: string | null;
}

interface SiteNameRow {
  name: string | null;
}

/** Event types written by ReservationIncidentService for one incident. */
const INCIDENT_EVENT_PREFIX = "incident_";

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** DATE columns: mysql2 may return a Date or "YYYY-MM-DD". */
function isoDate(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  return Number.isNaN(value.getTime())
    ? null
    : value.toISOString().slice(0, 10);
}

/** Legacy text columns store "" for missing values. */
function nonEmpty(value: string | null | undefined): string | null {
  return value === null || value === undefined || value.trim() === ""
    ? null
    : value;
}

function toInt(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function reservationRef(id: number): string {
  return `#RES-${id}`;
}

function readActor(
  payload: Record<string, unknown> | undefined,
): AdminIncidentActorDto | null {
  const actor = payload?.actor;
  if (!actor || typeof actor !== "object") {
    return null;
  }
  const record = actor as Record<string, unknown>;
  const id = typeof record.id === "number" ? record.id : null;
  const name = typeof record.name === "string" ? record.name : null;
  return id === null && name === null ? null : { id, name };
}

function readString(
  payload: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = payload?.[key];
  return typeof value === "string" ? value : null;
}

/**
 * Backoffice fase 1: read side of the admino incidents inbox (internal routes
 * only). No writes, no transactions, no locks: every mutation keeps going
 * through ReservationIncidentService (state machine + row locks +
 * transitionPayout + audit). Storage keys leave this service ONLY through
 * getAttachmentFile (for the PHP proxy that streams the file).
 */
@Injectable()
export class ReservationIncidentAdminService {
  private readonly logger = new Logger(ReservationIncidentAdminService.name);

  constructor(
    @InjectRepository(ReservationIncidentEntity)
    private readonly incidentRepository: Repository<ReservationIncidentEntity>,
    @InjectRepository(ReservationIncidentMessageEntity)
    private readonly messageRepository: Repository<ReservationIncidentMessageEntity>,
    @InjectRepository(ReservationIncidentAttachmentEntity)
    private readonly attachmentRepository: Repository<ReservationIncidentAttachmentEntity>,
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    @InjectRepository(ReservationDisputeEntity)
    private readonly disputeRepository: Repository<ReservationDisputeEntity>,
    @InjectRepository(ReservationEventEntity)
    private readonly eventRepository: Repository<ReservationEventEntity>,
    @InjectRepository(ReservationSnapshotEntity)
    private readonly snapshotRepository: Repository<ReservationSnapshotEntity>,
    private readonly economics: ReservationEconomicsService,
    private readonly mysqlService: MysqlService,
  ) {}

  // ------------------------------------------------------------------ list

  async list(
    query: ListIncidentsQueryDto,
    now: Date = new Date(),
  ): Promise<AdminIncidentListDto> {
    const limit = query.limit ?? INCIDENT_LIST_LIMITS.DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    const built = buildIncidentListQuery(
      {
        status: query.status,
        type: query.type,
        blocks_payout: query.blocks_payout,
        from: query.from,
        to: query.to,
        q: query.q,
        limit,
        offset,
      },
      envs.DB_PREFIX,
    );
    const [rows, countRows, statusRows] = await Promise.all([
      this.mysqlService.query<IncidentListRow>(built.listSql, built.listParams),
      this.mysqlService.query<CountRow>(built.countSql, built.countParams),
      this.mysqlService.query<StatusCountRow>(
        built.statusCountSql,
        built.statusCountParams,
      ),
    ]);
    const statusCounts = emptyStatusCounts();
    for (const row of statusRows) {
      if ((INCIDENT_STATUSES as readonly string[]).includes(row.status)) {
        statusCounts[row.status as IncidentStatus] = toInt(row.total);
      }
    }
    return {
      items: rows.map(row => this.toListItem(row, now)),
      total: toInt(countRows[0]?.total),
      limit,
      offset,
      status_counts: statusCounts,
    };
  }

  // ---------------------------------------------------------------- detail

  async getDetail(
    incidentId: number,
    now: Date = new Date(),
  ): Promise<AdminIncidentDetailDto> {
    const incident = await this.findIncident(incidentId);
    const reservation = await this.reservationRepository.findOne({
      where: { id: incident.reservation_id },
    });
    if (!reservation) {
      throw new NotFoundException(
        `Reservation with id ${incident.reservation_id} not found`,
      );
    }
    const [
      messages,
      attachments,
      events,
      dispute,
      snapshot,
      profile,
      siteName,
    ] = await Promise.all([
      this.messageRepository.find({
        where: { incident_id: incident.id },
        order: { created_at: "ASC" },
      }),
      this.attachmentRepository.find({
        where: { incident_id: incident.id },
        order: { created_at: "ASC" },
      }),
      this.eventRepository.find({
        where: { reservation_id: reservation.id },
        order: { id: "ASC" },
      }),
      incident.dispute_id
        ? this.disputeRepository.findOne({ where: { id: incident.dispute_id } })
        : Promise.resolve(null),
      this.loadSnapshotPayload(reservation),
      this.loadProfile(incident.user_id),
      this.loadSiteName(reservation.site_id),
    ]);

    const incidentEvents = events.filter(
      event =>
        event.event_type.startsWith(INCIDENT_EVENT_PREFIX) &&
        Number(event.payload?.incident_id) === incident.id,
    );
    const actorByMessage = new Map<number, AdminIncidentActorDto>();
    for (const event of incidentEvents) {
      const messageId = Number(event.payload?.message_id);
      const actor = readActor(event.payload);
      if (Number.isInteger(messageId) && messageId > 0 && actor) {
        actorByMessage.set(messageId, actor);
      }
    }

    const summary = this.summarize(snapshot, siteName);
    return {
      id: incident.id,
      reservation_id: incident.reservation_id,
      reservation_ref: reservationRef(incident.reservation_id),
      type: incident.type,
      status: incident.status,
      description: incident.description,
      blocks_payout: Boolean(incident.blocks_payout),
      resolution_note: incident.resolution_note ?? null,
      resolved_at: iso(incident.resolved_at),
      created_at: iso(incident.created_at) ?? "",
      updated_at: iso(incident.updated_at) ?? "",
      age_hours: incidentAgeHours(
        incident.created_at,
        incident.resolved_at,
        incident.status,
        now,
      ),
      traveler: {
        user_id: incident.user_id,
        name: nonEmpty(profile?.name) ?? nonEmpty(reservation.guest_name),
        email: nonEmpty(profile?.email) ?? nonEmpty(reservation.guest_email),
      },
      messages: messages.map(
        (row): AdminIncidentTimelineMessageDto => ({
          id: row.id,
          author_type: row.author_type,
          body: row.body,
          created_at: iso(row.created_at) ?? "",
          actor: actorByMessage.get(row.id) ?? null,
        }),
      ),
      attachments: attachments.map(row => this.toAttachmentDto(row)),
      history: incidentEvents.map(
        (event): AdminIncidentHistoryEntryDto => ({
          event_type: event.event_type,
          created_at: iso(event.created_at) ?? "",
          from: readString(event.payload, "from"),
          to: readString(event.payload, "to"),
          release_hold:
            typeof event.payload?.release_hold === "boolean"
              ? event.payload.release_hold
              : null,
          payout_hold: readString(event.payload, "payout_hold"),
          actor: readActor(event.payload),
        }),
      ),
      dispute: dispute ? this.toDisputeDto(dispute) : null,
      reservation: this.toReservationDto(reservation, siteName, summary),
      allowed_next_statuses: allowedNextStatuses(incident.status),
      release_hold: await this.resolveReleaseHold(incident, reservation),
      can_message: isOpenIncidentStatus(incident.status),
      no_show_quote:
        incident.type === INCIDENT_TYPE.NO_SHOW
          ? this.noShowQuote(incident, reservation, snapshot)
          : null,
    };
  }

  private noShowQuote(
    incident: ReservationIncidentEntity,
    reservation: ReservationEntity,
    snapshot: ReservationSnapshotPayload | null,
  ): AdminIncidentNoShowQuoteDto {
    const quote = resolveNoShowQuote(reservation, snapshot);
    let hostAmountCents: number | null = null;
    try {
      const refundedAfter =
        Math.round(Number(reservation.amount_refunded ?? 0) * 100) +
        quote.refund_cents;
      hostAmountCents = this.economics.computePlatformFee(
        reservation,
        refundedAfter,
      ).hostAmountCents;
    } catch (error) {
      this.logger.warn(
        `No-show host amount estimate failed for reservation ${reservation.id}`,
        error instanceof Error ? error.message : String(error),
      );
    }
    return {
      no_show_policy: quote.no_show_policy,
      paid_cents: quote.paid_cents,
      penalty_cents: quote.penalty_cents,
      refund_cents: quote.refund_cents,
      host_amount_cents: hostAmountCents,
      currency: reservation.currency ?? null,
      can_resolve: isOpenIncidentStatus(incident.status),
    };
  }

  // ------------------------------------------------------------ attachment

  /** Ownership by incident (never by user): the admin may read any incident. */
  async getAttachmentFile(
    incidentId: number,
    attachmentId: number,
  ): Promise<AdminIncidentAttachmentFileDto> {
    const incident = await this.findIncident(incidentId);
    const attachment = await this.attachmentRepository.findOne({
      where: { id: attachmentId, incident_id: incident.id },
    });
    if (!attachment) {
      throw new NotFoundException(
        `Attachment with id ${attachmentId} not found`,
      );
    }
    return {
      id: attachment.id,
      incident_id: incident.id,
      storage_key: attachment.storage_key,
      original_name: attachment.original_name,
      mime: attachment.mime,
      size_bytes: Number(attachment.size_bytes),
    };
  }

  // --------------------------------------------------------------- helpers

  private async findIncident(id: number): Promise<ReservationIncidentEntity> {
    const incident = await this.incidentRepository.findOne({ where: { id } });
    if (!incident) {
      throw new NotFoundException(`Incident with id ${id} not found`);
    }
    return incident;
  }

  /**
   * Mirrors ReservationIncidentService.releaseHold without writing: the
   * checkbox is offered when resolving (or re-sending on resolved) would
   * actually unblock this incident's hold.
   */
  private async resolveReleaseHold(
    incident: ReservationIncidentEntity,
    reservation: ReservationEntity,
  ): Promise<AdminIncidentReleaseHoldDto> {
    const currency = reservation.currency ?? null;
    const canResolve =
      incident.status === INCIDENT_STATUS.RESOLVED ||
      allowedNextStatuses(incident.status).includes(INCIDENT_STATUS.RESOLVED);
    let reason: string | null = null;
    if (!canResolve) {
      reason = "status_not_resolvable";
    } else if (!incident.blocks_payout) {
      reason = "incident_not_blocking";
    } else if (reservation.payout_status !== "blocked") {
      reason = "payout_not_blocked";
    }
    const openDisputes = await this.disputeRepository.find({
      where: { reservation_id: reservation.id, status: "open" },
    });
    const otherOpen = openDisputes.filter(
      row => row.id !== incident.dispute_id,
    ).length;

    let hostAmountCents: number | null = null;
    try {
      const refundedCents = Math.round(
        Number(reservation.amount_refunded ?? 0) * 100,
      );
      hostAmountCents = this.economics.computePlatformFee(
        reservation,
        refundedCents,
      ).hostAmountCents;
    } catch (error) {
      this.logger.warn(
        `Host amount estimate failed for reservation ${reservation.id}`,
        error instanceof Error ? error.message : String(error),
      );
    }
    return {
      applicable: reason === null,
      reason,
      other_open_disputes: otherOpen,
      host_amount_cents:
        hostAmountCents !== null && Number.isFinite(hostAmountCents)
          ? hostAmountCents
          : null,
      currency,
    };
  }

  private toListItem(
    row: IncidentListRow,
    now: Date,
  ): AdminIncidentListItemDto {
    const reservationId = toInt(row.reservation_id);
    return {
      id: toInt(row.id),
      reservation_id: reservationId,
      reservation_ref: reservationRef(reservationId),
      type: row.type,
      status: row.status,
      created_at: iso(row.created_at) ?? "",
      updated_at: iso(row.updated_at) ?? "",
      age_hours: incidentAgeHours(
        row.created_at,
        row.resolved_at,
        row.status,
        now,
      ),
      blocks_payout: Boolean(Number(row.blocks_payout ?? 0)),
      dispute_id: row.dispute_id === null ? null : toInt(row.dispute_id),
      reservation_status: row.reservation_status ?? null,
      payment_status: row.payment_status ?? null,
      payout_status: row.payout_status ?? null,
      checkin: isoDate(row.checkin),
      checkout: isoDate(row.checkout),
      site_name: nonEmpty(row.site_name),
      traveler_name: nonEmpty(row.profile_name) ?? nonEmpty(row.guest_name),
      traveler_email: nonEmpty(row.profile_email) ?? nonEmpty(row.guest_email),
      message_count: toInt(row.message_count),
      attachment_count: toInt(row.attachment_count),
      last_activity_at: latestIso(
        row.updated_at,
        row.last_message_at,
        row.last_attachment_at,
      ),
    };
  }

  private toAttachmentDto(
    row: ReservationIncidentAttachmentEntity,
  ): AdminIncidentAttachmentDto {
    return {
      id: row.id,
      original_name: row.original_name,
      mime: row.mime,
      size_bytes: Number(row.size_bytes),
      uploaded_by: row.uploaded_by,
      created_at: iso(row.created_at) ?? "",
    };
  }

  private toDisputeDto(row: ReservationDisputeEntity): AdminIncidentDisputeDto {
    return {
      id: row.id,
      status: row.status,
      source: row.source,
      closed_at: iso(row.closed_at),
      created_at: iso(row.created_at),
    };
  }

  private toReservationDto(
    reservation: ReservationEntity,
    siteName: string | null,
    summary: TravelerChangeSummaryDto | null,
  ): AdminIncidentReservationDto {
    // decimal column typed as number but NULL on some legacy rows.
    const legacyTotal: unknown = reservation.total;
    const totalCents =
      reservation.total_cents ??
      (legacyTotal === null || legacyTotal === undefined
        ? null
        : Math.round(Number(legacyTotal) * 100));
    return {
      id: reservation.id,
      reservation_ref: reservationRef(reservation.id),
      status: reservation.status,
      payment_status: reservation.payment_status,
      payout_status: reservation.payout_status ?? null,
      site_id: reservation.site_id,
      site_name: siteName,
      room_id: reservation.room_id,
      room_name: summary?.room_name ?? null,
      checkin: isoDate(reservation.checkin) ?? "",
      checkout: isoDate(reservation.checkout) ?? "",
      guests: reservation.guests,
      pets: reservation.pets,
      total_cents: totalCents,
      amount_refunded_cents: Math.round(
        Number(reservation.amount_refunded ?? 0) * 100,
      ),
      currency: reservation.currency ?? null,
      guest_name: nonEmpty(reservation.guest_name),
      guest_email: nonEmpty(reservation.guest_email),
      snapshot: summary,
    };
  }

  private summarize(
    snapshot: ReservationSnapshotPayload | null,
    siteName: string | null,
  ): TravelerChangeSummaryDto | null {
    if (!snapshot?.stay) {
      return null;
    }
    try {
      return summarizeSnapshotForTraveler(snapshot, siteName);
    } catch (error) {
      this.logger.warn(
        "Incident detail snapshot summary failed",
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  /** Frozen version, else the latest one (same rule as the traveler panel). */
  private async loadSnapshotPayload(
    reservation: ReservationEntity,
  ): Promise<ReservationSnapshotPayload | null> {
    const rows = await this.snapshotRepository.find({
      where: { reservation_id: reservation.id },
    });
    const frozenVersion = reservation.snapshot_version ?? 1;
    let picked: ReservationSnapshotEntity | null = null;
    for (const row of rows) {
      if (row.version === frozenVersion) {
        picked = row;
        break;
      }
      if (!picked || row.version > picked.version) {
        picked = row;
      }
    }
    return (picked?.payload as ReservationSnapshotPayload | undefined) ?? null;
  }

  /** Legacy profile (PHP-owned table); null when missing or unreadable. */
  private async loadProfile(userId: number): Promise<ProfileRow | null> {
    try {
      const row = await this.mysqlService.queryOne<ProfileRow>(
        `SELECT name, email FROM \`${envs.DB_PREFIX}user_profiles\` WHERE id = ? LIMIT 1`,
        [userId],
      );
      return row ?? null;
    } catch (error) {
      this.logger.warn(
        `Incident detail profile lookup failed for user ${userId}`,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  private async loadSiteName(siteId: number): Promise<string | null> {
    try {
      const row = await this.mysqlService.queryOne<SiteNameRow>(
        `SELECT name FROM \`${envs.DB_PREFIX}sites1\` WHERE id = ? LIMIT 1`,
        [siteId],
      );
      return nonEmpty(row?.name);
    } catch (error) {
      this.logger.warn(
        `Incident detail site lookup failed for site ${siteId}`,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }
}
