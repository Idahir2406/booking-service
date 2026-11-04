/**
 * Políticas de cancelación estructuradas (no texto libre).
 * Combinación: tipo + plazo + penalización + no-show + excepciones.
 * El texto que ve el viajero se genera desde estos valores.
 * Plazos visibles V1: 1, 3, 7, 14, 30 días. Parametrizables vía este catálogo.
 */

export const CANCELLATION_POLICY_TYPE = {
  FREE_CANCELLATION: "free_cancellation",
  PARTIAL_FROM_BOOKING: "partial_from_booking",
  NON_REFUNDABLE: "non_refundable",
} as const;

export type CancellationPolicyType =
  (typeof CANCELLATION_POLICY_TYPE)[keyof typeof CANCELLATION_POLICY_TYPE];

export const PENALTY_TYPE = {
  PERCENT_100: "percent_100",
  PERCENT_50: "percent_50",
  FIRST_NIGHT: "first_night",
} as const;

export type PenaltyType = (typeof PENALTY_TYPE)[keyof typeof PENALTY_TYPE];

export const NO_SHOW_POLICY = {
  SAME_AS_CANCELLATION: "same_as_cancellation",
  FULL_TOTAL: "full_total",
} as const;

export type NoShowPolicy =
  (typeof NO_SHOW_POLICY)[keyof typeof NO_SHOW_POLICY];

/** Plazos que el alojamiento puede elegir en V1. */
export const FREE_CANCELLATION_DAYS = [1, 3, 7, 14, 30] as const;

export const GRACE_AFTER_BOOKING_HOURS = [1, 4, 24] as const;
export const EARLY_CANCELLATION_WEEKS = [4, 8, 12] as const;

export interface CancellationPolicyDefinition {
  policy_type: CancellationPolicyType;
  /** Solo free_cancellation. Días antes del check-in. */
  deadline_days: number | null;
  penalty_type: PenaltyType;
  no_show_policy: NoShowPolicy;
  /** Excepciones opcionales. null = desactivada. */
  grace_after_booking_hours: number | null;
  early_cancellation_weeks: number | null;
}

export interface CancellationQuoteInput {
  policy: CancellationPolicyDefinition;
  checkin: string;
  timezone: string;
  paid_cents: number;
  first_night_cents: number;
  booked_at?: Date | null;
  now?: Date;
}

export interface CancellationQuote {
  within_free_period: boolean;
  deadline_iso: string | null;
  penalty_cents: number;
  refund_cents: number;
  generated_text: string;
}

export function isFreeCancellationDay(days: number): boolean {
  return (FREE_CANCELLATION_DAYS as readonly number[]).includes(days);
}

export function assertCancellationPolicy(
  policy: CancellationPolicyDefinition,
): void {
  if (policy.policy_type === CANCELLATION_POLICY_TYPE.FREE_CANCELLATION) {
    if (
      policy.deadline_days == null ||
      !isFreeCancellationDay(policy.deadline_days)
    ) {
      throw new Error("free_cancellation requiere plazo 1, 3, 7, 14 o 30");
    }
  }
  if (policy.policy_type === CANCELLATION_POLICY_TYPE.NON_REFUNDABLE) {
    if (policy.penalty_type !== PENALTY_TYPE.PERCENT_100) {
      throw new Error("non_refundable solo admite penalización del 100 %");
    }
  }
  if (policy.policy_type === CANCELLATION_POLICY_TYPE.PARTIAL_FROM_BOOKING) {
    if (policy.penalty_type === PENALTY_TYPE.PERCENT_100) {
      throw new Error(
        "partial_from_booking usa 50 % o primera noche, no el 100 %",
      );
    }
  }
}

function pad(value: number): string {
  return `${value}`.padStart(2, "0");
}

function calendarDateMinusDays(isoDate: string, days: number): {
  year: number;
  month: number;
  day: number;
} {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() - days);
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

function zonedParts(instant: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const bag: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") {
      bag[part.type] = part.value;
    }
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour === "24" ? "0" : bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

/** 23:59:59 local del día indicado, expresado en UTC ISO. */
export function endOfLocalDayUtcIso(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): string {
  let guess = Date.UTC(year, month - 1, day, 23, 59, 59);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const desired = Date.UTC(year, month - 1, day, 23, 59, 59);
    const delta = desired - asUtc;
    if (delta === 0) {
      break;
    }
    guess += delta;
  }
  return new Date(guess).toISOString();
}

export function freeCancellationDeadlineIso(
  checkin: string,
  deadlineDays: number,
  timeZone: string,
): string {
  const date = calendarDateMinusDays(checkin, deadlineDays);
  return endOfLocalDayUtcIso(date.year, date.month, date.day, timeZone);
}

