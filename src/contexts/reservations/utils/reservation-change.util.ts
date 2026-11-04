import type { PriceLineDraft } from "../../payments/domain/price-lines";
import type { ServiceSelectionType } from "../../payments/domain/reservation-pricing";
import type {
  ReservationSnapshotPayload,
  SnapshotBoard,
  SnapshotCompatibility,
  SnapshotDog,
  SnapshotDogPolicy,
  SnapshotF2Extension,
  SnapshotRoom,
  SnapshotSelectedExtra,
  SnapshotSelectedService,
} from "../../payments/domain/reservation-snapshot";
import type {
  ReservationBoardSnapshot,
  ReservationEntity,
} from "../entities/reservation.entity";

import { summarizePriceLines } from "../../payments/domain/price-lines";
import { SERVICE_SELECTION_TYPE } from "../../payments/domain/reservation-pricing";
import {
  buildRefundRule,
  buildReservationSnapshotPayload,
} from "../../payments/domain/reservation-snapshot";
import { defineStateMachine } from "../../payments/domain/state-machine";
import { PRICE_LINE_TYPE } from "../../payments/entities/reservation-price-line.entity";
import { parseIsoDateAtUtcMidnight } from "./reservation-policy.util";

/**
 * F-PV7b — change requests, change proposals and accommodation alternatives
 * (D8: no extra charge in V1; D9: proposals/alternatives only by V4P through
 * internal routes). Pure catalog + rules shared by the services (validation),
 * the panel (capabilities / alerts) and the tests.
 */

// ------------------------------------------------------------------ requests

/** PDF §8: "¿Necesitas cambiar tu reserva?" types. */
export const CHANGE_REQUEST_TYPE = {
  ADD_NIGHTS: "add_nights",
  CHANGE_DATES: "change_dates",
  TRAVELERS: "travelers",
  DOGS: "dogs",
  EXTRAS: "extras",
  OTHER: "other",
} as const;

export type ChangeRequestType =
  (typeof CHANGE_REQUEST_TYPE)[keyof typeof CHANGE_REQUEST_TYPE];

export const CHANGE_REQUEST_TYPES = Object.values(CHANGE_REQUEST_TYPE);

/** Request life cycle (functional labels cv_chg_status_*; never shown raw). */
export const CHANGE_REQUEST_STATUS = {
  RECEIVED: "received",
  IN_REVIEW: "in_review",
  PROPOSAL_SENT: "proposal_sent",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
} as const;

export type ChangeRequestStatus =
  (typeof CHANGE_REQUEST_STATUS)[keyof typeof CHANGE_REQUEST_STATUS];

export const CHANGE_REQUEST_STATUSES = Object.values(CHANGE_REQUEST_STATUS);

export const OPEN_CHANGE_REQUEST_STATUSES: readonly ChangeRequestStatus[] = [
  CHANGE_REQUEST_STATUS.RECEIVED,
  CHANGE_REQUEST_STATUS.IN_REVIEW,
  CHANGE_REQUEST_STATUS.PROPOSAL_SENT,
];

export function isOpenChangeRequestStatus(
  status: ChangeRequestStatus,
): boolean {
  return OPEN_CHANGE_REQUEST_STATUSES.includes(status);
}

const R = CHANGE_REQUEST_STATUS;

/**
 * - V4P: received -> in_review | proposal_sent | rejected (not possible).
 * - A proposal expires / becomes invalid: proposal_sent -> in_review.
 * - Traveler: accepts the proposal (-> accepted), keeps the current
 *   reservation or withdraws the request (-> cancelled).
 */
export const changeRequestStateMachine =
  defineStateMachine<ChangeRequestStatus>({
    name: "change_request",
    states: CHANGE_REQUEST_STATUSES,
    initial: [R.RECEIVED],
    transitions: {
      [R.RECEIVED]: [R.IN_REVIEW, R.PROPOSAL_SENT, R.REJECTED, R.CANCELLED],
      [R.IN_REVIEW]: [R.PROPOSAL_SENT, R.REJECTED, R.CANCELLED],
      [R.PROPOSAL_SENT]: [R.IN_REVIEW, R.ACCEPTED, R.REJECTED, R.CANCELLED],
      [R.ACCEPTED]: [],
      [R.REJECTED]: [],
      [R.CANCELLED]: [],
    },
  });

