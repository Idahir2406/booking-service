import type {
  ProviderHotel,
  ProviderPetPolicy,
} from "../../domain/provider.types";

/**
 * Admin import / link rules (plan phase 2): which provider hotels can become
 * a v4p profile, the pets snapshot the public side reads
 * (provider-reservation.service toPetPolicyView accepts
 * { petsAllowed, petPolicy }) and the content snapshot extras. Pure.
 */

/** Error codes returned to admino (admOps_api.php passes them through). */
export const PROVIDER_ADMIN_ERROR = {
  HOTEL_ALREADY_LINKED: "hotel_already_linked",
  SITE_ALREADY_LINKED: "site_already_linked",
  SITE_NOT_FOUND: "site_not_found",
  PROPERTY_NOT_FOUND: "provider_property_not_found",
  PROVIDER_HOTEL_NOT_FOUND: "provider_hotel_not_found",
  PROVIDER_UNAVAILABLE: "provider_unavailable",
  PETS_NOT_ALLOWED: "pets_not_allowed",
  PETS_POLICY_UNREADABLE: "pets_policy_unreadable",
  PETS_REVIEW_REQUIRED: "pets_review_required",
  POBLACION_NOT_FOUND: "poblacion_not_found",
  PROVINCIA_MISMATCH: "provincia_mismatch",
  INVALID_SEARCH: "invalid_search",
  NOT_IN_PROVIDER_MODE: "not_in_provider_mode",
  INVALID_STATUS_TRANSITION: "invalid_status_transition",
} as const;

export type ProviderAdminError =
  (typeof PROVIDER_ADMIN_ERROR)[keyof typeof PROVIDER_ADMIN_ERROR];

export const IMPORT_ELIGIBILITY = {
  OK: "ok",
  PETS_NOT_ALLOWED: "pets_not_allowed",
  /** Unknown flag or no readable policy: needs force_pets_review. */
  NEEDS_PETS_REVIEW: "needs_pets_review",
} as const;

export type ImportEligibility =
  (typeof IMPORT_ELIGIBILITY)[keyof typeof IMPORT_ELIGIBILITY];

export const PROPERTY_ORIGIN = {
  /** Case A: the admin created the jsites1 profile from the provider. */
  IMPORT: "import",
  /** Case B: an existing v4p profile was linked. */
  LINK: "link",
} as const;

export type PropertyOrigin =
  (typeof PROPERTY_ORIGIN)[keyof typeof PROPERTY_ORIGIN];

export const LEGACY_PROFILE_MODE = {
  LEGACY: "legacy",
  BOOKING: "booking",
  PROVIDER: "provider",
} as const;

export type LegacyProfileMode =
  (typeof LEGACY_PROFILE_MODE)[keyof typeof LEGACY_PROFILE_MODE];

const MIN_POLICY_TEXT_LENGTH = 10;
const SLUG_MAX_LENGTH = 80;

/** Effective "pets allowed": structured policy wins over the top flag. */
export function effectivePetsAllowed(hotel: {
  petsAllowed: boolean | null;
  petPolicy: Pick<ProviderPetPolicy, "allowed">;
}): boolean | null {
  return hotel.petPolicy.allowed ?? hotel.petsAllowed;
}

/**
 * Readable = there is something a traveler can understand: a text of a few
 * words, terms, or a structured fee / weight rule.
 */
export function hasReadablePetPolicy(policy: ProviderPetPolicy): boolean {
  const text = (policy.text ?? "").replaceAll(/<[^>]*>/g, " ").trim();
  if (text.length >= MIN_POLICY_TEXT_LENGTH) {
    return true;
  }
  if ((policy.terms ?? "").trim().length >= MIN_POLICY_TEXT_LENGTH) {
    return true;
  }
  return (
    policy.fee !== null ||
    policy.feeAmountCents !== null ||
    (policy.weightLimit ?? "").trim() !== ""
  );
}

/**
 * Plan: only hotels with petsAllowed=true and a readable pet policy. An
 * explicit "no pets" is never importable; unknown/unreadable needs the
 * admin to force it (publication stays blocked until the review).
 */
export function importEligibility(
  hotel: Pick<ProviderHotel, "petsAllowed" | "petPolicy">,
): ImportEligibility {
  const allowed = effectivePetsAllowed(hotel);
  if (allowed === false) {
    return IMPORT_ELIGIBILITY.PETS_NOT_ALLOWED;
  }
  if (allowed !== true || !hasReadablePetPolicy(hotel.petPolicy)) {
    return IMPORT_ELIGIBILITY.NEEDS_PETS_REVIEW;
  }
  return IMPORT_ELIGIBILITY.OK;
}

