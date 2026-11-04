/**
 * F2 payments (dog implementation B2/B3/C2): pure traveler-dog vs unit-policy
 * compatibility. No I/O: the caller loads dog_sizes, the unit policy and the
 * site/room dog limit and passes plain values.
 *
 * Blocking rules (C2): derived size category, number of dogs and PPP. Every
 * violation is returned at once (B3.1 "Varias incompatibilidades") with a
 * structured code and a Spanish message. Messages never include host contact
 * data (C2: no phone/WhatsApp/email/"consultar").
 */

export const DOG_VIOLATION_CODE = {
  SIZE_NOT_ALLOWED: "size_not_allowed",
  PPP_NOT_ALLOWED: "ppp_not_allowed",
  TOO_MANY_DOGS: "too_many_dogs",
  /** dogs[].room_id points to a unit that is not part of the reservation. */
  DOG_ROOM_MISMATCH: "dog_room_mismatch",
} as const;

export type DogViolationCode =
  (typeof DOG_VIOLATION_CODE)[keyof typeof DOG_VIOLATION_CODE];

export const DOG_COMPATIBILITY_MODE = {
  /** Unit has a complete policy (max size + PPP answered): full B3 checks. */
  POLICY: "policy",
  /** No/incomplete policy or no per-dog data: only the dog count is checked. */
  LEGACY: "legacy",
} as const;

export type DogCompatibilityMode =
  (typeof DOG_COMPATIBILITY_MODE)[keyof typeof DOG_COMPATIBILITY_MODE];

export const DOG_LIMIT_SOURCE = {
  SITE_SETTINGS: "site_settings",
  ROOM: "room",
} as const;

export type DogLimitSource =
  (typeof DOG_LIMIT_SOURCE)[keyof typeof DOG_LIMIT_SOURCE];

/** Accepted declared weight range (kg). */
export const DOG_WEIGHT_LIMITS = { MIN_KG: 0.5, MAX_KG: 120 } as const;

export const ALTERNATIVES_HINT =
  "Te mostramos otras opciones compatibles en Viajes 4Patas.";

export interface DogSizeRange {
  id: number;
  name: string;
  slug: string;
  rank: number;
  min_kg: number;
  /** null = no upper bound (top rank, "Extra grande"). */
  max_kg: number | null;
}

export interface DerivedDogSize {
  id: number;
  name: string;
  slug: string;
  rank: number;
}

export interface DeclaredDogInput {
  name?: string | null;
  weight_kg: number;
  is_ppp: boolean;
  room_id?: number | null;
}

export interface DerivedDog {
  index: number;
  name: string | null;
  weight_kg: number;
  is_ppp: boolean;
  room_id: number;
  /** null only if dog_sizes is empty/misconfigured. */
  size: DerivedDogSize | null;
}

/** Blocking fields of unit_pet_policies (null = not answered). */
export interface UnitDogPolicyRules {
  max_size_id: number | null;
  ppp_allowed: boolean | null;
}

export interface DogCountLimit {
  /** null = unlimited ("Sin límite"). */
  max: number | null;
  source: DogLimitSource;
}

/** site_settings dog limit (null row = legacy site without settings). */
export interface SiteDogLimitSettings {
  max_pets: number | null;
  max_pets_unlimited: boolean;
}

export interface DogViolation {
  code: DogViolationCode;
  message: string;
  room_id: number;
  /** Indexes in the declared dogs array (empty for count violations). */
  dog_indexes: number[];
  details: Record<string, unknown>;
}

export interface DogCompatibilityInput {
  /** The (single) unit of the reservation. */
  roomId: number;
  /** Per-dog declaration; null = legacy request with only a pets count. */
  dogs: readonly DeclaredDogInput[] | null;
  /** Used only when `dogs` is null. */
  legacyPetsCount: number;
  sizes: readonly DogSizeRange[];
  policy: UnitDogPolicyRules | null;
  limit: DogCountLimit;
}