/** Statuses V4P may set by hand (POST reservation-changes/:id/status). */
export const ADMIN_CHANGE_REQUEST_STATUSES: readonly ChangeRequestStatus[] = [
  CHANGE_REQUEST_STATUS.IN_REVIEW,
  CHANGE_REQUEST_STATUS.REJECTED,
];

// ------------------------------------------------- proposals + alternatives

/** Shared by reservation_change_proposals and reservation_alternatives. */
export const CHANGE_OFFER_STATUS = {
  PENDING_TRAVELER: "pending_traveler",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  EXPIRED: "expired",
} as const;

export type ChangeOfferStatus =
  (typeof CHANGE_OFFER_STATUS)[keyof typeof CHANGE_OFFER_STATUS];

export const CHANGE_OFFER_STATUSES = Object.values(CHANGE_OFFER_STATUS);

const O = CHANGE_OFFER_STATUS;

export const changeOfferStateMachine = defineStateMachine<ChangeOfferStatus>({
  name: "change_offer",
  states: CHANGE_OFFER_STATUSES,
  initial: [O.PENDING_TRAVELER],
  transitions: {
    [O.PENDING_TRAVELER]: [O.ACCEPTED, O.REJECTED, O.EXPIRED],
    [O.ACCEPTED]: [],
    [O.REJECTED]: [],
    [O.EXPIRED]: [],
  },
});

export const CHANGE_LIMITS = {
  MESSAGE_MAX: 1000,
  NOTE_MAX: 2000,
  /** Plan F-PV7b: one open request per reservation. */
  MAX_OPEN_REQUESTS_PER_RESERVATION: 1,
  /** Anti-spam: total requests per reservation (open or not). */
  MAX_REQUESTS_PER_RESERVATION: 10,
  DEFAULT_OFFER_HOURS: 72,
  MAX_OFFER_HOURS: 14 * 24,
  /** |adjustment| V4P may add to a proposal (goodwill / correction line). */
  MAX_ADJUSTMENT_CENTS: 1_000_000,
} as const;

/** Stable error codes (body.code) of the traveler/V4P change routes. */
export const CHANGE_ERROR = {
  NOT_ELIGIBLE: "not_eligible",
  OPEN_REQUEST_EXISTS: "open_request_exists",
  REQUEST_CLOSED: "request_closed",
  OFFER_CLOSED: "offer_closed",
  OFFER_EXPIRED: "offer_expired",
  /** D8: delta > 0 cannot be accepted in the panel until F-PV7c. */
  PAYMENT_REQUIRED: "payment_required",
  UNAVAILABLE: "unavailable",
  DOGS_INCOMPATIBLE: "dogs_incompatible",
  /** The reservation changed (other snapshot version) after the offer. */
  OFFER_OUTDATED: "offer_outdated",
  SNAPSHOT_REQUIRED: "snapshot_required",
  REFUND_NOT_POSSIBLE: "refund_not_possible",
  INVALID_CHANGE: "invalid_change",
} as const;

export type ChangeErrorCode = (typeof CHANGE_ERROR)[keyof typeof CHANGE_ERROR];

export const CHANGE_KIND = {
  PROPOSAL: "change_proposal",
  ALTERNATIVE: "alternative",
} as const;

export type ChangeKind = (typeof CHANGE_KIND)[keyof typeof CHANGE_KIND];

// --------------------------------------------------------------- rules

export type ChangeEligibilityInput = Pick<
  ReservationEntity,
  "status" | "payment_status" | "checkin"
>;

/**
 * Upcoming confirmed and paid reservation (also after a partial refund from a
 * previous accepted change), check-in strictly after today (UTC date). Never
 * cancelled, finalized or pending payment.
 */
export function isChangeEligibleReservation(
  reservation: ChangeEligibilityInput,
  now: Date,
): boolean {
  if (reservation.status !== "confirmed") {
    return false;
  }
  if (
    reservation.payment_status !== "paid" &&
    reservation.payment_status !== "partially_refunded"
  ) {
    return false;
  }
  const checkinMs = parseIsoDateAtUtcMidnight(
    String(reservation.checkin).slice(0, 10),
  ).getTime();
  const todayMs = parseIsoDateAtUtcMidnight(
    now.toISOString().slice(0, 10),
  ).getTime();
  return Number.isFinite(checkinMs) && checkinMs > todayMs;
}

export interface ChangeOfferTimingInput {
  status: ChangeOfferStatus;
  expires_at: Date | string;
}