/** URL slug like the legacy alias_l1 ("hotel-sol-y-mar"). */
export function slugify(value: string): string {
  const slug = value
    .normalize("NFD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  const cut = slug.slice(0, SLUG_MAX_LENGTH).replaceAll(/-+$/g, "");
  return cut === "" ? "alojamiento" : cut;
}

/** First free slug: base, base-2, base-3... (taken = existing aliases). */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) {
    return base;
  }
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base.slice(0, SLUG_MAX_LENGTH - 4)}-${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return `${base.slice(0, SLUG_MAX_LENGTH - 9)}-${Date.now() % 100_000_000}`;
}

export interface PetsReviewRecord {
  reviewed: boolean;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

/**
 * provider_properties.pets_snapshot. `petsAllowed` + `petPolicy` are what the
 * public rates/quote read; `provider_pet_policy` keeps the provider's raw
 * policy so the admin can compare after editing.
 */
export interface PetsSnapshot extends PetsReviewRecord {
  version: 1;
  petsAllowed: boolean | null;
  petPolicy: ProviderPetPolicy;
  provider_pets_allowed: boolean | null;
  provider_pet_policy: ProviderPetPolicy;
}

export function initialPetsSnapshot(
  hotel: Pick<ProviderHotel, "petsAllowed" | "petPolicy">,
): PetsSnapshot {
  return {
    version: 1,
    petsAllowed: effectivePetsAllowed(hotel),
    petPolicy: { ...hotel.petPolicy },
    provider_pets_allowed: hotel.petsAllowed,
    provider_pet_policy: { ...hotel.petPolicy },
    reviewed: false,
    reviewed_at: null,
    reviewed_by: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Tolerant read of a stored pets_snapshot (older/partial shapes). */
export function readPetsSnapshot(value: unknown): PetsSnapshot | null {
  if (!isRecord(value) || !isRecord(value.petPolicy)) {
    return null;
  }
  const policy = value.petPolicy as unknown as ProviderPetPolicy;
  const providerPolicy = isRecord(value.provider_pet_policy)
    ? (value.provider_pet_policy as unknown as ProviderPetPolicy)
    : policy;
  return {
    version: 1,
    petsAllowed:
      typeof value.petsAllowed === "boolean" ? value.petsAllowed : null,
    petPolicy: policy,
    provider_pets_allowed:
      typeof value.provider_pets_allowed === "boolean"
        ? value.provider_pets_allowed
        : null,
    provider_pet_policy: providerPolicy,
    reviewed: value.reviewed === true,
    reviewed_at:
      typeof value.reviewed_at === "string" ? value.reviewed_at : null,
    reviewed_by:
      typeof value.reviewed_by === "string" ? value.reviewed_by : null,
  };
}

/** Activation gate: pets reviewed by an admin and allowed. */
export function canActivate(snapshot: PetsSnapshot | null): boolean {
  return (
    snapshot !== null &&
    snapshot.reviewed &&
    snapshot.petsAllowed === true &&
    snapshot.petPolicy.allowed !== false
  );
}

export interface ContentSnapshotExtras {
  origin: PropertyOrigin;
  /** profile_mode before the link (restored on unlink). */
  previous_profile_mode: LegacyProfileMode;
  linked_at: string;
  linked_by: string | null;
  /** Photos stay remote until admino downloads them (web owns the files). */
  images_imported_at: string | null;
  images_imported_count: number;
}

export type ContentSnapshot = ProviderHotel & ContentSnapshotExtras;

export function buildContentSnapshot(
  hotel: ProviderHotel,
  extras: Omit<
    ContentSnapshotExtras,
    "images_imported_at" | "images_imported_count"
  >,
): ContentSnapshot {
  return {
    ...hotel,
    ...extras,
    images_imported_at: null,
    images_imported_count: 0,
  };
}

export function readContentExtras(value: unknown): ContentSnapshotExtras {
  const record = isRecord(value) ? value : {};
  const origin =
    record.origin === PROPERTY_ORIGIN.IMPORT
      ? PROPERTY_ORIGIN.IMPORT
      : PROPERTY_ORIGIN.LINK;
  const previous =
    record.previous_profile_mode === LEGACY_PROFILE_MODE.BOOKING
      ? LEGACY_PROFILE_MODE.BOOKING
      : LEGACY_PROFILE_MODE.LEGACY;
  return {
    origin,
    previous_profile_mode: previous,
    linked_at: typeof record.linked_at === "string" ? record.linked_at : "",
    linked_by: typeof record.linked_by === "string" ? record.linked_by : null,
    images_imported_at:
      typeof record.images_imported_at === "string"
        ? record.images_imported_at
        : null,
    images_imported_count:
      typeof record.images_imported_count === "number"
        ? record.images_imported_count
        : 0,
  };
}

/** Previous mode to store on link: 'provider' (stale) falls back to legacy. */
export function toPreviousProfileMode(value: unknown): LegacyProfileMode {
  return value === LEGACY_PROFILE_MODE.BOOKING
    ? LEGACY_PROFILE_MODE.BOOKING
    : LEGACY_PROFILE_MODE.LEGACY;
}

/** "41.385064" for jsites1.geolat/geolng (TEXT columns). */
export function formatCoordinate(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "" : value.toFixed(6);
}
