import type {
  WizardDogPolicy,
  WizardDogPolicyZone,
} from "../types/site-wizard.types";
import type { ParseResult } from "./site-units.utils";

import { parseCsvIds } from "@/shared/transformers/csv-ids.transformer";

import {
  deposit_return_values,
  left_alone_values,
  supplement_mode_values,
} from "@/contexts/pet-policies/entities/unit-pet-policy.entity";

import { normalizeCsvIds } from "./site-property.utils";
import { toNumber } from "./site-units.utils";

/**
 * Pure parsing/validation + derived-field helpers of wizard step 3 ("Perros").
 * The unit policy is a DRAFT: every field may be null (= not answered). Parsing
 * only rejects wrong types/ranges and incoherent combinations; what is still
 * pending is reported by computeDogPolicyMissing() and enforced on confirm.
 * Errors are "field: reason". No I/O here.
 */

export const DOG_POLICY_LIMITS = {
  MAX_PETS_MIN: 1,
  MAX_PETS_MAX: 5,
  /** rooms.max_pets written when the site has "Sin límite". */
  UNLIMITED_ROOM_MAX_PETS: 99,
  SUPPLEMENT_MIN: 0.01,
  SUPPLEMENT_MAX: 1000,
  DEPOSIT_MIN: 0.01,
  DEPOSIT_MAX: 10_000,
  DEPOSIT_DAYS_MIN: 1,
  DEPOSIT_DAYS_MAX: 60,
  LEFT_ALONE_CONDITIONS_MAX: 500,
  ZONE_OTHER_TEXT_MAX: 150,
  NOTES_MAX: 1000,
} as const;

export const MISSING_REASON = "Obligatorio";

/** Legacy v4p_jtipspec ids derived from the dog policies (v4p_jsites1.tipspec). */
export const DOG_TIPSPEC = {
  FREE_PETS: 2,
  NO_WEIGHT_LIMIT: 3,
  PPP_ALLOWED: 6,
  RESTAURANT: 14,
  TERRACE: 15,
  POOL: 16,
  LEFT_ALONE: 18,
} as const;

export const DOG_MANAGED_TIPSPEC_IDS: readonly number[] =
  Object.values(DOG_TIPSPEC);

/** common_zones.slug -> tipspec id. */
const ZONE_TIPSPEC: Readonly<Record<string, number>> = {
  restaurant: DOG_TIPSPEC.RESTAURANT,
  terrace: DOG_TIPSPEC.TERRACE,
  pool_outdoor: DOG_TIPSPEC.POOL,
};

export interface DogZoneInfo {
  id: number;
  slug: string;
  is_dining_capable: boolean;
  requires_text: boolean;
  is_active: boolean;
}

export interface DogPolicyUnitContext {
  /** Every common zone (inactive included: stored rows may reference them). */
  zonesById: ReadonlyMap<number, DogZoneInfo>;
  isFullUse: boolean;
}

export interface DogPolicyValidationContext extends DogPolicyUnitContext {
  /** Dog size ids of the species "Perro". */
  sizeIds: ReadonlySet<number>;
}

export interface MaxPetsInput {
  max_pets: number | null;
  unlimited: boolean;
}

export interface MaxPetsSettings {
  max_pets: number | null;
  max_pets_unlimited: boolean;
}

export interface DogTipspecContext {
  /** Top-rank size of "Perro" (Extra grande) = "sin restricción de peso". */
  maxRankSizeId: number | null;
  zoneSlugById: ReadonlyMap<number, string>;
}

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null;
}

function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

export function emptyDogPolicy(): WizardDogPolicy {
  return {
    max_size_id: null,
    ppp_allowed: null,
    supplement_mode: null,
    supplement_amount: null,
    left_alone: null,
    left_alone_conditions: null,
    full_unit_access: null,
    deposit_required: null,
    deposit_amount: null,
    deposit_return: null,
    deposit_return_days: null,
    notes: null,
    common_zones_answered: null,
    zones: [],
    dining_zones_answered: null,
    dining_zone_ids: [],
  };
}

