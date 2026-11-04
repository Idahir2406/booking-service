import {
  board_type_values,
  type BoardTypeValue,
} from "@/contexts/rooms/entities/room-board-option.entity";
import {
  extra_pricing_mode_values,
  type ExtraPricingModeValue,
} from "@/contexts/rooms/entities/room-extra.entity";

/**
 * Pure parsing/validation + derived-field helpers of wizard step 2 ("Unidades").
 * Every error is "field: reason" (nested: "board_options.1.price: ...") so the
 * frontend can flag each input. No I/O here: DB checks live in the service.
 */

export const UNIT_LIMITS = {
  NAME_MAX: 255,
  DESCRIPTION_MAX: 2000,
  PRICE_MIN_EXCLUSIVE: 0,
  PRICE_MAX: 100_000,
  GUESTS_MIN: 1,
  GUESTS_MAX: 50,
  BATHROOMS_MIN: 0,
  BATHROOMS_MAX: 20,
  COPIES_MIN: 1,
  COPIES_MAX: 50,
  COPIES_DEFAULT: 1,
  SUPPLEMENT_MAX: 10_000,
  EXTRAS_MAX: 20,
} as const;

export interface UnitBoardOptionInput {
  code: BoardTypeValue;
  price: number;
  is_included: boolean;
  is_default: boolean;
  is_active: boolean;
}

export interface UnitExtraInput {
  name: string;
  description: string | null;
  pricing_mode: ExtraPricingModeValue;
  price: number;
  is_active: boolean;
}

export interface UnitInput {
  site_unit_id: number;
  name: string;
  description: string | null;
  price_per_night: number;
  max_guests: number;
  bathrooms: number;
  board_options: UnitBoardOptionInput[];
  extras: UnitExtraInput[];
}

export interface CreateUnitInput extends UnitInput {
  copies: number;
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Accepts numbers and numeric strings ("85", "85.5"); anything else -> NaN. */
export function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    return Number(value.trim().replace(",", "."));
  }
  return Number.NaN;
}

function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

/** Collects errors while reading fields of one raw object. */
class FieldReader {
  constructor(
    private readonly source: RawRecord,
    private readonly errors: string[],
    private readonly prefix = "",
  ) {}

  private field(key: string): string {
    return `${this.prefix}${key}`;
  }

  fail(key: string, reason: string): void {
    this.errors.push(`${this.field(key)}: ${reason}`);
  }

  int(key: string, min: number, max: number, fallback?: number): number {
    const raw = this.source[key];
    if (
      (raw === undefined || raw === null || raw === "") &&
      fallback !== undefined
    ) {
      return fallback;
    }
    const value = toNumber(raw);
    if (!Number.isInteger(value)) {
      this.fail(key, "debe ser un número entero");
      return Number.NaN;
    }
    if (value < min || value > max) {
      this.fail(key, `debe estar entre ${min} y ${max}`);
    }
    return value;
  }

  /** Money: 2 decimals max, min inclusive unless `minExclusive`. */
  money(key: string, min: number, max: number, minExclusive = false): number {
    const value = toNumber(this.source[key]);
    if (!Number.isFinite(value)) {
      this.fail(key, "debe ser un número");
      return Number.NaN;
    }
    if (minExclusive ? value <= min : value < min) {
      this.fail(
        key,
        minExclusive ? `debe ser mayor que ${min}` : `debe ser ${min} o más`,
      );
    } else if (value > max) {
      this.fail(key, `no puede ser mayor que ${max}`);
    } else if (!hasAtMostTwoDecimals(value)) {
      this.fail(key, "máximo 2 decimales");
    }
    return value;
  }