export interface DogCompatibilityResult {
  compatible: boolean;
  mode: DogCompatibilityMode;
  /** false when the request only carried a legacy `pets` count. */
  dogs_declared: boolean;
  dog_count: number;
  dogs: DerivedDog[];
  /** Max size admitted by the unit (null = unknown / legacy). */
  max_size: DerivedDogSize | null;
  /** true when the max size is the top rank ("sin límite de peso"). */
  max_size_unlimited: boolean;
  ppp_allowed: boolean | null;
  limit: DogCountLimit;
  violations: DogViolation[];
}

function toNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

/** Normalizes dog_sizes rows (decimals may arrive as strings from mysql2). */
export function normalizeDogSizes(
  rows: readonly {
    id: number;
    name: string;
    slug: string;
    rank: number;
    min_kg: unknown;
    max_kg: unknown;
  }[],
): DogSizeRange[] {
  return rows
    .map(row => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      rank: toNumber(row.rank),
      min_kg: toNumber(row.min_kg),
      max_kg:
        row.max_kg === null || row.max_kg === undefined
          ? null
          : toNumber(row.max_kg),
    }))
    .sort((a, b) => a.rank - b.rank);
}

/** Declared weight rounded to 2 decimals (dog_sizes.min_kg/max_kg scale). */
export function normalizeWeightKg(weight: number): number {
  return Math.round(weight * 100) / 100;
}

/**
 * C2: weight -> size category. First category (by rank) whose upper bound
 * admits the weight; the open-ended top rank catches everything above.
 * Seeds: Pequeño 0–10, Mediano 10.01–20, Grande 20.01–40, Extra grande >40.
 */
export function deriveDogSize(
  weightKg: number,
  sizes: readonly DogSizeRange[],
): DerivedDogSize | null {
  const weight = normalizeWeightKg(weightKg);
  const sorted = [...sizes].sort((a, b) => a.rank - b.rank);
  const match =
    sorted.find(size => size.max_kg === null || weight <= size.max_kg) ??
    sorted.at(-1);
  if (!match) {
    return null;
  }
  return {
    id: match.id,
    name: match.name,
    slug: match.slug,
    rank: match.rank,
  };
}

/**
 * Max dogs per booking: site_settings (wizard step 3) when answered,
 * otherwise rooms.max_pets (legacy sites without settings). The wizard
 * already syncs rooms.max_pets (unlimited -> 99), so both agree for new sites.
 */
export function resolveDogCountLimit(
  settings: SiteDogLimitSettings | null,
  roomMaxPets: number | null | undefined,
): DogCountLimit {
  if (settings?.max_pets_unlimited) {
    return { max: null, source: DOG_LIMIT_SOURCE.SITE_SETTINGS };
  }
  if (settings && settings.max_pets !== null) {
    return {
      max: Number(settings.max_pets),
      source: DOG_LIMIT_SOURCE.SITE_SETTINGS,
    };
  }
  return {
    max: Math.max(0, Number(roomMaxPets ?? 0)),
    source: DOG_LIMIT_SOURCE.ROOM,
  };
}

/** A policy is usable for B3 only with max size AND PPP answered. */
export function isPolicyComplete(
  policy: UnitDogPolicyRules | null,
): policy is { max_size_id: number; ppp_allowed: boolean } {
  if (!policy) {
    return false;
  }
  return policy.max_size_id !== null && policy.ppp_allowed !== null;
}

function dogLabel(dog: DerivedDog): string {
  return dog.name ? `«${dog.name}»` : `n.º ${dog.index + 1}`;
}

function countMessage(max: number): string {
  if (max === 0) {
    return `Esta opción no admite perros. ${ALTERNATIVES_HINT}`;
  }
  const noun = max === 1 ? "perro" : "perros";
  return `Esta opción admite un máximo de ${max} ${noun}. ${ALTERNATIVES_HINT}`;
}

