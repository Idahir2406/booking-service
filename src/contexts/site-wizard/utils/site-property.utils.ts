import { parseCsvIds } from "@/shared/transformers/csv-ids.transformer";

/** jtipo_de_alquiler ids (what the owner picks in the wizard). */
export const TIPO_DE_ALQUILER = {
  WHOLE_PLACE: 1,
  BY_ROOMS: 2,
} as const;

export type TipoDeAlquiler =
  (typeof TIPO_DE_ALQUILER)[keyof typeof TIPO_DE_ALQUILER];

export const TIPO_DE_ALQUILER_IDS: readonly TipoDeAlquiler[] =
  Object.values(TIPO_DE_ALQUILER);

/** jtiprent ids (legacy search filter kept in sync by PHP). */
export const TIPRENT = {
  HABITACIONES: 1,
  INTEGRO: 2,
} as const;

export type Tiprent = (typeof TIPRENT)[keyof typeof TIPRENT];

const TIPO_DE_ALQUILER_TO_TIPRENT: Record<TipoDeAlquiler, Tiprent> = {
  [TIPO_DE_ALQUILER.WHOLE_PLACE]: TIPRENT.INTEGRO,
  [TIPO_DE_ALQUILER.BY_ROOMS]: TIPRENT.HABITACIONES,
};

export function isTipoDeAlquiler(value: unknown): value is TipoDeAlquiler {
  return TIPO_DE_ALQUILER_IDS.includes(value as TipoDeAlquiler);
}

/** tipo_de_alquiler 1 (whole place) -> tiprent 2; 2 (by rooms) -> tiprent 1. */
export function tiprentFromTipoDeAlquiler(value: TipoDeAlquiler): Tiprent {
  return TIPO_DE_ALQUILER_TO_TIPRENT[value];
}

/**
 * Normalized legacy CSV of ids: positive integers, unique, ascending, no
 * spaces. `required` ids are always included (e.g. main tipsite).
 */
export function normalizeCsvIds(
  ids: readonly number[],
  required: readonly number[] = [],
): string {
  const unique = new Set(
    [...ids, ...required].filter(id => Number.isInteger(id) && id > 0),
  );
  return [...unique].sort((a, b) => a - b).join(",");
}

/** First valid id of a legacy CSV ("0" / "" -> null). */
export function firstCsvId(value: string | null | undefined): number | null {
  return parseCsvIds(value)[0] ?? null;
}

export function parseOptionalInt(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseCoordinate(
  value: string | number | null | undefined,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  if (text === "") {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface WhatsappParts {
  prefix: string | null;
  number: string | null;
}

/**
 * Legacy stores "+34 612345678" (prefix, space, digits). Tolerates extra
 * spaces/dashes in the number. Without a "+prefix<space>" the country code
 * cannot be split reliably, so everything goes to `number` as digits.
 */
export function parseWhatsapp(value: string | null | undefined): WhatsappParts {
  const text = (value ?? "").trim();
  if (text === "") {
    return { prefix: null, number: null };
  }

  const match = /^(\+\d{1,4})[\s-]+(.+)$/.exec(text);
  if (match) {
    const digits = match[2].replaceAll(/\D/g, "");
    return { prefix: match[1], number: digits === "" ? null : digits };
  }

  const digits = text.replaceAll(/\D/g, "");
  return { prefix: null, number: digits === "" ? null : digits };
}

/** "+34" + "612 345 678" -> "+34 612345678"; no number -> "" (column is NOT NULL). */
export function formatWhatsapp(
  prefix: string | null | undefined,
  number: string | null | undefined,
): string {
  const digits = (number ?? "").replaceAll(/\D/g, "");
  if (digits === "") {
    return "";
  }
  const cleanPrefix = (prefix ?? "").trim();
  return cleanPrefix === "" ? digits : `${cleanPrefix} ${digits}`;
}

// Same extra map as PHP jSlugify (inc/global_functions.php) for letters that
// NFD does not decompose into base + combining mark
const SPECIAL_CHARS: Record<string, string> = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
};

/**
 * Port of PHP jSlugify: strip accents, lowercase, every run of
 * [^a-z0-9] -> "-", trim dashes. "Santa Cristina d´Aro" -> "santa-cristina-d-aro".
 * (slugify's strict mode drops "´" instead of turning it into "-", so it
 * would not match the slugs already stored by PHP.)
 */
export function legacySlug(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replaceAll(/[ßæœø]/g, char => SPECIAL_CHARS[char] ?? char)
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}
