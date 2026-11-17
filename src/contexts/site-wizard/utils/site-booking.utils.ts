import type {
  CancellationPolicyDefinition,
  CancellationPolicyType,
  NoShowPolicy,
  PenaltyType,
} from "@/contexts/payments/domain/cancellation-policy";
import type { WizardCancellationSettings } from "../types/site-wizard.types";
import type { ParseResult } from "./site-units.utils";

import {
  assertCancellationPolicy,
  CANCELLATION_POLICY_TYPE,
  EARLY_CANCELLATION_WEEKS,
  FREE_CANCELLATION_DAYS,
  GRACE_AFTER_BOOKING_HOURS,
  NO_SHOW_POLICY,
  PENALTY_TYPE,
} from "@/contexts/payments/domain/cancellation-policy";

import { toNumber } from "./site-units.utils";

/**
 * Pure helpers of wizard step 6 ("Reservas"). Availability model (see
 * AvailabilityService / ReservationService.quote): one `availability` row per
 * (site, room, night). A night is bookable only if its row exists and
 * is_available = 1; min/max nights are read from the CHECK-IN night's row.
 * Reservations flip is_available to 0 (and back on cancel), blocks live in
 * their own table. No I/O here.
 */

export const AVAILABILITY_MODE = {
  ALL_YEAR: "all_year",
} as const;

export type AvailabilityModeValue =
  (typeof AVAILABILITY_MODE)[keyof typeof AVAILABILITY_MODE];

export const AVAILABILITY_MODE_VALUES: readonly AvailabilityModeValue[] =
  Object.values(AVAILABILITY_MODE);

export const BOOKING_LIMITS = {
  MIN_NIGHTS_MIN: 1,
  MIN_NIGHTS_MAX: 30,
  MAX_NIGHTS_MAX: 365,
  /** Rolling window generated for "all_year" (today + 364 nights). */
  WINDOW_DAYS: 365,
} as const;

export interface BookingSettingsInput {
  mode: AvailabilityModeValue;
  min_nights: number;
  max_nights: number;
}

/** Wizard availability rule stored in site_settings. */
export interface StoredAvailabilityRule {
  availability_mode: string | null;
  min_nights: number | null;
  max_nights: number | null;
}

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAvailabilityMode(
  value: unknown,
): value is AvailabilityModeValue {
  return AVAILABILITY_MODE_VALUES.includes(value as AvailabilityModeValue);
}

/** Body of PUT /booking-settings: {mode:'all_year', min_nights 1..30, max_nights min..365}. */
export function parseBookingSettingsInput(
  body: unknown,
): ParseResult<BookingSettingsInput> {
  if (!isRecord(body)) {
    return { ok: false, errors: ["body: formato no válido"] };
  }
  const errors: string[] = [];

  if (!isAvailabilityMode(body.mode)) {
    errors.push(
      `mode: valor no válido (${AVAILABILITY_MODE_VALUES.join(", ")})`,
    );
  }

  const minNights = toNumber(body.min_nights);
  const minValid =
    Number.isInteger(minNights) &&
    minNights >= BOOKING_LIMITS.MIN_NIGHTS_MIN &&
    minNights <= BOOKING_LIMITS.MIN_NIGHTS_MAX;
  if (!Number.isInteger(minNights)) {
    errors.push("min_nights: debe ser un número entero");
  } else if (!minValid) {
    errors.push(
      `min_nights: debe estar entre ${BOOKING_LIMITS.MIN_NIGHTS_MIN} y ${BOOKING_LIMITS.MIN_NIGHTS_MAX}`,
    );
  }

  const maxNights = toNumber(body.max_nights);
  const maxFloor = minValid ? minNights : BOOKING_LIMITS.MIN_NIGHTS_MIN;
  if (!Number.isInteger(maxNights)) {
    errors.push("max_nights: debe ser un número entero");
  } else if (
    maxNights < maxFloor ||
    maxNights > BOOKING_LIMITS.MAX_NIGHTS_MAX
  ) {
    errors.push(
      `max_nights: debe estar entre ${maxFloor} y ${BOOKING_LIMITS.MAX_NIGHTS_MAX}`,
    );
  }

  if (errors.length > 0 || !isAvailabilityMode(body.mode)) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: { mode: body.mode, min_nights: minNights, max_nights: maxNights },
  };
}

/** Configured = a valid mode with both limits stored. */
export function isAvailabilityConfigured(
  rule: StoredAvailabilityRule | null,
): rule is StoredAvailabilityRule & {
  availability_mode: AvailabilityModeValue;
  min_nights: number;
  max_nights: number;
} {
  return (
    rule !== null &&
    isAvailabilityMode(rule.availability_mode) &&
    rule.min_nights !== null &&
    rule.max_nights !== null
  );
}