/** Reads nullable fields (null/undefined = not answered) collecting errors. */
class NullableReader {
  constructor(
    private readonly source: RawRecord,
    private readonly errors: string[],
  ) {}

  fail(key: string, reason: string): void {
    this.errors.push(`${key}: ${reason}`);
  }

  bool(key: string): boolean | null {
    const raw = this.source[key];
    if (isBlank(raw)) {
      return null;
    }
    if (typeof raw !== "boolean") {
      this.fail(key, "debe ser verdadero o falso");
      return null;
    }
    return raw;
  }

  /** *_answered flags: true (answered) or null (pending). */
  answered(key: string): true | null {
    const raw = this.source[key];
    if (isBlank(raw)) {
      return null;
    }
    if (raw !== true) {
      this.fail(key, "solo admite true o null");
      return null;
    }
    return true;
  }

  int(key: string, min: number, max: number): number | null {
    const raw = this.source[key];
    if (isBlank(raw)) {
      return null;
    }
    const value = toNumber(raw);
    if (!Number.isInteger(value)) {
      this.fail(key, "debe ser un número entero");
      return null;
    }
    if (value < min || value > max) {
      this.fail(key, `debe estar entre ${min} y ${max}`);
      return null;
    }
    return value;
  }

  money(key: string, min: number, max: number): number | null {
    const raw = this.source[key];
    if (isBlank(raw)) {
      return null;
    }
    const value = toNumber(raw);
    if (!Number.isFinite(value)) {
      this.fail(key, "debe ser un número");
      return null;
    }
    if (value < min || value > max) {
      this.fail(key, `debe estar entre ${min} y ${max}`);
      return null;
    }
    if (!hasAtMostTwoDecimals(value)) {
      this.fail(key, "máximo 2 decimales");
      return null;
    }
    return value;
  }

  oneOf<T extends string>(key: string, allowed: readonly T[]): T | null {
    const raw = this.source[key];
    if (isBlank(raw)) {
      return null;
    }
    if (
      typeof raw !== "string" ||
      !(allowed as readonly string[]).includes(raw)
    ) {
      this.fail(key, `valor no válido (${allowed.join(", ")})`);
      return null;
    }
    return raw as T;
  }

  /** Trimmed text; "" -> null. */
  text(key: string, max: number): string | null {
    return readText(this.source[key], key, max, this.errors);
  }
}

function readText(
  raw: unknown,
  key: string,
  max: number,
  errors: string[],
): string | null {
  if (isBlank(raw)) {
    return null;
  }
  if (typeof raw !== "string") {
    errors.push(`${key}: debe ser texto`);
    return null;
  }
  const value = raw.trim();
  if (value.length > max) {
    errors.push(`${key}: máximo ${max} caracteres`);
    return null;
  }
  return value === "" ? null : value;
}

function parseZones(
  raw: unknown,
  zonesById: ReadonlyMap<number, DogZoneInfo>,
  errors: string[],
): WizardDogPolicyZone[] {
  if (isBlank(raw)) {
    return [];
  }
  if (!Array.isArray(raw)) {
    errors.push("zones: debe ser una lista");
    return [];
  }

  const zones: WizardDogPolicyZone[] = [];
  const seen = new Set<number>();
  for (const [index, item] of raw.entries()) {
    if (!isRecord(item)) {
      errors.push(`zones.${index}: formato no válido`);
      continue;
    }
    const zoneId = toNumber(item.zone_id);
    const zone = Number.isInteger(zoneId) ? zonesById.get(zoneId) : undefined;
    if (!zone?.is_active) {
      errors.push(`zones.${index}.zone_id: zona desconocida o inactiva`);
      continue;
    }
    if (seen.has(zoneId)) {
      errors.push(`zones.${index}.zone_id: zona repetida`);
      continue;
    }
    seen.add(zoneId);

    const key = `zones.${zoneId}.other_text`;
    const otherText = readText(
      item.other_text,
      key,
      DOG_POLICY_LIMITS.ZONE_OTHER_TEXT_MAX,
      errors,
    );
    if (otherText !== null && !zone.requires_text) {
      errors.push(`${key}: solo para zonas que requieren texto`);
    }
    zones.push({
      zone_id: zoneId,
      other_text: zone.requires_text ? otherText : null,
    });
  }
  return zones;
}

