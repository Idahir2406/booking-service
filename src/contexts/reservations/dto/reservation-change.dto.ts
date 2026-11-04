import type {
  ChangeOfferStatus,
  ChangeRequestStatus,
  ChangeRequestType,
  TravelerChangeSummaryDto,
} from "../utils/reservation-change.util";

import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

import {
  ADMIN_CHANGE_REQUEST_STATUSES,
  CHANGE_LIMITS,
  CHANGE_REQUEST_TYPES,
} from "../utils/reservation-change.util";
import {
  MAX_DECLARED_DOGS,
  ReservationDogDto,
  ReservationExtraSelectionDto,
  ReservationServiceSelectionDto,
} from "./quote-reservation.dto";

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

/** Empty strings become undefined (optional free text). */
const trimOptional = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

// ------------------------------------------------------------- traveler

/** Body of `POST /v1/traveler/:user_id/reservations/:id/change-requests`. */
export class CreateChangeRequestDto {
  @IsIn([...CHANGE_REQUEST_TYPES])
  type!: ChangeRequestType;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(CHANGE_LIMITS.MESSAGE_MAX)
  message?: string;
}

// ------------------------------------------------------------- V4P (D9)

/** Body of `POST /v1/reservation-changes/:request_id/status`. */
export class UpdateChangeRequestStatusDto {
  @IsIn([...ADMIN_CHANGE_REQUEST_STATUSES])
  status!: ChangeRequestStatus;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(CHANGE_LIMITS.NOTE_MAX)
  note?: string;
}

/**
 * Common offer fields. Anything not sent is copied from the current snapshot
 * (dates, guests, dogs, services, extras, board). The price is ALWAYS
 * computed server-side with the checkout pricing engine; V4P may only add an
 * explicit adjustment line (e.g. a discount so the change costs nothing).
 */
export class ChangeOfferBaseDto {
  @IsOptional()
  @IsDateString()
  checkin?: string;

  @IsOptional()
  @IsDateString()
  checkout?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  guests?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  board_option_id?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ReservationServiceSelectionDto)
  services?: ReservationServiceSelectionDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ReservationExtraSelectionDto)
  extras?: ReservationExtraSelectionDto[];

  @IsOptional()
  @IsInt()
  @Min(-CHANGE_LIMITS.MAX_ADJUSTMENT_CENTS)
  @Max(CHANGE_LIMITS.MAX_ADJUSTMENT_CENTS)
  adjustment_cents?: number;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(255)
  adjustment_description?: string;

  /** Applicable conditions shown to the traveler. */
  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(CHANGE_LIMITS.NOTE_MAX)
  conditions?: string;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(CHANGE_LIMITS.NOTE_MAX)
  message?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CHANGE_LIMITS.MAX_OFFER_HOURS)
  expires_in_hours?: number;
}

/** Body of `POST /v1/reservation-changes/:request_id/proposals` (+ /quote). */
export class CreateChangeProposalDto extends ChangeOfferBaseDto {
  /** Declared dogs after the change (number, weight, PPP). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DECLARED_DOGS)
  @ValidateNested({ each: true })
  @Type(() => ReservationDogDto)
  dogs?: ReservationDogDto[];
}

/**
 * Body of `POST /v1/reservation-alternatives/:reservation_id` (+ /quote).
 * The declared dogs are never overridden: the alternative must accept them.
 */
export class CreateAlternativeDto extends ChangeOfferBaseDto {
  @IsInt()
  @Min(1)
  site_id!: number;

  @IsInt()
  @Min(1)
  room_id!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  incident_id?: number;
}

/** Query of `GET /v1/reservation-changes`. */
export class ListChangeRequestsQueryDto {
  @IsOptional()
  @Transform(trimString)
  @IsIn(["open", "all"])
  scope?: "open" | "all";
}

// ------------------------------------------------------------ responses

export interface TravelerChangeProposalDto {
  id: number;
  request_id: number;
  /** Effective: a pending proposal past expires_at is "expired". */
  status: ChangeOfferStatus;
  before: TravelerChangeSummaryDto;
  after: TravelerChangeSummaryDto;
  previous_total_cents: number;
  new_total_cents: number;
  amount_delta_cents: number;
  currency: string;
  conditions: string | null;
  message: string | null;
  expires_at: string;
  responded_at: string | null;
  /** D8: delta > 0 is paid outside the panel (V4P contacts the traveler). */
  requires_payment: boolean;
  /** delta < 0: amount refunded to the card when accepted. */
  refund_cents: number;
  can_accept: boolean;
  can_reject: boolean;
}

export interface TravelerChangeRequestDto {
  id: number;
  reservation_id: number;
  type: ChangeRequestType;
  message: string | null;
  /** Effective: proposal_sent without a live proposal shows in_review. */
  status: ChangeRequestStatus;
  response_note: string | null;
  created_at: string;
  updated_at: string;
  can_cancel: boolean;
  proposals: TravelerChangeProposalDto[];
}

export interface TravelerAlternativeDto {
  id: number;
  reservation_id: number;
  status: ChangeOfferStatus;
  before: TravelerChangeSummaryDto;
  after: TravelerChangeSummaryDto;
  previous_total_cents: number;
  new_total_cents: number;
  amount_delta_cents: number;
  currency: string;
  compatible_with_dogs: boolean | null;
  conditions: string | null;
  message: string | null;
  expires_at: string;
  responded_at: string | null;
  requires_payment: boolean;
  refund_cents: number;
  can_accept: boolean;
  can_reject: boolean;
}

export interface TravelerChangesDto {
  requests: TravelerChangeRequestDto[];
  alternatives: TravelerAlternativeDto[];
  can_request_change: boolean;
  change_types: ChangeRequestType[];
}

export interface ChangeAcceptResultDto {
  applied: boolean;
  snapshot_version: number;
  previous_snapshot_version: number;
  amount_delta_cents: number;
  refund_cents: number;
  refund_initiated: boolean;
}

export interface TravelerProposalAcceptResultDto extends ChangeAcceptResultDto {
  proposal: TravelerChangeProposalDto;
}

export interface TravelerAlternativeAcceptResultDto extends ChangeAcceptResultDto {
  alternative: TravelerAlternativeDto;
}

/** V4P dry run (`.../quote`): what the offer would be, nothing stored. */
export interface ChangeOfferQuoteDto {
  valid: boolean;
  errors: string[];
  dogs_compatible: boolean | null;
  before: TravelerChangeSummaryDto;
  after: TravelerChangeSummaryDto;
  amount_delta_cents: number;
  acceptable_in_panel: boolean;
}

export interface AdminChangeRequestDto extends TravelerChangeRequestDto {
  user_id: number;
}
