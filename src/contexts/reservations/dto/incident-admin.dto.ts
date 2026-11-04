import type { TravelerChangeSummaryDto } from "../utils/reservation-change.util";
import type {
  IncidentAuthor,
  IncidentStatus,
  IncidentType,
} from "../utils/reservation-incident.util";

import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

import {
  INCIDENT_LIST_LIMITS,
  INCIDENT_LIST_STATUS_FILTER_OPEN,
} from "../utils/incident-admin.util";
import {
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
} from "../utils/reservation-incident.util";

const ISO_DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

interface RawTransformParams {
  value: unknown;
  key: string;
  obj: Record<string, unknown>;
}

/**
 * The global ValidationPipe uses enableImplicitConversion, which runs BEFORE
 * @Transform ("" → 0, "false" → true). These helpers read the raw query value.
 */
const raw = ({ value, key, obj }: RawTransformParams): unknown =>
  Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : value;

/** "" (empty filter in a GET form) → undefined. */
const emptyToUndefined = (params: RawTransformParams): unknown =>
  raw(params) === "" ? undefined : params.value;

const toBoolean = (params: RawTransformParams): unknown => {
  const value = raw(params);
  if (value === "" || value === undefined || value === null) {
    return undefined;
  }
  if (value === true || value === "true" || value === "1") {
    return true;
  }
  if (value === false || value === "false" || value === "0") {
    return false;
  }
  return value;
};

/** Query of `GET /v1/incidents` (internal, admino inbox). */
export class ListIncidentsQueryDto {
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn([...INCIDENT_STATUSES, INCIDENT_LIST_STATUS_FILTER_OPEN])
  status?: IncidentStatus | typeof INCIDENT_LIST_STATUS_FILTER_OPEN;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn([...INCIDENT_TYPES])
  type?: IncidentType;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  blocks_payout?: boolean;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @Matches(ISO_DATE)
  from?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @Matches(ISO_DATE)
  to?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(INCIDENT_LIST_LIMITS.Q_MAX)
  q?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INCIDENT_LIST_LIMITS.MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @Transform(emptyToUndefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(INCIDENT_LIST_LIMITS.MAX_OFFSET)
  offset?: number;
}

// ---------------------------------------------------------------- responses

export interface AdminIncidentListItemDto {
  id: number;
  reservation_id: number;
  /** "#RES-{reservation_id}" (what V4P and the traveler see). */
  reservation_ref: string;
  type: IncidentType;
  status: IncidentStatus;
  created_at: string;
  updated_at: string;
  /** Hours since created_at (until resolved_at when resolved). */
  age_hours: number;
  blocks_payout: boolean;
  dispute_id: number | null;
  reservation_status: string | null;
  payment_status: string | null;
  payout_status: string | null;
  checkin: string | null;
  checkout: string | null;
  site_name: string | null;
  traveler_name: string | null;
  traveler_email: string | null;
  message_count: number;
  attachment_count: number;
  last_activity_at: string | null;
}

export interface AdminIncidentListDto {
  items: AdminIncidentListItemDto[];
  total: number;
  limit: number;
  offset: number;
  /** Per status with the other filters applied (inbox counters). */
  status_counts: Record<IncidentStatus, number>;
}

export interface AdminIncidentActorDto {
  id: number | null;
  name: string | null;
}

export interface AdminIncidentTimelineMessageDto {
  id: number;
  author_type: IncidentAuthor;
  body: string;
  created_at: string;
  /** admino user that wrote it (null for traveler or legacy "v4p"). */
  actor: AdminIncidentActorDto | null;
}

/** Metadata only: never storage_key nor a path. */
export interface AdminIncidentAttachmentDto {
  id: number;
  original_name: string;
  mime: string;
  size_bytes: number;
  uploaded_by: IncidentAuthor;
  created_at: string;
}

export interface AdminIncidentHistoryEntryDto {
  event_type: string;
  created_at: string;
  from: string | null;
  to: string | null;
  release_hold: boolean | null;
  payout_hold: string | null;
  actor: AdminIncidentActorDto | null;
}

export interface AdminIncidentDisputeDto {
  id: number;
  status: string;
  source: string;
  closed_at: string | null;
  created_at: string | null;
}

export interface AdminIncidentTravelerDto {
  user_id: number;
  name: string | null;
  email: string | null;
}

export interface AdminIncidentReservationDto {
  id: number;
  reservation_ref: string;
  status: string;
  payment_status: string;
  payout_status: string | null;
  site_id: number;
  site_name: string | null;
  room_id: number;
  room_name: string | null;
  checkin: string;
  checkout: string;
  guests: number;
  pets: number;
  total_cents: number | null;
  amount_refunded_cents: number;
  currency: string | null;
  guest_name: string | null;
  guest_email: string | null;
  /** Frozen snapshot summary (dogs, board, services); null for legacy rows. */
  snapshot: TravelerChangeSummaryDto | null;
}

export interface AdminIncidentReleaseHoldDto {
  /** The "Liberar pago al anfitrión" checkbox can be offered. */
  applicable: boolean;
  /** Why not (stable code) when not applicable. */
  reason: string | null;
  /** Other open disputes keep the payout blocked even after release. */
  other_open_disputes: number;
  /** Estimated host transfer once the payout is released (cents). */
  host_amount_cents: number | null;
  currency: string | null;
}

/** Punto 6: what confirming a host no-show would do (no_show incidents only). */
export interface AdminIncidentNoShowQuoteDto {
  /** "full_total" | "same_as_cancellation" | null (legacy, 100 % retained). */
  no_show_policy: string | null;
  paid_cents: number;
  penalty_cents: number;
  refund_cents: number;
  /** Host transfer after the refund (cents). */
  host_amount_cents: number | null;
  currency: string | null;
  /** Confirm/reject buttons are offered (incident still open). */
  can_resolve: boolean;
}

export interface AdminIncidentDetailDto {
  id: number;
  reservation_id: number;
  reservation_ref: string;
  type: IncidentType;
  status: IncidentStatus;
  description: string;
  blocks_payout: boolean;
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  age_hours: number;
  traveler: AdminIncidentTravelerDto;
  messages: AdminIncidentTimelineMessageDto[];
  attachments: AdminIncidentAttachmentDto[];
  history: AdminIncidentHistoryEntryDto[];
  dispute: AdminIncidentDisputeDto | null;
  reservation: AdminIncidentReservationDto;
  allowed_next_statuses: IncidentStatus[];
  release_hold: AdminIncidentReleaseHoldDto;
  /** Admin messages are accepted only while the incident is open. */
  can_message: boolean;
  no_show_quote: AdminIncidentNoShowQuoteDto | null;
}

/** For the admino proxy only: what to stream after the ownership check. */
export interface AdminIncidentAttachmentFileDto {
  id: number;
  incident_id: number;
  storage_key: string;
  original_name: string;
  mime: string;
  size_bytes: number;
}