function parseDiningZoneIds(
  raw: unknown,
  zones: readonly WizardDogPolicyZone[],
  zonesById: ReadonlyMap<number, DogZoneInfo>,
  errors: string[],
): number[] {
  if (isBlank(raw)) {
    return [];
  }
  if (!Array.isArray(raw)) {
    errors.push("dining_zone_ids: debe ser una lista");
    return [];
  }

  const selected = new Set(zones.map(zone => zone.zone_id));
  const ids: number[] = [];
  for (const item of raw) {
    const id = toNumber(item);
    if (!Number.isInteger(id)) {
      errors.push("dining_zone_ids: debe contener ids enteros");
      continue;
    }
    if (ids.includes(id)) {
      errors.push(`dining_zone_ids: zona ${id} repetida`);
      continue;
    }
    if (!selected.has(id) || zonesById.get(id)?.is_dining_capable !== true) {
      errors.push(
        `dining_zone_ids: la zona ${id} no está entre las zonas seleccionadas o no admite comer`,
      );
      continue;
    }
    ids.push(id);
  }
  return ids;
}

/** Body of PUT /units/:roomId/dog-policy (full replacement, draft allowed). */
export function parseDogPolicyInput(
  body: unknown,
  ctx: DogPolicyValidationContext,
): ParseResult<WizardDogPolicy> {
  if (!isRecord(body)) {
    return { ok: false, errors: ["body: formato no válido"] };
  }
  const errors: string[] = [];
  const reader = new NullableReader(body, errors);

  const maxSizeId = reader.int("max_size_id", 1, 2_147_483_647);
  if (maxSizeId !== null && !ctx.sizeIds.has(maxSizeId)) {
    reader.fail("max_size_id", "tamaño desconocido");
  }

  const supplementMode = reader.oneOf(
    "supplement_mode",
    supplement_mode_values,
  );
  const supplementAmount = reader.money(
    "supplement_amount",
    DOG_POLICY_LIMITS.SUPPLEMENT_MIN,
    DOG_POLICY_LIMITS.SUPPLEMENT_MAX,
  );
  if (supplementMode === "none" && !isBlank(body.supplement_amount)) {
    reader.fail("supplement_amount", "debe ser null si no cobras suplemento");
  }

  const leftAlone = reader.oneOf("left_alone", left_alone_values);
  const leftAloneConditions = reader.text(
    "left_alone_conditions",
    DOG_POLICY_LIMITS.LEFT_ALONE_CONDITIONS_MAX,
  );
  if (leftAloneConditions !== null && leftAlone !== "conditional") {
    reader.fail(
      "left_alone_conditions",
      "solo si puede quedarse solo con condiciones",
    );
  }

  const commonZonesAnswered = reader.answered("common_zones_answered");
  const zones = parseZones(body.zones, ctx.zonesById, errors);
  if (zones.length > 0 && commonZonesAnswered !== true) {
    reader.fail(
      "common_zones_answered",
      "debe ser true si hay zonas seleccionadas",
    );
  }

  const diningZonesAnswered = reader.answered("dining_zones_answered");
  const diningZoneIds = parseDiningZoneIds(
    body.dining_zone_ids,
    zones,
    ctx.zonesById,
    errors,
  );
  if (diningZoneIds.length > 0 && diningZonesAnswered !== true) {
    reader.fail(
      "dining_zones_answered",
      "debe ser true si hay zonas para comer seleccionadas",
    );
  }

  const fullUnitAccess = reader.bool("full_unit_access");
  if (fullUnitAccess !== null && !ctx.isFullUse) {
    reader.fail("full_unit_access", "solo para unidades de uso completo");
  }

  const depositRequired = reader.bool("deposit_required");
  const depositAmount = reader.money(
    "deposit_amount",
    DOG_POLICY_LIMITS.DEPOSIT_MIN,
    DOG_POLICY_LIMITS.DEPOSIT_MAX,
  );
  const depositReturn = reader.oneOf("deposit_return", deposit_return_values);
  if (depositRequired !== true) {
    if (!isBlank(body.deposit_amount)) {
      reader.fail("deposit_amount", "solo si pides fianza");
    }
    if (!isBlank(body.deposit_return)) {
      reader.fail("deposit_return", "solo si pides fianza");
    }
  }
  const depositReturnDays = reader.int(
    "deposit_return_days",
    DOG_POLICY_LIMITS.DEPOSIT_DAYS_MIN,
    DOG_POLICY_LIMITS.DEPOSIT_DAYS_MAX,
  );
  if (!isBlank(body.deposit_return_days) && depositReturn !== "days") {
    reader.fail(
      "deposit_return_days",
      "solo si la devolución es en un máximo de días",
    );
  }

  const value: WizardDogPolicy = {
    max_size_id: maxSizeId,
    ppp_allowed: reader.bool("ppp_allowed"),
    supplement_mode: supplementMode,
    supplement_amount: supplementAmount,
    left_alone: leftAlone,
    left_alone_conditions: leftAloneConditions,
    full_unit_access: fullUnitAccess,
    deposit_required: depositRequired,
    deposit_amount: depositAmount,
    deposit_return: depositReturn,
    deposit_return_days: depositReturnDays,
    notes: reader.text("notes", DOG_POLICY_LIMITS.NOTES_MAX),
    common_zones_answered: commonZonesAnswered,
    zones,
    dining_zones_answered: diningZonesAnswered,
    dining_zone_ids: diningZoneIds,
  };
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

/**
 * Fields still required to confirm step 3, in form order. Conditional fields
 * only count when their parent answer makes them relevant. notes never.
 */
export function computeDogPolicyMissing(
  policy: WizardDogPolicy,
  ctx: DogPolicyUnitContext,
): string[] {
  const missing: string[] = [];

  if (policy.max_size_id === null) {
    missing.push("max_size_id");
  }
  if (policy.ppp_allowed === null) {
    missing.push("ppp_allowed");
  }
  if (policy.supplement_mode === null) {
    missing.push("supplement_mode");
  } else if (
    policy.supplement_mode !== "none" &&
    policy.supplement_amount === null
  ) {
    missing.push("supplement_amount");
  }
  if (policy.left_alone === null) {
    missing.push("left_alone");
  } else if (
    policy.left_alone === "conditional" &&
    (policy.left_alone_conditions ?? "").trim() === ""
  ) {
    missing.push("left_alone_conditions");
  }

  if (policy.common_zones_answered !== true) {
    missing.push("common_zones_answered");
  }
  for (const zone of policy.zones) {
    const info = ctx.zonesById.get(zone.zone_id);
    if (info?.requires_text && (zone.other_text ?? "").trim() === "") {
      missing.push(`zones.${zone.zone_id}.other_text`);
    }
  }
  const anyDiningCapable = policy.zones.some(
    zone => ctx.zonesById.get(zone.zone_id)?.is_dining_capable === true,
  );
  if (anyDiningCapable && policy.dining_zones_answered !== true) {
    missing.push("dining_zones_answered");
  }

  if (ctx.isFullUse && policy.full_unit_access === null) {
    missing.push("full_unit_access");
  }

  if (policy.deposit_required === null) {
    missing.push("deposit_required");
  } else if (policy.deposit_required) {
    if (policy.deposit_amount === null) {
      missing.push("deposit_amount");
    }
    if (policy.deposit_return === null) {
      missing.push("deposit_return");
    } else if (
      policy.deposit_return === "days" &&
      policy.deposit_return_days === null
    ) {
      missing.push("deposit_return_days");
    }
  }

  return missing;
}

/** Copy of a unit policy for another unit (full_unit_access only if full use). */
export function copyDogPolicy(
  source: WizardDogPolicy,
  targetIsFullUse: boolean,
): WizardDogPolicy {
  return {
    ...source,
    full_unit_access: targetIsFullUse ? source.full_unit_access : null,
    zones: source.zones.map(zone => ({ ...zone })),
    dining_zone_ids: [...source.dining_zone_ids],
  };
}

/**
 * New v4p_jsites1.tipspec: the dog-managed ids are recomputed from the ACTIVE
 * units' policies ("any unit" rule); every other id is kept. Sorted, unique.
 */
export function deriveDogTipspec(
  currentCsv: string | null,
  activePolicies: readonly WizardDogPolicy[],
  ctx: DogTipspecContext,
): string {
  const managed = new Set(DOG_MANAGED_TIPSPEC_IDS);
  const ids = parseCsvIds(currentCsv).filter(id => !managed.has(id));

  const add = (id: number, when: (policy: WizardDogPolicy) => boolean) => {
    if (activePolicies.some(policy => when(policy))) {
      ids.push(id);
    }
  };

  add(DOG_TIPSPEC.FREE_PETS, policy => policy.supplement_mode === "none");
  add(
    DOG_TIPSPEC.NO_WEIGHT_LIMIT,
    policy =>
      ctx.maxRankSizeId !== null && policy.max_size_id === ctx.maxRankSizeId,
  );
  add(DOG_TIPSPEC.PPP_ALLOWED, policy => policy.ppp_allowed === true);
  for (const [slug, tipspecId] of Object.entries(ZONE_TIPSPEC)) {
    add(tipspecId, policy =>
      policy.zones.some(zone => ctx.zoneSlugById.get(zone.zone_id) === slug),
    );
  }
  add(
    DOG_TIPSPEC.LEFT_ALONE,
    policy =>
      policy.left_alone === "yes" || policy.left_alone === "conditional",
  );

  return normalizeCsvIds(ids);
}

/** Body of PUT /dog-policy/max-pets: {max_pets: 1..5, unlimited: false} or {max_pets: null, unlimited: true}. */
export function parseMaxPetsInput(body: unknown): ParseResult<MaxPetsInput> {
  if (!isRecord(body)) {
    return { ok: false, errors: ["body: formato no válido"] };
  }
  const errors: string[] = [];
  if (typeof body.unlimited !== "boolean") {
    return { ok: false, errors: ["unlimited: debe ser verdadero o falso"] };
  }
  const unlimited = body.unlimited;

  if (unlimited) {
    if (!isBlank(body.max_pets)) {
      errors.push("max_pets: debe ser null si no hay límite");
    }
    return errors.length > 0
      ? { ok: false, errors }
      : { ok: true, value: { max_pets: null, unlimited: true } };
  }

  const maxPets = toNumber(body.max_pets);
  if (!Number.isInteger(maxPets)) {
    errors.push("max_pets: debe ser un número entero");
  } else if (
    maxPets < DOG_POLICY_LIMITS.MAX_PETS_MIN ||
    maxPets > DOG_POLICY_LIMITS.MAX_PETS_MAX
  ) {
    errors.push(
      `max_pets: debe estar entre ${DOG_POLICY_LIMITS.MAX_PETS_MIN} y ${DOG_POLICY_LIMITS.MAX_PETS_MAX}`,
    );
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: { max_pets: maxPets, unlimited: false } };
}

export function isMaxPetsAnswered(settings: MaxPetsSettings | null): boolean {
  return (
    settings !== null &&
    (settings.max_pets_unlimited || settings.max_pets !== null)
  );
}

/** rooms.max_pets for the site setting; null = not answered (keep rooms as is). */
export function roomMaxPetsFor(
  settings: MaxPetsSettings | null,
): number | null {
  if (settings === null || !isMaxPetsAnswered(settings)) {
    return null;
  }
  return settings.max_pets_unlimited
    ? DOG_POLICY_LIMITS.UNLIMITED_ROOM_MAX_PETS
    : settings.max_pets;
}
