/**
 * Money helpers (F1). Every new economic table stores INTEGER CENTS; decimals
 * only exist in legacy columns (reservations.subtotal/total/...) and at the
 * edges (DTOs, emails). Rounding is always half-up (away from zero for
 * negatives, i.e. commercial rounding), never banker's rounding.
 */

export type Cents = number;

/** Rates are fractions: 0.12 = 12 %. Max 4 decimals (decimal(5,4) in DB). */
export type Rate = number;

const RATE_SCALE = 10_000;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function assertCents(value: number, label = "amount"): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of cents`);
  }
  return value;
}

/**
 * Half-up rounding of a (possibly fractional) cents value. Uses an epsilon
 * so binary artifacts like 1.005 * 100 = 100.49999999999999 round to 101.
 */
export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) {
    throw new MoneyError("Cannot round a non-finite number");
  }
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const rounded = Math.floor(abs + 0.5 + 1e-9);
  return rounded === 0 ? 0 : sign * rounded;
}

/**
 * Parses a legacy decimal amount (number or string like "12.34", "12,34",
 * "1.234,56" is NOT supported on purpose: DB decimals always use '.').
 * null/undefined/"" -> null.
 */
export function parseToCents(value: unknown): Cents | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const raw =
    typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(raw)) {
    throw new MoneyError(`Invalid money amount: ${String(value)}`);
  }
  // Work on the decimal string to avoid 0.1 + 0.2 style float artifacts.
  return roundHalfUp(Number((raw * 100).toFixed(6)));
}

/** Like parseToCents but null/empty -> 0. */
export function toCents(value: unknown): Cents {
  return parseToCents(value) ?? 0;
}

/** Cents -> decimal number for legacy decimal(10,2) columns and APIs. */
export function centsToDecimal(cents: Cents): number {
  assertCents(cents);
  return cents / 100;
}

/** Cents -> "12.34" (no thousands separator; for logs/metadata/DB). */
export function formatCents(cents: Cents): string {
  assertCents(cents);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const units = Math.floor(abs / 100);
  const decimals = String(abs % 100).padStart(2, "0");
  return `${sign}${units}.${decimals}`;
}

/** Human format for emails/UI, e.g. formatMoney(123456, "eur") -> "1.234,56 €". */
export function formatMoney(
  cents: Cents,
  currency = "eur",
  locale = "es-ES",
): string {
  assertCents(cents);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

/** Validates a rate (0..1, max 4 decimals) and returns it normalized. */
export function normalizeRate(rate: unknown): Rate {
  const value = typeof rate === "number" ? rate : Number(rate);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new MoneyError(`Invalid rate: ${String(rate)} (expected 0..1)`);
  }
  return Math.round(value * RATE_SCALE) / RATE_SCALE;
}

/**
 * Percentage of an amount in cents, half-up. Computed with integer basis
 * points so 0.12 * 1005 is exact (120.6 -> 121) instead of float noise.
 */
export function percentOfCents(cents: Cents, rate: Rate): Cents {
  assertCents(cents);
  const basisPoints = Math.round(normalizeRate(rate) * RATE_SCALE);
  return roundHalfUp((cents * basisPoints) / RATE_SCALE);
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const value of values) {
    total += assertCents(value);
  }
  return assertCents(total, "sum");
}

/** unit * quantity (quantity may be fractional, e.g. 1.5 kg), half-up. */
export function multiplyCents(unitCents: Cents, quantity: number): Cents {
  assertCents(unitCents, "unit amount");
  if (!Number.isFinite(quantity)) {
    throw new MoneyError(`Invalid quantity: ${String(quantity)}`);
  }
  return roundHalfUp(Number((unitCents * quantity).toFixed(6)));
}