export function evaluateDogCompatibility(
  input: DogCompatibilityInput,
): DogCompatibilityResult {
  const sizes = [...input.sizes].sort((a, b) => a.rank - b.rank);
  const dogsDeclared = input.dogs !== null;
  const dogs: DerivedDog[] = (input.dogs ?? []).map((dog, index) => {
    const name = (dog.name ?? "").trim();
    return {
      index,
      name: name === "" ? null : name.slice(0, 60),
      weight_kg: normalizeWeightKg(dog.weight_kg),
      is_ppp: dog.is_ppp,
      // Single-unit reservations today: unassigned dogs go to that unit (B2.1).
      room_id: dog.room_id ?? input.roomId,
      size: deriveDogSize(dog.weight_kg, sizes),
    };
  });
  const dogCount = dogsDeclared
    ? dogs.length
    : Math.max(0, Math.trunc(input.legacyPetsCount));

  const violations: DogViolation[] = [];

  const mismatched = dogs.filter(dog => dog.room_id !== input.roomId);
  if (mismatched.length > 0) {
    violations.push({
      code: DOG_VIOLATION_CODE.DOG_ROOM_MISMATCH,
      message:
        "Todos los perros deben asignarse a la unidad que estás reservando.",
      room_id: input.roomId,
      dog_indexes: mismatched.map(dog => dog.index),
      details: { room_ids: [...new Set(mismatched.map(dog => dog.room_id))] },
    });
  }

  if (input.limit.max !== null && dogCount > input.limit.max) {
    violations.push({
      code: DOG_VIOLATION_CODE.TOO_MANY_DOGS,
      message: countMessage(input.limit.max),
      room_id: input.roomId,
      dog_indexes: [],
      details: {
        max: input.limit.max,
        declared: dogCount,
        source: input.limit.source,
      },
    });
  }

  const policy = input.policy;
  const maxSizeRow =
    policy?.max_size_id === null || policy?.max_size_id === undefined
      ? null
      : (sizes.find(size => size.id === policy.max_size_id) ?? null);
  const policyUsable =
    dogsDeclared && isPolicyComplete(policy) && maxSizeRow !== null;
  const maxSize: DerivedDogSize | null = maxSizeRow
    ? {
        id: maxSizeRow.id,
        name: maxSizeRow.name,
        slug: maxSizeRow.slug,
        rank: maxSizeRow.rank,
      }
    : null;
  const topRank = sizes.at(-1)?.rank ?? null;
  const maxSizeUnlimited =
    maxSizeRow !== null &&
    (maxSizeRow.max_kg === null || maxSizeRow.rank === topRank);

  if (policyUsable && maxSize) {
    if (!maxSizeUnlimited) {
      for (const dog of dogs) {
        if (dog.size !== null && dog.size.rank > maxSize.rank) {
          violations.push({
            code: DOG_VIOLATION_CODE.SIZE_NOT_ALLOWED,
            message: `El tamaño de tu perro ${dogLabel(dog)} (${dog.weight_kg} kg, ${dog.size.name}) no cumple las condiciones de esta opción, que admite hasta «${maxSize.name}». ${ALTERNATIVES_HINT}`,
            room_id: dog.room_id,
            dog_indexes: [dog.index],
            details: {
              weight_kg: dog.weight_kg,
              size: dog.size.slug,
              max_size: maxSize.slug,
            },
          });
        }
      }
    }
    if (!policy.ppp_allowed) {
      for (const dog of dogs) {
        if (dog.is_ppp) {
          violations.push({
            code: DOG_VIOLATION_CODE.PPP_NOT_ALLOWED,
            message: `Este alojamiento no admite perros PPP (${dogLabel(dog)}). ${ALTERNATIVES_HINT}`,
            room_id: dog.room_id,
            dog_indexes: [dog.index],
            details: {},
          });
        }
      }
    }
  }

  return {
    compatible: violations.length === 0,
    mode: policyUsable
      ? DOG_COMPATIBILITY_MODE.POLICY
      : DOG_COMPATIBILITY_MODE.LEGACY,
    dogs_declared: dogsDeclared,
    dog_count: dogCount,
    dogs,
    max_size: maxSize,
    max_size_unlimited: maxSizeUnlimited,
    ppp_allowed: policy?.ppp_allowed ?? null,
    limit: input.limit,
    violations,
  };
}