  requiredText(key: string, max: number): string {
    const raw = this.source[key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (typeof raw !== "string" || value === "") {
      this.fail(key, "es obligatorio");
    } else if (value.length > max) {
      this.fail(key, `máximo ${max} caracteres`);
    }
    return value;
  }

  optionalText(key: string, max: number): string | null {
    const raw = this.source[key];
    if (raw === undefined || raw === null) {
      return null;
    }
    if (typeof raw !== "string") {
      this.fail(key, "debe ser texto");
      return null;
    }
    const value = raw.trim();
    if (value.length > max) {
      this.fail(key, `máximo ${max} caracteres`);
    }
    return value === "" ? null : value;
  }

  bool(key: string, fallback: boolean): boolean {
    const raw = this.source[key];
    if (raw === undefined || raw === null) {
      return fallback;
    }
    if (typeof raw !== "boolean") {
      this.fail(key, "debe ser verdadero o falso");
      return fallback;
    }
    return raw;
  }

  oneOf<T extends string>(key: string, allowed: readonly T[]): T {
    const raw = this.source[key];
    if (
      typeof raw !== "string" ||
      !(allowed as readonly string[]).includes(raw)
    ) {
      this.fail(key, `valor no válido (${allowed.join(", ")})`);
      return allowed[0];
    }
    return raw as T;
  }
}

export function parseBoardOptions(
  raw: unknown,
  errors: string[],
): UnitBoardOptionInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push("board_options: marca al menos un régimen");
    return [];
  }
  if (raw.length > board_type_values.length) {
    errors.push(`board_options: máximo ${board_type_values.length} regímenes`);
    return [];
  }

  const options: UnitBoardOptionInput[] = [];
  const seen = new Set<string>();

  for (const [index, item] of raw.entries()) {
    const prefix = `board_options.${index}.`;
    if (!isRecord(item)) {
      errors.push(`board_options.${index}: formato no válido`);
      continue;
    }
    const reader = new FieldReader(item, errors, prefix);
    const code = reader.oneOf("code", board_type_values);
    if (seen.has(code)) {
      reader.fail("code", "régimen repetido");
    }
    seen.add(code);

    const is_included = reader.bool("is_included", false);
    const price = reader.money("price", 0, UNIT_LIMITS.SUPPLEMENT_MAX);
    if (is_included && Number.isFinite(price) && price !== 0) {
      reader.fail("price", "debe ser 0 si está incluido en el precio");
    }

    options.push({
      code,
      price,
      is_included,
      is_default: reader.bool("is_default", false),
      is_active: reader.bool("is_active", true),
    });
  }

  const active = options.filter(option => option.is_active);
  if (active.length === 0) {
    errors.push("board_options: marca al menos un régimen activo");
  } else if (active.filter(option => option.is_default).length !== 1) {
    errors.push("board_options: debe haber exactamente un régimen por defecto");
  }
  // RoomBoardOptionsService rule: a single "included in the price" regime
  if (options.filter(option => option.is_included).length > 1) {
    errors.push(
      "board_options: solo un régimen puede estar incluido en el precio",
    );
  }
  return options;
}

export function parseExtras(raw: unknown, errors: string[]): UnitExtraInput[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    errors.push("extras: debe ser una lista");
    return [];
  }
  if (raw.length > UNIT_LIMITS.EXTRAS_MAX) {
    errors.push(`extras: máximo ${UNIT_LIMITS.EXTRAS_MAX} extras`);
    return [];
  }

  const extras: UnitExtraInput[] = [];
  for (const [index, item] of raw.entries()) {
    if (!isRecord(item)) {
      errors.push(`extras.${index}: formato no válido`);
      continue;
    }
    const reader = new FieldReader(item, errors, `extras.${index}.`);
    extras.push({
      name: reader.requiredText("name", UNIT_LIMITS.NAME_MAX),
      description: reader.optionalText(
        "description",
        UNIT_LIMITS.DESCRIPTION_MAX,
      ),
      pricing_mode: reader.oneOf("pricing_mode", extra_pricing_mode_values),
      price: reader.money("price", 0, UNIT_LIMITS.SUPPLEMENT_MAX),
      is_active: reader.bool("is_active", true),
    });
  }
  return extras;
}

