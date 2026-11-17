/**
 * Políticas de cancelación estructuradas (no texto libre).
 * Combinación: tipo + plazo + penalización + no-show + excepciones.
 * El texto que ve el viajero se genera desde estos valores.
 * Plazos visibles V1: 1, 3, 7, 14, 30 días. Parametrizables vía este catálogo.
 */

import type { ChargeModeValue } from "../../reservations/entities/reservation.entity";

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

export type NoShowPolicy = (typeof NO_SHOW_POLICY)[keyof typeof NO_SHOW_POLICY];

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
  /**
   * Hora local "HH:MM" del plazo (p. ej. "18:00"). Si falta, el plazo es
   * 23:59:59 local (comportamiento previo).
   */
  deadline_local_time?: string | null;
}

export interface CancellationQuote {
  within_free_period: boolean;
  deadline_iso: string | null;
  penalty_cents: number;
  refund_cents: number;
  generated_text: string;
}

/** Modo de cobro; valores idénticos al enum `reservations.charge_mode`. */
export const CHARGE_MODE = {
  IMMEDIATE: "immediate",
  FLEXIBLE: "flexible",
} as const satisfies Record<string, ChargeModeValue>;

export type ChargeMode = (typeof CHARGE_MODE)[keyof typeof CHARGE_MODE];

/** Plazo expresado en la hora local del alojamiento. */
export interface DeadlineLocal {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  time: string;
  /** IANA, p. ej. Europe/Madrid */
  timezone: string;
}

export interface ChargePlan {
  charge_mode: ChargeMode;
  charge_at_iso: string | null;
  deadline_iso: string | null;
  deadline_local: DeadlineLocal | null;
  is_last_minute: boolean;
}

export interface ResolveChargePlanInput {
  policy: CancellationPolicyDefinition;
  checkin: string;
  timezone: string;
  /** "HH:MM", p. ej. "18:00". */
  deadlineLocalTime: string;
  now: Date;
  /** Si faltan menos horas que esto hasta el plazo, se cobra al reservar. */
  minLeadHours: number;
}

export function isFreeCancellationDay(days: number): boolean {
  return (FREE_CANCELLATION_DAYS as readonly number[]).includes(days);
}

export function assertCancellationPolicy(
  policy: CancellationPolicyDefinition,
): void {
  if (
    policy.policy_type === CANCELLATION_POLICY_TYPE.FREE_CANCELLATION &&
    (policy.deadline_days == null ||
      !isFreeCancellationDay(policy.deadline_days))
  ) {
    throw new Error("free_cancellation requiere plazo 1, 3, 7, 14 o 30");
  }
  if (
    policy.policy_type === CANCELLATION_POLICY_TYPE.NON_REFUNDABLE &&
    policy.penalty_type !== PENALTY_TYPE.PERCENT_100
  ) {
    throw new Error("non_refundable solo admite penalización del 100 %");
  }
  if (
    policy.policy_type === CANCELLATION_POLICY_TYPE.PARTIAL_FROM_BOOKING &&
    policy.penalty_type === PENALTY_TYPE.PERCENT_100
  ) {
    throw new Error(
      "partial_from_booking usa 50 % o primera noche, no el 100 %",
    );
  }
}

function pad(value: number): string {
  return `${value}`.padStart(2, "0");
}

function calendarDateMinusDays(
  isoDate: string,
  days: number,
): {
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

function localDateTimeUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): number {
  const desired = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = desired;
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
    const delta = desired - asUtc;
    if (delta === 0) {
      break;
    }
    guess += delta;
  }
  return guess;
}

