import type { Cents, Rate } from "../utils/money.util";
import type { PriceLineDraft, PriceLinesSummary } from "./price-lines";

import {
  getRefundDeadlineUtc,
  REFUND_WINDOW_MS,
} from "../../reservations/utils/reservation-policy.util";
import {
  CANCELLATION_POLICY_TYPE,
  type CancellationPolicyDefinition,
  type ChargeMode,
  formatDeadlineLocal,
  freeCancellationDeadlineIso,
  generateCancellationText,
} from "./cancellation-policy";

export const SNAPSHOT_SCHEMA_VERSION = 1;

/** Refund rule in force today (host-initiated, 24 h before check-in, UTC). */
export const CURRENT_REFUND_RULE =
  "legacy_host_full_refund_until_24h_before_checkin";

/** Structured cancellation policy of the site frozen at booking (Fase 3). */
export const STRUCTURED_REFUND_RULE = "structured_cancellation_policy";

const DEFAULT_SNAPSHOT_TIMEZONE = "Europe/Madrid";
const DEFAULT_DEADLINE_TIME = "18:00";

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
  /**
   * Only with `cancellation`: local date (YYYY-MM-DD, `timezone`) of the
   * free-cancellation deadline; null for partial / non-refundable.
   */
  deadline_local_date?: string | null;
  /** Only with `cancellation`: charge mode frozen at booking. */
  charge_mode?: ChargeMode | null;
  /** Only with `cancellation`: ISO instant of the deferred charge (flexible). */
  charge_at?: string | null;
  /** Only with `cancellation`: booking instant (grace exception base). */
  booked_at?: string | null;
}

/** Structured policy + charge plan frozen at booking (snapshot input). */
export interface SnapshotCancellationTerms {
  policy: CancellationPolicyDefinition;
  /** Booking instant (ISO): start of the grace exception and of the penalty. */
  booked_at_iso: string;
  charge_mode: ChargeMode;
  charge_at_iso: string | null;
}

export interface StructuredRefundRuleInput {
  checkin: string;
  /** "HH:MM" local time of the deadline (platform_settings). */
  deadlineLocalTime: string;
  timezone: string;
  terms: SnapshotCancellationTerms;
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

/** Check-in / check-out schedule of the site at booking time (local "HH:MM"). */
export interface SnapshotSchedule {
  checkin_from: string | null;
  checkin_until: string | null;
  checkout_until: string | null;
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
  /** Site schedule frozen at booking time (absent on older snapshots). */
  schedule?: SnapshotSchedule | null;
  /** Cribs requested (absent on older snapshots, null = none). */
  cribs?: SnapshotCribs | null;
}

export interface SnapshotCribs {
  quantity: number;
  is_paid: boolean;
  price_cents: Cents;
  pricing_mode: string;
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
  /** Structured policy of the site; absent/null = legacy 24 h rule. */
  cancellation?: SnapshotCancellationTerms | null;
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

function addHoursIso(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString();
}

/**
 * Structured rule: frozen policy, generated text and deadline in the local
 * time of the accommodation. `refund_deadline` = last instant a full refund
 * is possible (same union quoteCancellation applies: free deadline, grace
 * after booking, early cancellation); for partial / non-refundable without
 * exceptions it is the booking instant (no free period).
 */
export function buildStructuredRefundRule(
  input: StructuredRefundRuleInput,
): SnapshotRefundRule {
  const { policy } = input.terms;
  const timeZone = input.timezone || DEFAULT_SNAPSHOT_TIMEZONE;
  const deadlineIso =
    policy.policy_type === CANCELLATION_POLICY_TYPE.FREE_CANCELLATION &&
    policy.deadline_days != null
      ? freeCancellationDeadlineIso(
          input.checkin,
          policy.deadline_days,
          timeZone,
          input.deadlineLocalTime,
        )
      : null;
  const deadlineLocal = deadlineIso
    ? formatDeadlineLocal(deadlineIso, timeZone)
    : null;
  const candidates = [input.terms.booked_at_iso];
  if (deadlineIso) {
    candidates.push(deadlineIso);
  }
  if (policy.grace_after_booking_hours != null) {
    candidates.push(
      addHoursIso(input.terms.booked_at_iso, policy.grace_after_booking_hours),
    );
  }
  if (policy.early_cancellation_weeks != null) {
    candidates.push(
      freeCancellationDeadlineIso(
        input.checkin,
        policy.early_cancellation_weeks * 7,
        timeZone,
        input.deadlineLocalTime,
      ),
    );
  }
  const refundDeadlineMs = Math.max(
    ...candidates.map(iso => new Date(iso).getTime()),
  );
  return {
    rule: STRUCTURED_REFUND_RULE,
    window_hours: deadlineIso ? (policy.deadline_days ?? 0) * 24 : 0,
    refund_deadline: new Date(refundDeadlineMs).toISOString(),
    deadline_local_time: input.deadlineLocalTime,
    timezone: timeZone,
    cancellation: structuredClone(policy),
    generated_text: generateCancellationText(
      policy,
      deadlineIso,
      deadlineLocal,
    ),
    deadline_local_date: deadlineLocal?.date ?? null,
    charge_mode: input.terms.charge_mode,
    charge_at: input.terms.charge_at_iso,
    booked_at: input.terms.booked_at_iso,
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
    refund_policy: input.cancellation
      ? buildStructuredRefundRule({
          checkin: input.stay.checkin,
          deadlineLocalTime: input.deadlineLocalTime ?? DEFAULT_DEADLINE_TIME,
          timezone: input.timezone ?? DEFAULT_SNAPSHOT_TIMEZONE,
          terms: input.cancellation,
        })
      : buildRefundRule(
          input.stay.checkin,
          input.deadlineLocalTime,
          input.timezone,
        ),
    timezone: input.timezone,
    source: input.source,
    ...extension,
  };
}
