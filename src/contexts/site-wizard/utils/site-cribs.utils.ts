import type { ParseResult } from "./site-units.utils";

/**
 * Cribs / cots of an accommodation (wizard step 4, site_settings.cribs_*).
 * Model agreed 2026-11-16: maximum per reservation (no per-night inventory);
 * free or paid (per stay / per night); `note` says how to request them.
 */
export interface SiteCribs {
  offered: boolean;
  count: number | null;
  is_paid: boolean;
  price: number | null;
  pricing_mode: "per_stay" | "per_night" | null;
  note: string | null;
}

export const CRIB_LIMITS = {
  COUNT_MAX: 10,
  PRICE_MAX: 1000,
  NOTE_MAX: 255,
} as const;

/** Option id of "Cuna" in the legacy catalog v4p_jfamiliar (jsites1.familiar). */
export const LEGACY_FAMILIAR_CRIB_ID = 1;

export const EMPTY_CRIBS: SiteCribs = {
  offered: false,
  count: null,
  is_paid: false,
  price: null,
  pricing_mode: null,
  note: null,
};

function paidMode(isPaid: boolean, mode: unknown): SiteCribs["pricing_mode"] {
  if (!isPaid) {
    return null;
  }
  return mode === "per_night" ? "per_night" : "per_stay";
}

export function cribsFromRow(
  row: {
    cribs_offered?: unknown;
    cribs_count?: unknown;
    cribs_is_paid?: unknown;
    cribs_price?: unknown;
    cribs_pricing_mode?: unknown;
    cribs_note?: unknown;
  } | null,
): SiteCribs {
  if (!row?.cribs_offered) {
    return { ...EMPTY_CRIBS };
  }
  const isPaid = Boolean(row.cribs_is_paid);
  const price = row.cribs_price === null ? null : Number(row.cribs_price);
  return {
    offered: true,
    count: row.cribs_count === null ? null : Number(row.cribs_count),
    is_paid: isPaid,
    price: isPaid && price !== null && Number.isFinite(price) ? price : null,
    pricing_mode: paidMode(isPaid, row.cribs_pricing_mode),
    note:
      typeof row.cribs_note === "string" && row.cribs_note.trim() !== ""
        ? row.cribs_note.trim()
        : null,
  };
}

/**
 * `cribs` of PUT /services. Absent -> undefined (untouched).
 * offered=false clears everything; offered=true needs count 1..10; paid needs
 * price 0.01..1000 and pricing_mode per_stay|per_night.
 */
export function parseCribsInput(
  body: unknown,
): ParseResult<SiteCribs | undefined> {
  if (typeof body !== "object" || body === null || !("cribs" in body)) {
    return { ok: true, value: undefined };
  }
  const raw = (body as { cribs: unknown }).cribs;
  if (raw === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["cribs: formato no válido"] };
  }
  const record = raw as Record<string, unknown>;
  if (record.offered !== true) {
    return { ok: true, value: { ...EMPTY_CRIBS } };
  }
  const errors: string[] = [];
  const count = Number(record.count);
  if (!Number.isInteger(count) || count < 1 || count > CRIB_LIMITS.COUNT_MAX) {
    errors.push(
      `cribs.count: indica cuántas cunas tienes (1-${CRIB_LIMITS.COUNT_MAX})`,
    );
  }
  const isPaid = record.is_paid === true;
  let price: number | null = null;
  let mode: SiteCribs["pricing_mode"] = null;
  if (isPaid) {
    price = Number(record.price);
    if (
      !Number.isFinite(price) ||
      price < 0.01 ||
      price > CRIB_LIMITS.PRICE_MAX ||
      Math.round(price * 100) !== price * 100
    ) {
      errors.push(
        `cribs.price: precio entre 0,01 y ${CRIB_LIMITS.PRICE_MAX} € (máx. 2 decimales)`,
      );
    }
    if (
      record.pricing_mode === "per_stay" ||
      record.pricing_mode === "per_night"
    ) {
      mode = record.pricing_mode;
    } else {
      errors.push("cribs.pricing_mode: elige por estancia o por noche");
    }
  }
  let note: string | null = null;
  if (record.note !== undefined && record.note !== null && record.note !== "") {
    if (typeof record.note === "string") {
      note = record.note.trim().slice(0, CRIB_LIMITS.NOTE_MAX) || null;
    } else {
      errors.push("cribs.note: formato no válido");
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      offered: true,
      count,
      is_paid: isPaid,
      price: isPaid ? price : null,
      pricing_mode: mode,
      note,
    },
  };
}

/** Adds/removes the legacy "Cuna" option in a jsites1.familiar CSV. */
export function syncFamiliarCrib(csv: string | null, offered: boolean): string {
  const ids = (csv ?? "")
    .split(",")
    .map(part => part.trim())
    .filter(part => part !== "" && part !== "0");
  const crib = String(LEGACY_FAMILIAR_CRIB_ID);
  const without = ids.filter(id => id !== crib);
  return (offered ? [...without, crib] : without).join(",");
}