/** "YYYY-MM-DD" (UTC) of a Date. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `days` consecutive ISO dates starting at `fromIso` (inclusive, UTC). */
export function buildAvailabilityDates(
  fromIso: string,
  days: number,
): string[] {
  const start = Date.parse(`${fromIso}T00:00:00Z`);
  if (!Number.isFinite(start) || days <= 0) {
    return [];
  }
  const dayMs = 24 * 60 * 60 * 1000;
  return Array.from({ length: days }, (_, index) =>
    toIsoDate(new Date(start + index * dayMs)),
  );
}

// ---------------------------------------------------------------------------
// Cancellation policy (step 6). Codes and rules live in
// payments/domain/cancellation-policy.ts; this only parses the wizard body.
// ---------------------------------------------------------------------------

/** Timezones the owner can pick (Península y Baleares / Canarias). */
export const CANCELLATION_TIMEZONE = {
  PENINSULA: "Europe/Madrid",
  CANARY: "Atlantic/Canary",
} as const;

export type CancellationTimezone =
  (typeof CANCELLATION_TIMEZONE)[keyof typeof CANCELLATION_TIMEZONE];

export const CANCELLATION_TIMEZONE_VALUES: readonly CancellationTimezone[] =
  Object.values(CANCELLATION_TIMEZONE);

const POLICY_TYPE_VALUES: readonly CancellationPolicyType[] = Object.values(
  CANCELLATION_POLICY_TYPE,
);
const NO_SHOW_VALUES: readonly NoShowPolicy[] = Object.values(NO_SHOW_POLICY);

/** Penalties the owner can choose per policy type. */
export const PENALTY_CHOICES: Readonly<
  Record<CancellationPolicyType, readonly PenaltyType[]>
> = {
  [CANCELLATION_POLICY_TYPE.FREE_CANCELLATION]: [
    PENALTY_TYPE.PERCENT_50,
    PENALTY_TYPE.FIRST_NIGHT,
    PENALTY_TYPE.PERCENT_100,
  ],
  [CANCELLATION_POLICY_TYPE.PARTIAL_FROM_BOOKING]: [
    PENALTY_TYPE.PERCENT_50,
    PENALTY_TYPE.FIRST_NIGHT,
  ],
  [CANCELLATION_POLICY_TYPE.NON_REFUNDABLE]: [PENALTY_TYPE.PERCENT_100],
};

/** Normalized policy of PUT /booking-settings (`cancellation` field). */
export interface CancellationPolicyInput extends CancellationPolicyDefinition {
  timezone: CancellationTimezone;
}

/** Cancellation columns of site_settings. */
export interface StoredCancellationPolicy {
  cancellation_policy_type: string | null;
  cancellation_deadline_days: number | null;
  cancellation_penalty_type: string | null;
  no_show_policy: string | null;
  grace_after_booking_hours: number | null;
  early_cancellation_weeks: number | null;
  timezone: string | null;
}

const CANCELLATION_FIELD = "cancellation";

function includes<T>(values: readonly T[], value: unknown): value is T {
  return values.includes(value as T);
}

function isBlank(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  );
}

/** Optional exception: blank -> null, otherwise one of `allowed`. */
function parseOptionalChoice(
  raw: unknown,
  allowed: readonly number[],
  field: string,
  errors: string[],
): number | null {
  if (isBlank(raw) || raw === false) {
    return null;
  }
  const value = toNumber(raw);
  if (!allowed.includes(value)) {
    errors.push(
      `${CANCELLATION_FIELD}.${field}: valor no válido (${allowed.join(", ")})`,
    );
    return null;
  }
  return value;
}

/** Maps a message of assertCancellationPolicy to its "field: msg" error. */
function assertionError(message: string): string {
  const field = message.startsWith(CANCELLATION_POLICY_TYPE.FREE_CANCELLATION)
    ? "deadline_days"
    : "penalty_type";
  return `${CANCELLATION_FIELD}.${field}: ${message}`;
}

/**
 * `cancellation` of PUT /booking-settings.
 * - absent (undefined) -> ok with `undefined`: stored columns are untouched;
 * - present -> validated as a whole and normalized:
 *   deadline_days only for free_cancellation (null otherwise),
 *   non_refundable forces percent_100 and full_total no-show,
 *   partial_from_booking only 50 % / first night,
 *   exceptions blank -> null, timezone Europe/Madrid | Atlantic/Canary.
 */
