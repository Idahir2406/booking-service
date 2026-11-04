import type { ParseResult } from "./site-units.utils";

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