/** A pending offer past expires_at is shown (and later stored) as expired. */
export function effectiveOfferStatus(
  offer: ChangeOfferTimingInput,
  now: Date,
): ChangeOfferStatus {
  if (offer.status !== CHANGE_OFFER_STATUS.PENDING_TRAVELER) {
    return offer.status;
  }
  const expiresMs = new Date(offer.expires_at).getTime();
  return Number.isFinite(expiresMs) && expiresMs > now.getTime()
    ? CHANGE_OFFER_STATUS.PENDING_TRAVELER
    : CHANGE_OFFER_STATUS.EXPIRED;
}

export function isLiveOffer(offer: ChangeOfferTimingInput, now: Date): boolean {
  return (
    effectiveOfferStatus(offer, now) === CHANGE_OFFER_STATUS.PENDING_TRAVELER
  );
}

/**
 * expires_at = now + hours, never after the current check-in (00:00 UTC).
 * null when that leaves no time at all.
 */
export function resolveOfferExpiry(
  now: Date,
  hours: number,
  checkin: string,
): Date | null {
  const wanted = now.getTime() + hours * 60 * 60 * 1000;
  const checkinMs = parseIsoDateAtUtcMidnight(
    String(checkin).slice(0, 10),
  ).getTime();
  const capped = Number.isFinite(checkinMs)
    ? Math.min(wanted, checkinMs)
    : wanted;
  return capped > now.getTime() ? new Date(capped) : null;
}

// ------------------------------------------------------ change payloads

/** Plain shape of QuoteReservationDto (what the quote engine reprices). */
export interface ChangeQuoteDog {
  name?: string;
  weight_kg: number;
  is_ppp: boolean;
  room_id?: number;
  saved_dog_id?: number;
}

export interface ChangeQuoteService {
  type: ServiceSelectionType;
  id: number;
  quantity?: number;
}

export interface ChangeQuoteExtra {
  id: number;
}

export interface ChangeQuoteInput {
  site_id: number;
  room_id: number;
  checkin: string;
  checkout: string;
  guests: number;
  board_option_id?: number;
  dogs: ChangeQuoteDog[];
  services: ChangeQuoteService[];
  extras: ChangeQuoteExtra[];
}

/** Reservation fields an accepted change writes (legacy JSON included). */
export interface ChangeTarget {
  site_id: number;
  room_id: number;
  checkin: string;
  checkout: string;
  guests: number;
  pets: number;
  board_option_id: number | null;
  board_snapshot: ReservationBoardSnapshot | null;
  extras_snapshot: ChangeExtrasSnapshot;
}

export interface ChangeExtrasSnapshot {
  services: SnapshotSelectedService[];
  extras: SnapshotSelectedExtra[];
}

/** after_payload / proposal_payload: the frozen offer (never repriced). */
export interface ChangeOfferPayload {
  target: ChangeTarget;
  /** Exact quote input, re-validated at accept time (availability/dogs). */
  quote: ChangeQuoteInput;
  /** Snapshot payload the accepted change writes as version n+1. */
  snapshot: ReservationSnapshotPayload;
  site_name: string | null;
}

/** before_payload: the reservation as it was when the offer was made. */
export interface ChangeBasePayload {
  snapshot: ReservationSnapshotPayload;
  site_name: string | null;
}

/** Overrides V4P sends; everything else is copied from the snapshot. */
export interface ChangeOverrides {
  site_id?: number;
  room_id?: number;
  checkin?: string;
  checkout?: string;
  guests?: number;
  board_option_id?: number;
  dogs?: ChangeQuoteDog[];
  services?: ChangeQuoteService[];
  extras?: ChangeQuoteExtra[];
}

const SERVICE_TYPES: readonly string[] = Object.values(SERVICE_SELECTION_TYPE);