export function parseCancellationPolicyInput(
  body: unknown,
): ParseResult<CancellationPolicyInput | undefined> {
  if (!isRecord(body) || body[CANCELLATION_FIELD] === undefined) {
    return { ok: true, value: undefined };
  }
  const raw = body[CANCELLATION_FIELD];
  if (!isRecord(raw)) {
    return {
      ok: false,
      errors: [`${CANCELLATION_FIELD}: formato no válido`],
    };
  }
  const errors: string[] = [];

  const policyType = raw.policy_type;
  if (!includes(POLICY_TYPE_VALUES, policyType)) {
    errors.push(
      `${CANCELLATION_FIELD}.policy_type: valor no válido (${POLICY_TYPE_VALUES.join(", ")})`,
    );
  }
  const validType = includes(POLICY_TYPE_VALUES, policyType)
    ? policyType
    : null;
  const isFree = validType === CANCELLATION_POLICY_TYPE.FREE_CANCELLATION;
  const isNonRefundable = validType === CANCELLATION_POLICY_TYPE.NON_REFUNDABLE;

  let deadlineDays: number | null = null;
  if (isFree) {
    const days = toNumber(raw.deadline_days);
    if ((FREE_CANCELLATION_DAYS as readonly number[]).includes(days)) {
      deadlineDays = days;
    } else {
      errors.push(
        `${CANCELLATION_FIELD}.deadline_days: elige ${FREE_CANCELLATION_DAYS.join(", ")} días`,
      );
    }
  }

  let penaltyType: PenaltyType = PENALTY_TYPE.PERCENT_100;
  if (validType !== null && !isNonRefundable) {
    const choices = PENALTY_CHOICES[validType];
    if (includes(choices, raw.penalty_type)) {
      penaltyType = raw.penalty_type;
    } else {
      errors.push(
        `${CANCELLATION_FIELD}.penalty_type: valor no válido (${choices.join(", ")})`,
      );
    }
  }

  let noShow: NoShowPolicy = NO_SHOW_POLICY.FULL_TOTAL;
  if (!isNonRefundable) {
    if (includes(NO_SHOW_VALUES, raw.no_show_policy)) {
      noShow = raw.no_show_policy;
    } else {
      errors.push(
        `${CANCELLATION_FIELD}.no_show_policy: valor no válido (${NO_SHOW_VALUES.join(", ")})`,
      );
    }
  }

  const grace = parseOptionalChoice(
    raw.grace_after_booking_hours,
    GRACE_AFTER_BOOKING_HOURS,
    "grace_after_booking_hours",
    errors,
  );
  const early = parseOptionalChoice(
    raw.early_cancellation_weeks,
    EARLY_CANCELLATION_WEEKS,
    "early_cancellation_weeks",
    errors,
  );

  const timezone = raw.timezone;
  if (!includes(CANCELLATION_TIMEZONE_VALUES, timezone)) {
    errors.push(
      `${CANCELLATION_FIELD}.timezone: valor no válido (${CANCELLATION_TIMEZONE_VALUES.join(", ")})`,
    );
  }

  if (
    errors.length > 0 ||
    validType === null ||
    !includes(CANCELLATION_TIMEZONE_VALUES, timezone)
  ) {
    return { ok: false, errors };
  }

  const value: CancellationPolicyInput = {
    policy_type: validType,
    deadline_days: deadlineDays,
    penalty_type: penaltyType,
    no_show_policy: noShow,
    grace_after_booking_hours: grace,
    early_cancellation_weeks: early,
    timezone,
  };
  try {
    assertCancellationPolicy(value);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [assertionError(message)] };
  }
  return { ok: true, value };
}

/**
 * Stored columns -> payload. NULL / unknown type = no structured policy
 * (legacy rule). Missing timezone falls back to Europe/Madrid.
 */
export function toCancellationSettings(
  stored: StoredCancellationPolicy | null,
): WizardCancellationSettings | null {
  if (
    stored === null ||
    !includes(POLICY_TYPE_VALUES, stored.cancellation_policy_type)
  ) {
    return null;
  }
  return {
    policy_type: stored.cancellation_policy_type,
    deadline_days: stored.cancellation_deadline_days,
    penalty_type: stored.cancellation_penalty_type ?? PENALTY_TYPE.PERCENT_100,
    no_show_policy: stored.no_show_policy ?? NO_SHOW_POLICY.FULL_TOTAL,
    grace_after_booking_hours: stored.grace_after_booking_hours,
    early_cancellation_weeks: stored.early_cancellation_weeks,
    timezone: stored.timezone ?? CANCELLATION_TIMEZONE.PENINSULA,
  };
}