function parseLocalTime(localTime: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(localTime.trim());
  if (!match) {
    throw new Error(`Hora local inválida: "${localTime}" (formato HH:MM)`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error(`Hora local inválida: "${localTime}" (formato HH:MM)`);
  }
  return { hour, minute };
}

/**
 * Hora local "HH:MM" (segundos = 0) del día indicado en `timeZone`,
 * expresada en UTC ISO. Respeta el horario de verano.
 */
export function localTimeUtcIso(
  year: number,
  month: number,
  day: number,
  localTime: string,
  timeZone: string,
): string {
  const { hour, minute } = parseLocalTime(localTime);
  return new Date(
    localDateTimeUtcMs(year, month, day, hour, minute, 0, timeZone),
  ).toISOString();
}

/** 23:59:59 local del día indicado, expresado en UTC ISO. */
export function endOfLocalDayUtcIso(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): string {
  return new Date(
    localDateTimeUtcMs(year, month, day, 23, 59, 59, timeZone),
  ).toISOString();
}

function localDeadlineIso(
  checkin: string,
  daysBefore: number,
  timeZone: string,
  localTime?: string | null,
): string {
  const date = calendarDateMinusDays(checkin, daysBefore);
  return localTime
    ? localTimeUtcIso(date.year, date.month, date.day, localTime, timeZone)
    : endOfLocalDayUtcIso(date.year, date.month, date.day, timeZone);
}

/**
 * Plazo de cancelación gratuita: `localTime` (p. ej. "18:00") del día
 * `checkin - deadlineDays`. Sin `localTime`, 23:59:59 local (legacy).
 */
export function freeCancellationDeadlineIso(
  checkin: string,
  deadlineDays: number,
  timeZone: string,
  localTime?: string | null,
): string {
  return localDeadlineIso(checkin, deadlineDays, timeZone, localTime);
}

/** Fecha y hora locales (en `timeZone`) de un instante ISO. */
export function formatDeadlineLocal(
  iso: string,
  timeZone: string,
): DeadlineLocal {
  const parts = zonedParts(new Date(iso), timeZone);
  return {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    time: `${pad(parts.hour)}:${pad(parts.minute)}`,
    timezone: timeZone,
  };
}

const TIMEZONE_LABELS: Readonly<Record<string, string>> = {
  "Europe/Madrid": "Madrid",
  "Atlantic/Canary": "Canarias",
};

export function timezoneLabel(timeZone: string): string {
  return TIMEZONE_LABELS[timeZone] ?? timeZone;
}

function formatDeadlineLocalText(local: DeadlineLocal): string {
  const [year, month, day] = local.date.split("-");
  return `el ${day}/${month}/${year} a las ${local.time} (hora de ${timezoneLabel(local.timezone)})`;
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
  deadlineLocal?: DeadlineLocal | null,
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
  const when = deadlineLocal
    ? formatDeadlineLocalText(deadlineLocal)
    : deadlineIso
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
  const localTime = input.deadline_local_time || null;
  // With an explicit local time ("18:00") the penalty starts AT the deadline
  // (now < deadline is free), like resolveChargePlan. Without it the legacy
  // 23:59:59 deadline stays inclusive.
  const beforeDeadline = (deadlineMs: number): boolean =>
    localTime ? now.getTime() < deadlineMs : now.getTime() <= deadlineMs;
  const deadlineIso =
    input.policy.policy_type === CANCELLATION_POLICY_TYPE.FREE_CANCELLATION &&
    input.policy.deadline_days != null
      ? freeCancellationDeadlineIso(
          input.checkin,
          input.policy.deadline_days,
          timeZone,
          localTime,
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
  if (!withinFree && input.policy.early_cancellation_weeks != null) {
    const earlyIso = localDeadlineIso(
      input.checkin,
      input.policy.early_cancellation_weeks * 7,
      timeZone,
      localTime,
    );
    if (beforeDeadline(new Date(earlyIso).getTime())) {
      withinFree = true;
    }
  }
  if (
    !withinFree &&
    input.policy.policy_type === CANCELLATION_POLICY_TYPE.FREE_CANCELLATION &&
    deadlineIso &&
    beforeDeadline(new Date(deadlineIso).getTime())
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
    generated_text: generateCancellationText(
      input.policy,
      deadlineIso,
      deadlineIso ? formatDeadlineLocal(deadlineIso, timeZone) : null,
    ),
  };
}

/**
 * Cuándo se cobra la reserva según la tarifa (A5/A6):
 * - parcial / no reembolsable → al confirmar;
 * - gratuita con plazo vencido → al confirmar (última hora);
 * - gratuita con menos de `minLeadHours` hasta el plazo → al confirmar;
 * - gratuita en el resto → flexible, cobro en el plazo.
 */
export function resolveChargePlan(input: ResolveChargePlanInput): ChargePlan {
  assertCancellationPolicy(input.policy);
  const { policy } = input;
  if (
    policy.policy_type !== CANCELLATION_POLICY_TYPE.FREE_CANCELLATION ||
    policy.deadline_days == null
  ) {
    return {
      charge_mode: CHARGE_MODE.IMMEDIATE,
      charge_at_iso: null,
      deadline_iso: null,
      deadline_local: null,
      is_last_minute: false,
    };
  }
  const timeZone = input.timezone || "Europe/Madrid";
  const deadlineIso = freeCancellationDeadlineIso(
    input.checkin,
    policy.deadline_days,
    timeZone,
    input.deadlineLocalTime,
  );
  const deadlineLocal = formatDeadlineLocal(deadlineIso, timeZone);
  const remainingMs = new Date(deadlineIso).getTime() - input.now.getTime();
  if (remainingMs <= 0) {
    return {
      charge_mode: CHARGE_MODE.IMMEDIATE,
      charge_at_iso: null,
      deadline_iso: deadlineIso,
      deadline_local: deadlineLocal,
      is_last_minute: true,
    };
  }
  if (remainingMs < input.minLeadHours * 3_600_000) {
    return {
      charge_mode: CHARGE_MODE.IMMEDIATE,
      charge_at_iso: null,
      deadline_iso: deadlineIso,
      deadline_local: deadlineLocal,
      is_last_minute: false,
    };
  }
  return {
    charge_mode: CHARGE_MODE.FLEXIBLE,
    charge_at_iso: deadlineIso,
    deadline_iso: deadlineIso,
    deadline_local: deadlineLocal,
    is_last_minute: false,
  };
}

export interface ResolveEffectiveChargePlanInput extends ResolveChargePlanInput {
  /** platform_settings.deferred_charge_enabled (A5). */
  deferredChargeEnabled: boolean;
}

/**
 * Plan de cobro que se congela en la reserva: el de la tarifa, pero
 * `flexible` solo si el cobro diferido está activado en la plataforma; si no,
 * se cobra al reservar (charge_at = null) y se reembolsa según la tarifa.
 */
export function resolveEffectiveChargePlan(
  input: ResolveEffectiveChargePlanInput,
): ChargePlan {
  const plan = resolveChargePlan(input);
  if (
    plan.charge_mode === CHARGE_MODE.FLEXIBLE &&
    !input.deferredChargeEnabled
  ) {
    return { ...plan, charge_mode: CHARGE_MODE.IMMEDIATE, charge_at_iso: null };
  }
  return plan;
}

/** Bloque `cancellation` de la cotización (checkout). */
export interface QuoteCancellationSummary {
  policy_type: CancellationPolicyType;
  generated_text: string;
  deadline_iso: string | null;
  deadline_local: DeadlineLocal | null;
  timezone: string;
  charge_mode: ChargeMode;
  charge_at_iso: string | null;
  /** Total si se cobra al reservar; 0 si el cobro es diferido (flexible). */
  charge_now_cents: number;
  is_last_minute: boolean;
}

export interface QuoteCancellationSummaryInput {
  policy: CancellationPolicyDefinition;
  /** Plan efectivo (resolveEffectiveChargePlan). */
  plan: ChargePlan;
  timezone: string;
  total_cents: number;
}

export function buildQuoteCancellationSummary(
  input: QuoteCancellationSummaryInput,
): QuoteCancellationSummary {
  const { plan } = input;
  return {
    policy_type: input.policy.policy_type,
    generated_text: generateCancellationText(
      input.policy,
      plan.deadline_iso,
      plan.deadline_local,
    ),
    deadline_iso: plan.deadline_iso,
    deadline_local: plan.deadline_local ? { ...plan.deadline_local } : null,
    timezone: input.timezone,
    charge_mode: plan.charge_mode,
    charge_at_iso: plan.charge_at_iso,
    charge_now_cents:
      plan.charge_mode === CHARGE_MODE.FLEXIBLE
        ? 0
        : Math.max(0, Math.round(input.total_cents)),
    is_last_minute: plan.is_last_minute,
  };
}

/** Columnas de tarifa de site_settings (paso 6 del wizard). */
export interface StoredCancellationColumns {
  cancellation_policy_type: string | null;
  cancellation_deadline_days: number | null;
  cancellation_penalty_type: string | null;
  no_show_policy: string | null;
  grace_after_booking_hours: number | null;
  early_cancellation_weeks: number | null;
}

function includesValue<T extends string>(
  values: Readonly<Record<string, T>>,
  value: unknown,
): value is T {
  return (Object.values(values) as unknown[]).includes(value);
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Tarifa estructurada a partir de las columnas guardadas. null = sin tarifa
 * (regla legacy de 24 h): tipo vacío/desconocido o combinación inválida.
 * Mismos valores por defecto que el wizard (penalización 100 %, no-show total).
 */
export function cancellationPolicyFromColumns(
  stored: StoredCancellationColumns | null,
): CancellationPolicyDefinition | null {
  if (
    stored === null ||
    !includesValue(CANCELLATION_POLICY_TYPE, stored.cancellation_policy_type)
  ) {
    return null;
  }
  const penalty = stored.cancellation_penalty_type ?? PENALTY_TYPE.PERCENT_100;
  const noShow = stored.no_show_policy ?? NO_SHOW_POLICY.FULL_TOTAL;
  if (
    !includesValue(PENALTY_TYPE, penalty) ||
    !includesValue(NO_SHOW_POLICY, noShow)
  ) {
    return null;
  }
  const policy: CancellationPolicyDefinition = {
    policy_type: stored.cancellation_policy_type,
    deadline_days:
      stored.cancellation_policy_type ===
      CANCELLATION_POLICY_TYPE.FREE_CANCELLATION
        ? nullableNumber(stored.cancellation_deadline_days)
        : null,
    penalty_type: penalty,
    no_show_policy: noShow,
    grace_after_booking_hours: nullableNumber(stored.grace_after_booking_hours),
    early_cancellation_weeks: nullableNumber(stored.early_cancellation_weeks),
  };
  try {
    assertCancellationPolicy(policy);
  } catch {
    return null;
  }
  return policy;
}

/** IANA válida según Intl; si no, null. */
export function validTimezoneOrNull(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return null;
  }
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