function snapshotList<T>(
  snapshot: ReservationSnapshotPayload,
  key: string,
): T[] {
  const value = snapshot[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

function snapshotField<T>(
  snapshot: ReservationSnapshotPayload,
  key: string,
): T | null {
  const value = snapshot[key];
  return value === undefined || value === null ? null : (value as T);
}

export function snapshotDogs(
  snapshot: ReservationSnapshotPayload,
): SnapshotDog[] {
  return snapshotList<SnapshotDog>(snapshot, "dogs");
}

/**
 * Quote input for an offer: the current reservation as frozen in the
 * snapshot + V4P overrides. Dogs keep their unit only on the same room.
 */
export function buildChangeQuoteInput(
  reservation: Pick<
    ReservationEntity,
    "site_id" | "room_id" | "board_option_id"
  >,
  snapshot: ReservationSnapshotPayload,
  overrides: ChangeOverrides,
): ChangeQuoteInput {
  const siteId = overrides.site_id ?? reservation.site_id;
  const roomId = overrides.room_id ?? reservation.room_id;
  const sameRoom =
    siteId === reservation.site_id && roomId === reservation.room_id;
  const dogs: ChangeQuoteDog[] =
    overrides.dogs ??
    snapshotDogs(snapshot).map(dog => {
      const out: ChangeQuoteDog = {
        weight_kg: Number(dog.weight_kg),
        is_ppp: Boolean(dog.is_ppp),
      };
      if (dog.name) {
        out.name = dog.name;
      }
      if (sameRoom && dog.room_id) {
        out.room_id = dog.room_id;
      }
      if (dog.saved_dog_id) {
        out.saved_dog_id = dog.saved_dog_id;
      }
      return out;
    });
  const services: ChangeQuoteService[] =
    overrides.services ??
    snapshotList<SnapshotSelectedService>(snapshot, "services")
      .filter(service => SERVICE_TYPES.includes(service.type))
      .map(service => ({
        type: service.type as ServiceSelectionType,
        id: service.id,
        quantity: service.quantity,
      }));
  // Extras / board are per unit: another room keeps none unless V4P says so.
  const extras: ChangeQuoteExtra[] =
    overrides.extras ??
    (sameRoom
      ? snapshotList<SnapshotSelectedExtra>(snapshot, "extras").map(extra => ({
          id: extra.id,
        }))
      : []);
  const boardId =
    overrides.board_option_id ??
    (sameRoom
      ? (reservation.board_option_id ?? snapshot.board?.id ?? undefined)
      : undefined);

  const input: ChangeQuoteInput = {
    site_id: siteId,
    room_id: roomId,
    checkin: overrides.checkin ?? snapshot.stay.checkin,
    checkout: overrides.checkout ?? snapshot.stay.checkout,
    guests: overrides.guests ?? snapshot.stay.guests,
    dogs,
    services,
    extras,
  };
  if (boardId !== undefined && boardId !== null) {
    input.board_option_id = boardId;
  }
  return input;
}

/** Adjustment line V4P may add (negative = discount to match the price). */
export function buildAdjustmentLine(
  cents: number,
  description: string | null | undefined,
): PriceLineDraft {
  return {
    type: PRICE_LINE_TYPE.ADJUSTMENT,
    description:
      description && description.trim() !== ""
        ? description.trim().slice(0, 255)
        : "Ajuste V4P",
    quantity: 1,
    unit_amount_cents: cents,
    amount_cents: cents,
    is_optional: false,
    is_commissionable: true,
    is_penalizable: true,
    metadata: { reason: "change_offer_adjustment" },
  };
}

export interface ChangedSnapshotInput {
  previous: ReservationSnapshotPayload;
  reservation: Pick<
    ReservationEntity,
    "commission_rate" | "commission_cents" | "timezone"
  >;
  quote: ChangeQuoteInput;
  nights: number;
  pets: number;
  room: SnapshotRoom | null;
  board: SnapshotBoard | null;
  lines: PriceLineDraft[];
  extension: SnapshotF2Extension;
  source: string;
}

/**
 * New snapshot payload for an offer (same builder as checkout). The frozen
 * cancellation terms of the booking are kept (later host changes never
 * apply); only the legacy deadline follows the new check-in. Commission rate
 * and cents stay the ones frozen on the reservation (commission untouched).
 */
export function buildChangedSnapshotPayload(
  input: ChangedSnapshotInput,
): ReservationSnapshotPayload {
  const totals = summarizePriceLines(input.lines);
  const previousRule = input.previous.refund_policy;
  const payload = buildReservationSnapshotPayload({
    stay: {
      site_id: input.quote.site_id,
      checkin: input.quote.checkin.slice(0, 10),
      checkout: input.quote.checkout.slice(0, 10),
      nights: input.nights,
      guests: input.quote.guests,
      pets: input.pets,
    },
    room: input.room,
    board: input.board,
    currency: input.previous.currency,
    lines: input.lines,
    totals,
    commissionRate: input.reservation.commission_rate ?? null,
    commissionCents: input.reservation.commission_cents ?? null,
    timezone: input.previous.timezone ?? input.reservation.timezone ?? null,
    deadlineLocalTime: previousRule.deadline_local_time ?? null,
    source: input.source,
    commissionBase: "commissionable",
    extension: input.extension,
  });
  const rule = buildRefundRule(
    input.quote.checkin.slice(0, 10),
    previousRule.deadline_local_time ?? null,
    previousRule.timezone ?? null,
  );
  payload.refund_policy = {
    ...rule,
    ...(previousRule.cancellation
      ? { cancellation: structuredClone(previousRule.cancellation) }
      : {}),
    ...(previousRule.generated_text
      ? { generated_text: previousRule.generated_text }
      : {}),
  };
  return payload;
}

// ------------------------------------------------------------- display

export interface TravelerChangeDogDto {
  name: string | null;
  weight_kg: number;
  is_ppp: boolean;
  size_name: string | null;
}

export interface TravelerChangeItemDto {
  name: string;
  quantity: number;
  amount_cents: number;
}

/** Dog Friendly conditions of the unit (alternatives: before vs after). */
export interface TravelerDogConditionsDto {
  compatible: boolean | null;
  max_dogs: number | null;
  max_size_name: string | null;
  max_size_unlimited: boolean;
  ppp_allowed: boolean | null;
  left_alone: string | null;
  supplement_total_cents: number;
  deposit_required: boolean | null;
  deposit_amount_cents: number | null;
}

export interface TravelerChangeSummaryDto {
  site_id: number;
  site_name: string | null;
  room_name: string | null;
  checkin: string;
  checkout: string;
  nights: number;
  guests: number;
  dogs_count: number;
  dogs: TravelerChangeDogDto[];
  board_name: string | null;
  services: TravelerChangeItemDto[];
  extras: TravelerChangeItemDto[];
  total_cents: number;
  currency: string;
  dog_conditions: TravelerDogConditionsDto | null;
}

export function toDogConditions(
  snapshot: ReservationSnapshotPayload,
): TravelerDogConditionsDto | null {
  const policy = snapshotField<SnapshotDogPolicy>(snapshot, "dog_policy");
  const compatibility = snapshotField<SnapshotCompatibility>(
    snapshot,
    "compatibility",
  );
  if (!policy && !compatibility) {
    return null;
  }
  return {
    compatible: compatibility ? Boolean(compatibility.compatible) : null,
    max_dogs: policy?.max_dogs ?? null,
    max_size_name: policy?.max_size?.name ?? null,
    max_size_unlimited: Boolean(policy?.max_size_unlimited),
    ppp_allowed: policy?.ppp_allowed ?? null,
    left_alone: policy?.left_alone ?? null,
    supplement_total_cents: Number(policy?.supplement_total_cents ?? 0),
    deposit_required: policy?.deposit.required ?? null,
    deposit_amount_cents: policy?.deposit.amount_cents ?? null,
  };
}

/** Compact, enum-free view of a snapshot for the before/after table. */
export function summarizeSnapshotForTraveler(
  snapshot: ReservationSnapshotPayload,
  siteName: string | null,
): TravelerChangeSummaryDto {
  const dogs = snapshotDogs(snapshot);
  return {
    site_id: snapshot.stay.site_id,
    site_name: siteName,
    room_name: snapshot.room?.name ?? null,
    checkin: snapshot.stay.checkin,
    checkout: snapshot.stay.checkout,
    nights: snapshot.stay.nights,
    guests: snapshot.stay.guests,
    dogs_count: dogs.length > 0 ? dogs.length : snapshot.stay.pets,
    dogs: dogs.map(dog => ({
      name: dog.name ?? null,
      weight_kg: Number(dog.weight_kg),
      is_ppp: Boolean(dog.is_ppp),
      size_name: dog.size?.name ?? null,
    })),
    board_name: snapshot.board?.name ?? null,
    services: snapshotList<SnapshotSelectedService>(snapshot, "services").map(
      service => ({
        name: service.name,
        quantity: Number(service.quantity),
        amount_cents: Number(service.amount_cents),
      }),
    ),
    extras: snapshotList<SnapshotSelectedExtra>(snapshot, "extras").map(
      extra => ({
        name: extra.name,
        quantity: 1,
        amount_cents: Number(extra.amount_cents),
      }),
    ),
    total_cents: Number(snapshot.total_cents),
    currency: snapshot.currency,
    dog_conditions: toDogConditions(snapshot),
  };
}
