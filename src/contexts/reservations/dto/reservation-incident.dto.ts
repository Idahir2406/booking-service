import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

import {
  INCIDENT_ATTACHMENT_KEY_PATTERN,
  INCIDENT_ATTACHMENT_MIMES,
  INCIDENT_LIMITS,
  INCIDENT_STATUSES,
  type IncidentAuthor,
  type IncidentStatus,
  type IncidentType,
  TRAVELER_INCIDENT_TYPES,
} from "../utils/reservation-incident.util";

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

/** Body of `POST /v1/traveler/:user_id/reservations/:id/incidents`. */
export class CreateIncidentDto {
  @IsIn([...TRAVELER_INCIDENT_TYPES])
  type!: IncidentType;

  @Transform(trimString)
  @IsString()
  @MinLength(INCIDENT_LIMITS.DESCRIPTION_MIN)
  @MaxLength(INCIDENT_LIMITS.DESCRIPTION_MAX)
  description!: string;
}

/**
 * Body of `POST /v1/traveler/:user_id/incidents/:incident_id/attachments`.
 * Sent only by the PHP proxy after it stored the file (finfo MIME, 5 MB,
 * random name); the browser never chooses storage_key.
 */
export class AddIncidentAttachmentDto {
  @IsString()
  @Matches(INCIDENT_ATTACHMENT_KEY_PATTERN)
  storage_key!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  original_name!: string;

  @IsIn([...INCIDENT_ATTACHMENT_MIMES])
  mime!: string;

  @IsInt()
  @Min(1)
  @Max(INCIDENT_LIMITS.MAX_ATTACHMENT_BYTES)
  size_bytes!: number;
}

/** Body of the traveler and V4P message routes. */
export class AddIncidentMessageDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(INCIDENT_LIMITS.MESSAGE_MAX)
  body!: string;
}

/** Body of `POST /v1/incidents/:incident_id/status` (V4P, internal). */
export class UpdateIncidentStatusDto {
  @IsIn([...INCIDENT_STATUSES])
  status!: IncidentStatus;

  /**
   * needs_info: shown to the traveler as a V4P message (what we need).
   * resolved: resolution_note shown to the traveler.
   */
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(INCIDENT_LIMITS.MESSAGE_MAX)
  note?: string;

  /**
   * Only with status = resolved: close the linked dispute and move the payout
   * blocked -> held when nothing else blocks it. Without it the payout stays
   * blocked (economic resolution via POST /v1/refunds/:id/review).
   */
  @IsOptional()
  @IsBoolean()
  release_hold?: boolean;
}

// ---------------------------------------------------------------- responses

export interface TravelerIncidentMessageDto {
  id: number;
  author_type: IncidentAuthor;
  body: string;
  created_at: string;
}

export interface TravelerIncidentAttachmentDto {
  id: number;
  original_name: string;
  mime: string;
  size_bytes: number;
  uploaded_by: IncidentAuthor;
  created_at: string;
}

/** Traveler view: no dispute ids, no admin notes, no storage keys. */
export interface TravelerIncidentDto {
  id: number;
  reservation_id: number;
  type: IncidentType;
  status: IncidentStatus;
  description: string;
  /** true while this incident holds the host payout (Cancel is hidden). */
  blocks_payout: boolean;
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  can_reply: boolean;
  can_attach: boolean;
  messages: TravelerIncidentMessageDto[];
  attachments: TravelerIncidentAttachmentDto[];
}

export interface TravelerIncidentListDto {
  items: TravelerIncidentDto[];
}

/** For the PHP proxy only: what to serve after the ownership check. */
export interface TravelerIncidentAttachmentFileDto {
  id: number;
  incident_id: number;
  storage_key: string;
  original_name: string;
  mime: string;
  size_bytes: number;
}

export const PAYOUT_HOLD_OUTCOME = {
  /** release_hold not asked: the payout keeps its state. */
  NOT_REQUESTED: "not_requested",
  /** blocked -> held (transitionPayout); the payout cron may release it later. */
  UNBLOCKED: "unblocked",
  /** Another open dispute/incident still holds it: stays blocked. */
  STILL_BLOCKED: "still_blocked",
  /** This incident was not holding the payout (or it is not blocked). */
  NOT_BLOCKED: "not_blocked",
} as const;

export type PayoutHoldOutcome =
  (typeof PAYOUT_HOLD_OUTCOME)[keyof typeof PAYOUT_HOLD_OUTCOME];

/** V4P view (internal route): includes the economic links. */
export interface AdminIncidentDto extends TravelerIncidentDto {
  user_id: number;
  dispute_id: number | null;
}

export interface AdminIncidentStatusResultDto {
  incident: AdminIncidentDto;
  payout_hold: PayoutHoldOutcome;
  payout_status: string | null;
}

// ------------------------------------------- "Incidencias" tab (chat, 2026-10-25)

/** Row of `GET /v1/traveler/:user_id/incidents` (grouped by site in the UI). */
export interface TravelerIncidentInboxItemDto {
  id: number;
  incident_ref: string;
  reservation_id: number;
  reservation_ref: string;
  type: IncidentType;
  status: IncidentStatus;
  blocks_payout: boolean;
  is_open: boolean;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  /** Last message (or the description when there is none), max 140 chars. */
  last_message_preview: string | null;
  last_message_author: IncidentAuthor | null;
  message_count: number;
  attachment_count: number;
  site_id: number;
  site_name: string | null;
  site_town: string | null;
  checkin: string | null;
  checkout: string | null;
}

export interface TravelerIncidentInboxDto {
  items: TravelerIncidentInboxItemDto[];
  total: number;
}

export interface TravelerIncidentThreadMessageDto extends TravelerIncidentMessageDto {
  /** "Tú" | "Equipo V4P" (the UI prefers its cv_inc_autor_* texts). */
  author_display: string;
}

/** `GET /v1/traveler/:user_id/incidents/:incident_id`: full chat. */
export interface TravelerIncidentThreadDto extends Omit<
  TravelerIncidentDto,
  "messages"
> {
  incident_ref: string;
  reservation_ref: string;
  site_id: number;
  site_name: string | null;
  site_town: string | null;
  checkin: string | null;
  checkout: string | null;
  last_activity_at: string;
  messages: TravelerIncidentThreadMessageDto[];
}
