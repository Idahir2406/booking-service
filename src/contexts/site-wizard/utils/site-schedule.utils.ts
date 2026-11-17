import type { ParseResult } from "./site-units.utils";

/**
 * Check-in / check-out schedule of an accommodation (wizard step 6,
 * site_settings.checkin_from / checkin_until / checkout_until). The HOST sets
 * it; the traveler only sees it and may give an estimated arrival time inside
 * the check-in window. Frozen per reservation in the snapshot (`schedule`).
 * Times are local to the accommodation ("HH:MM", 30-minute steps).
 */
export interface SiteSchedule {
  checkin_from: string | null;
  checkin_until: string | null;
  checkout_until: string | null;
}

export const SCHEDULE_FIELDS = [
  "checkin_from",
  "checkin_until",
  "checkout_until",
] as const;

const TIME_RE = /^([01]\d|2[0-3]):(00|30)$/;
const TIME_ANY_MINUTE_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "HH:MM" or "HH:MM:SS" (MySQL TIME) -> "HH:MM"; anything else -> null. */
export function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const short = value.trim().slice(0, 5);
  return TIME_ANY_MINUTE_RE.test(short) ? short : null;
}

export function timeToMinutes(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

export function scheduleFromRow(
  row: Partial<Record<(typeof SCHEDULE_FIELDS)[number], unknown>> | null,
): SiteSchedule | null {
  if (!row) {
    return null;
  }
  const schedule: SiteSchedule = {
    checkin_from: normalizeTime(row.checkin_from),
    checkin_until: normalizeTime(row.checkin_until),
    checkout_until: normalizeTime(row.checkout_until),
  };
  return schedule.checkin_from === null &&
    schedule.checkin_until === null &&
    schedule.checkout_until === null
    ? null
    : schedule;
}

/** Required for publishing: check-in start and check-out time. */
export function isScheduleConfigured(schedule: SiteSchedule | null): boolean {
  return (
    (schedule?.checkin_from ?? null) !== null &&
    (schedule?.checkout_until ?? null) !== null
  );
}

/**
 * `schedule` of PUT /booking-settings. Absent -> undefined (stored schedule
 * untouched, like `cancellation`). Each time is "HH:MM" in 30-minute steps or
 * null/"" (not set). checkin_until must be after checkin_from.
 */
export function parseScheduleInput(
  body: unknown,
): ParseResult<SiteSchedule | undefined> {
  if (typeof body !== "object" || body === null || !("schedule" in body)) {
    return { ok: true, value: undefined };
  }
  const raw = (body as { schedule: unknown }).schedule;
  if (raw === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["schedule: formato no válido"] };
  }
  const record = raw as Record<string, unknown>;
  const errors: string[] = [];
  const value: SiteSchedule = {
    checkin_from: null,
    checkin_until: null,
    checkout_until: null,
  };
  for (const field of SCHEDULE_FIELDS) {
    const item = record[field];
    if (item === undefined || item === null || item === "") {
      continue;
    }
    if (typeof item !== "string" || !TIME_RE.test(item.trim())) {
      errors.push(`schedule.${field}: hora no válida (HH:MM, cada 30 min)`);
      continue;
    }
    value[field] = item.trim();
  }
  if (
    value.checkin_from !== null &&
    value.checkin_until !== null &&
    timeToMinutes(value.checkin_until) <= timeToMinutes(value.checkin_from)
  ) {
    errors.push(
      "schedule.checkin_until: debe ser posterior a la hora de inicio del check-in",
    );
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

/**
 * Spanish one-liner for emails / pages: "Entrada de 15:00 a 21:00 · Salida
 * hasta las 11:00 · Llegada estimada: 18:30". Empty when nothing is set.
 */
export function formatScheduleText(
  schedule: Partial<SiteSchedule> | null | undefined,
  arrivalTime?: string | null,
): string {
  const from = normalizeTime(schedule?.checkin_from);
  const until = normalizeTime(schedule?.checkin_until);
  const out = normalizeTime(schedule?.checkout_until);
  const arrival = normalizeTime(arrivalTime);
  const parts: string[] = [];
  if (from && until) {
    parts.push(`Entrada de ${from} a ${until}`);
  } else if (from) {
    parts.push(`Entrada a partir de las ${from}`);
  }
  if (out) {
    parts.push(`Salida hasta las ${out}`);
  }
  if (arrival) {
    parts.push(`Llegada estimada: ${arrival}`);
  }
  return parts.join(" · ");
}

/**
 * Estimated arrival time given by the traveler at checkout. Optional; when
 * the accommodation has a check-in window it must fall inside it.
 */
export function parseArrivalTime(
  value: unknown,
  schedule: SiteSchedule | null,
): ParseResult<string | null> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value !== "string" || !TIME_RE.test(value.trim())) {
    return {
      ok: false,
      errors: ["arrival_time: hora no válida (HH:MM, cada 30 min)"],
    };
  }
  const time = value.trim();
  const minutes = timeToMinutes(time);
  if (
    schedule?.checkin_from &&
    minutes < timeToMinutes(schedule.checkin_from)
  ) {
    return {
      ok: false,
      errors: [
        `arrival_time: el check-in empieza a las ${schedule.checkin_from}`,
      ],
    };
  }
  if (
    schedule?.checkin_until &&
    minutes > timeToMinutes(schedule.checkin_until)
  ) {
    return {
      ok: false,
      errors: [
        `arrival_time: el check-in termina a las ${schedule.checkin_until}`,
      ],
    };
  }
  return { ok: true, value: time };
}