function penaltyCents(
  penalty: PenaltyType,
  paidCents: number,
  firstNightCents: number,
): number {
  if (penalty === PENALTY_TYPE.PERCENT_50) {
    return Math.round(paidCents * 0.5);
  }
  if (penalty === PENALTY_TYPE.FIRST_NIGHT) {
    return Math.min(Math.max(0, firstNightCents), paidCents);
  }
  return paidCents;
}

function formatEuroFromCents(cents: number): string {
  const euros = (cents / 100).toFixed(2).replace(".", ",");
  return `${euros} €`;
}

export function generateCancellationText(
  policy: CancellationPolicyDefinition,
  deadlineIso: string | null,
): string {
  if (policy.policy_type === CANCELLATION_POLICY_TYPE.NON_REFUNDABLE) {
    return "No reembolsable. Si cancelas después de reservar, se cobra el 100 % del importe total.";
  }
  const penaltyLabel =
    policy.penalty_type === PENALTY_TYPE.PERCENT_50
      ? "el 50 % del importe total"
      : policy.penalty_type === PENALTY_TYPE.FIRST_NIGHT
        ? "el importe de la primera noche"
        : "el 100 % del importe total";
  if (policy.policy_type === CANCELLATION_POLICY_TYPE.PARTIAL_FROM_BOOKING) {
    return `Parcialmente reembolsable. Si cancelas después de reservar, se cobra ${penaltyLabel}.`;
  }
  const when = deadlineIso
    ? new Date(deadlineIso).toISOString()
    : "el plazo indicado";
  return `Cancelación gratuita hasta ${when}. Después se cobra ${penaltyLabel}.`;
}

export function quoteCancellation(
  input: CancellationQuoteInput,
): CancellationQuote {
  assertCancellationPolicy(input.policy);
  const now = input.now ?? new Date();
  const timeZone = input.timezone || "Europe/Madrid";
  const deadlineIso =
    input.policy.policy_type === CANCELLATION_POLICY_TYPE.FREE_CANCELLATION &&
    input.policy.deadline_days != null
      ? freeCancellationDeadlineIso(
          input.checkin,
          input.policy.deadline_days,
          timeZone,
        )
      : null;

  let withinFree = false;
  if (
    input.policy.grace_after_booking_hours != null &&
    input.booked_at &&
    now.getTime() <=
      input.booked_at.getTime() +
        input.policy.grace_after_booking_hours * 3_600_000
  ) {
    withinFree = true;
  }
  if (
    !withinFree &&
    input.policy.early_cancellation_weeks != null
  ) {
    const early = calendarDateMinusDays(
      input.checkin,
      input.policy.early_cancellation_weeks * 7,
    );
    const earlyIso = endOfLocalDayUtcIso(
      early.year,
      early.month,
      early.day,
      timeZone,
    );
    if (now.getTime() <= new Date(earlyIso).getTime()) {
      withinFree = true;
    }
  }
  if (
    !withinFree &&
    input.policy.policy_type === CANCELLATION_POLICY_TYPE.FREE_CANCELLATION &&
    deadlineIso &&
    now.getTime() <= new Date(deadlineIso).getTime()
  ) {
    withinFree = true;
  }

  const penalty = withinFree
    ? 0
    : penaltyCents(
        input.policy.penalty_type,
        input.paid_cents,
        input.first_night_cents,
      );
  const refund = Math.max(0, input.paid_cents - penalty);
  return {
    within_free_period: withinFree,
    deadline_iso: deadlineIso,
    penalty_cents: penalty,
    refund_cents: refund,
    generated_text: generateCancellationText(input.policy, deadlineIso),
  };
}

export interface NoShowQuote {
  /** null = legacy reservation without a structured policy. */
  no_show_policy: NoShowPolicy | null;
  penalty_cents: number;
  refund_cents: number;
}

/**
 * No-show (punto 6): by definition outside any free period.
 * - full_total            -> 100 % retained, no refund;
 * - same_as_cancellation  -> the late-cancellation penalty of the policy
 *                            (100 %, 50 % or first night), refund the rest;
 * - no structured policy  -> 100 % retained (legacy 24 h window is over).
 */
export function quoteNoShow(
  policy: CancellationPolicyDefinition | null,
  paidCents: number,
  firstNightCents: number,
): NoShowQuote {
  const paid = Math.max(0, Math.round(paidCents));
  if (!policy) {
    return { no_show_policy: null, penalty_cents: paid, refund_cents: 0 };
  }
  const penalty =
    policy.no_show_policy === NO_SHOW_POLICY.SAME_AS_CANCELLATION
      ? penaltyCents(policy.penalty_type, paid, firstNightCents)
      : paid;
  return {
    no_show_policy: policy.no_show_policy,
    penalty_cents: penalty,
    refund_cents: Math.max(0, paid - penalty),
  };
}

export function formatPenaltyPreview(quote: CancellationQuote): string {
  return `Penalización: ${formatEuroFromCents(quote.penalty_cents)}. Importe a reembolsar: ${formatEuroFromCents(quote.refund_cents)}.`;
}