function parseUnitFields(body: RawRecord, errors: string[]): UnitInput {
  const reader = new FieldReader(body, errors);
  return {
    site_unit_id: reader.int("site_unit_id", 1, 2_147_483_647),
    name: reader.requiredText("name", UNIT_LIMITS.NAME_MAX),
    description: reader.optionalText(
      "description",
      UNIT_LIMITS.DESCRIPTION_MAX,
    ),
    price_per_night: reader.money(
      "price_per_night",
      UNIT_LIMITS.PRICE_MIN_EXCLUSIVE,
      UNIT_LIMITS.PRICE_MAX,
      true,
    ),
    max_guests: reader.int(
      "max_guests",
      UNIT_LIMITS.GUESTS_MIN,
      UNIT_LIMITS.GUESTS_MAX,
    ),
    bathrooms: reader.int(
      "bathrooms",
      UNIT_LIMITS.BATHROOMS_MIN,
      UNIT_LIMITS.BATHROOMS_MAX,
    ),
    board_options: parseBoardOptions(body.board_options, errors),
    extras: parseExtras(body.extras, errors),
  };
}

/** Body of PATCH /units/:roomId (full replacement, no `copies`). */
export function parseUnitInput(body: unknown): ParseResult<UnitInput> {
  if (!isRecord(body)) {
    return { ok: false, errors: ["body: formato no válido"] };
  }
  const errors: string[] = [];
  const value = parseUnitFields(body, errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

/** Body of POST /units: unit fields + `copies` (1-50, default 1). */
export function parseCreateUnitInput(
  body: unknown,
): ParseResult<CreateUnitInput> {
  if (!isRecord(body)) {
    return { ok: false, errors: ["body: formato no válido"] };
  }
  const errors: string[] = [];
  const value = parseUnitFields(body, errors);
  const copies = new FieldReader(body, errors).int(
    "copies",
    UNIT_LIMITS.COPIES_MIN,
    UNIT_LIMITS.COPIES_MAX,
    UNIT_LIMITS.COPIES_DEFAULT,
  );
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: { ...value, copies } };
}

/**
 * Names of `copies` identical units: "Doble", "Doble 2", "Doble 3"...
 * The base is truncated when needed so every name fits `maxLength`.
 */
export function buildCopyNames(
  name: string,
  copies: number,
  maxLength: number = UNIT_LIMITS.NAME_MAX,
): string[] {
  return Array.from({ length: copies }, (_, index) => {
    if (index === 0) {
      return name.slice(0, maxLength);
    }
    const suffix = ` ${index + 1}`;
    return `${name.slice(0, maxLength - suffix.length).trimEnd()}${suffix}`;
  });
}

export interface DerivableUnit {
  price_per_night: number | string;
  max_guests: number;
  bathrooms: number;
  is_active: boolean;
}

export interface UnitsSummary {
  count: number;
  capacity: number;
  bathrooms: number;
  min_price: number | null;
}

/** Legacy derived columns of v4p_jsites1 (all `text`). */
export interface LegacyDerivedColumns {
  precio: string;
  capacity: string;
  rooms: string;
  banos: string;
}

/** Summary over ACTIVE units only. */
export function summarizeUnits(units: readonly DerivableUnit[]): UnitsSummary {
  const active = units.filter(unit => unit.is_active);
  const prices = active
    .map(unit => Number(unit.price_per_night))
    .filter(price => Number.isFinite(price));
  return {
    count: active.length,
    capacity: active.reduce((sum, unit) => sum + Number(unit.max_guests), 0),
    bathrooms: active.reduce((sum, unit) => sum + Number(unit.bathrooms), 0),
    min_price: prices.length > 0 ? Math.min(...prices) : null,
  };
}

/** 85 -> "85", 85.5 -> "85.5", 85.25 -> "85.25" (no trailing zeros). */
export function formatLegacyPrice(value: number): string {
  return String(Number(value.toFixed(2)));
}

/** precio = "" when there is no active unit (legacy PHP shows no price). */
export function computeLegacyDerivedColumns(
  units: readonly DerivableUnit[],
): LegacyDerivedColumns {
  const summary = summarizeUnits(units);
  return {
    precio:
      summary.min_price === null ? "" : formatLegacyPrice(summary.min_price),
    capacity: String(summary.capacity),
    rooms: String(summary.count),
    banos: String(summary.bathrooms),
  };
}
