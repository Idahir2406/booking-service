import type { CancellationPolicyDefinition } from "./cancellation-policy";
import type { Cents, Rate } from "../utils/money.util";
import type { PriceLineDraft, PriceLinesSummary } from "./price-lines";

import {
  getRefundDeadlineUtc,
  REFUND_WINDOW_MS,
} from "../../reservations/utils/reservation-policy.util";

export const SNAPSHOT_SCHEMA_VERSION = 1;

/** Refund rule in force today (host-initiated, 24 h before check-in, UTC). */
export const CURRENT_REFUND_RULE =
  "legacy_host_full_refund_until_24h_before_checkin";

export interface SnapshotRoom {
  id: number;
  name: string | null;
  max_guests: number | null;
  max_pets: number | null;
  price_per_night_cents: Cents | null;
}

export interface SnapshotBoard {
  id: number | null;
  code: string;
  name: string;
  is_included: boolean;
  price_cents: Cents;
  amount_cents: Cents;
}

export interface SnapshotStay {
  site_id: number;
  checkin: string;
  checkout: string;
  nights: number;
  guests: number;
  pets: number;
}

export interface SnapshotCommission {
  rate: Rate | null;
  cents: Cents | null;
  base: "total" | "commissionable";
  commissionable_cents: Cents;
  penalizable_cents: Cents;
}

export interface SnapshotRefundRule {
  rule: string;
  window_hours: number;
  refund_deadline: string;
  deadline_local_time: string | null;
  timezone: string | null;
  /**
   * Política estructurada congelada. Ausente en snapshots legacy (24 h).
   * Los cambios posteriores del alojamiento no reescriben este objeto.
   */
  cancellation?: CancellationPolicyDefinition | null;
  generated_text?: string | null;
}

/** Traveler dog as declared at booking time (C2: weight + derived size). */
export interface SnapshotDog {
  index: number;
  name: string | null;
  weight_kg: number;
  is_ppp: boolean;
  room_id: number;
  size: { id: number; name: string; slug: string; rank: number } | null;
  /**
   * traveler_dogs.id the dog was picked from (verified owned by the booking
   * traveler at checkout). Absent in older snapshots and for typed-in dogs.
   * Link only: the saved dog may change or be deleted later; the frozen
   * fields above never follow it.
   */
  saved_dog_id?: number;
}

export interface SnapshotDogZone {
  zone_id: number;
  slug: string | null;
  name: string | null;
  allows_dining: boolean;
  other_text: string | null;
}

/** C6/A26: informative only, V4P never charges it. */
export interface SnapshotDeposit {
  required: boolean | null;
  amount_cents: Cents | null;
  return_mode: string | null;
  return_days: number | null;
  charged_by_v4p: false;
  message: string | null;
}

export interface SnapshotDogSizeRef {
  id: number;
  name: string;
  slug: string;
  rank: number;
}

/** C7: unit dog policy frozen at booking (later host changes never apply). */
export interface SnapshotDogPolicy {
  policy_id: number | null;
  room_id: number;
  species_id: number | null;
  complete: boolean;
  max_size: SnapshotDogSizeRef | null;
  max_size_unlimited: boolean;
  /** Every size admitted (cumulative by rank). */
  admitted_sizes: SnapshotDogSizeRef[];
  ppp_allowed: boolean | null;
  max_dogs: number | null;
  max_dogs_source: string;
  supplement_mode: string | null;
  supplement_amount_cents: Cents | null;
  supplement_total_cents: Cents;
  left_alone: string | null;
  left_alone_conditions: string | null;
  common_zones_answered: boolean | null;
  dining_zones_answered: boolean | null;
  zones: SnapshotDogZone[];
  full_unit_access: boolean | null;
  deposit: SnapshotDeposit;
  notes: string | null;
}

export interface SnapshotCompatibility {
  mode: string;
  compatible: boolean;
  dogs_declared: boolean;
}

/** Paid dog supply / additional service chosen by the traveler. */
export interface SnapshotSelectedService {
  type: string;
  id: number;
  name: string;
  pricing_mode: string;
  price_cents: Cents;
  quantity: number;
  amount_cents: Cents;
}

export interface SnapshotSelectedExtra {
  id: number;
  name: string;
  pricing_mode: string;
  price_cents: Cents;
  amount_cents: Cents;
}

/** F2 additions to the v1 payload (all optional for legacy/manual rows). */
export interface SnapshotF2Extension {
  dogs: SnapshotDog[];
  compatibility: SnapshotCompatibility;
  dog_policy: SnapshotDogPolicy | null;
  services: SnapshotSelectedService[];
  extras: SnapshotSelectedExtra[];
  deposit: SnapshotDeposit | null;
  /** null until a data source exists (see F2 doc). */
  tourist_tax: null;
}

export interface ReservationSnapshotPayload {
  schema: number;
  /** "f1" (accommodation + board) | "f2" (complete price). */
  pricing_version?: string;
  stay: SnapshotStay;
  room: SnapshotRoom | null;
  board: SnapshotBoard | null;
  currency: string;
  total_cents: Cents;
  price_lines: PriceLineDraft[];
  totals: PriceLinesSummary;
  commission: SnapshotCommission;
  refund_policy: SnapshotRefundRule;
  timezone: string | null;
  source: string;
  [key: string]: unknown;
}

export interface BuildSnapshotInput {
  stay: SnapshotStay;
  room: SnapshotRoom | null;
  board: SnapshotBoard | null;
  currency: string;
  lines: PriceLineDraft[];
  totals: PriceLinesSummary;
  commissionRate: Rate | null;
  commissionCents: Cents | null;
  timezone: string | null;
  deadlineLocalTime: string | null;
  source: string;
  /** "total" for legacy rows (F1/backfill), "commissionable" from F2. */
  commissionBase?: SnapshotCommission["base"];
  /** F2 payload additions (dogs, dog policy, services, deposit...). */
  extension?: SnapshotF2Extension | null;
}

export function buildRefundRule(
  checkin: string,
  deadlineLocalTime: string | null,
  timezone: string | null,
): SnapshotRefundRule {
  return {
    rule: CURRENT_REFUND_RULE,
    window_hours: REFUND_WINDOW_MS / 3_600_000,
    refund_deadline: getRefundDeadlineUtc(checkin).toISOString(),
    deadline_local_time: deadlineLocalTime,
    timezone,
  };
}

export function buildReservationSnapshotPayload(
  input: BuildSnapshotInput,
): ReservationSnapshotPayload {
  // Deep copy: the payload must never share references with live policy /
  // quote objects (C7: later host changes must not alter a stored snapshot).
  const extension = input.extension ? structuredClone(input.extension) : null;
  return {
    schema: SNAPSHOT_SCHEMA_VERSION,
    pricing_version: extension ? "f2" : "f1",
    stay: structuredClone(input.stay),
    room: input.room ? structuredClone(input.room) : null,
    board: input.board ? structuredClone(input.board) : null,
    currency: input.currency,
    total_cents: input.totals.total_cents,
    price_lines: structuredClone(input.lines),
    totals: { ...input.totals },
    commission: {
      rate: input.commissionRate,
      cents: input.commissionCents,
      // F1/backfill: fee on the full total; F2: on the commissionable base.
      base: input.commissionBase ?? "total",
      commissionable_cents: input.totals.commissionable_cents,
      penalizable_cents: input.totals.penalizable_cents,
    },
    refund_policy: buildRefundRule(
      input.stay.checkin,
      input.deadlineLocalTime,
      input.timezone,
    ),
    timezone: input.timezone,
    source: input.source,
    ...extension,
  };
}
