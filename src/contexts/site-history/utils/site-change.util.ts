/**
 * Accommodation change history (phase 2 of the activity history, 2026-11-16):
 * what the host (or V4P) changed in an accommodation and when, as a backup for
 * disputes ("when I booked it said X"). Stored in audit_log (entity "site",
 * entity_id = site id) with only the fields that changed. Pure: no I/O.
 */

export const SITE_AUDIT_ACTION = {
  // Wizard (host with bookings)
  PROPERTY_UPDATED: "site.property_updated",
  UNIT_CREATED: "site.unit_created",
  UNIT_UPDATED: "site.unit_updated",
  UNIT_DELETED: "site.unit_deleted",
  DOG_MAX_PETS_UPDATED: "site.dog_max_pets_updated",
  UNIT_DOG_POLICY_UPDATED: "site.unit_dog_policy_updated",
  UNIT_DOG_POLICY_COPIED: "site.unit_dog_policy_copied",
  SERVICES_UPDATED: "site.services_updated",
  CONTENT_UPDATED: "site.content_updated",
  BOOKING_SETTINGS_UPDATED: "site.booking_settings_updated",
  PUBLISHED: "site.published",
  PHOTOS_CHANGED: "site.photos_changed",
  // Host panel
  AVAILABILITY_CHANGED: "site.availability_changed",
  BLOCK_CREATED: "site.block_created",
  BLOCK_UPDATED: "site.block_updated",
  BLOCK_DELETED: "site.block_deleted",
  STRIPE_ACCOUNT_LINKED: "site.stripe_account_linked",
  // Legacy host (PHP)
  LEGACY_PROFILE_UPDATED: "site.legacy_profile_updated",
  // V4P (admino, PHP)
  ADMIN_UPDATED: "site.admin_updated",
  ADMIN_DELETED: "site.admin_deleted",
} as const;

export type SiteAuditAction =
  (typeof SITE_AUDIT_ACTION)[keyof typeof SITE_AUDIT_ACTION];

const SITE_AUDIT_ACTIONS: ReadonlySet<string> = new Set(
  Object.values(SITE_AUDIT_ACTION),
);

export function isSiteAuditAction(value: unknown): value is SiteAuditAction {
  return typeof value === "string" && SITE_AUDIT_ACTIONS.has(value);
}

/** Actions PHP may report through POST /sites/:siteId/audit. */
export const PHP_SITE_AUDIT_ACTIONS: ReadonlySet<SiteAuditAction> = new Set([
  SITE_AUDIT_ACTION.PHOTOS_CHANGED,
  SITE_AUDIT_ACTION.LEGACY_PROFILE_UPDATED,
  SITE_AUDIT_ACTION.ADMIN_UPDATED,
  SITE_AUDIT_ACTION.ADMIN_DELETED,
]);

export const SITE_AUDIT_SOURCE = {
  WIZARD: "wizard",
  PANEL: "panel",
  LEGACY_PROFILE: "legacy_profile",
  ADMINO: "admino",
} as const;

export type SiteAuditSource =
  (typeof SITE_AUDIT_SOURCE)[keyof typeof SITE_AUDIT_SOURCE];

const SITE_AUDIT_SOURCES: ReadonlySet<string> = new Set(
  Object.values(SITE_AUDIT_SOURCE),
);

export function isSiteAuditSource(value: unknown): value is SiteAuditSource {
  return typeof value === "string" && SITE_AUDIT_SOURCES.has(value);
}

export type FlatValue = string | number | boolean | null;
export type FlatRecord = Record<string, FlatValue>;

export interface FieldDiff {
  before: FlatRecord;
  after: FlatRecord;
}

/** Keys never stored (secrets, bookkeeping noise). */
const IGNORED_KEYS: ReadonlySet<string> = new Set([
  "created_at",
  "updated_at",
  "deleted_at",
  "stripe_account_id",
  "password",
  "wizard_step",
  "customer",
]);

/** Keys that identify an item inside an array of objects (first match wins). */
const ITEM_KEYS = [
  "code",
  "room_id",
  "supply_id",
  "service_id",
  "zone_id",
  "slot",
  "id",
  "key",
  "slug",
  "name",
] as const;

/** Text values longer than this are cut when stored. */
export const MAX_STORED_TEXT = 4000;

const MAX_DEPTH = 6;

function itemKey(item: Record<string, unknown>, index: number): string {
  for (const key of ITEM_KEYS) {
    const value = item[key];
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }
  return String(index);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function toFlatValue(value: unknown): FlatValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > MAX_STORED_TEXT
      ? `${trimmed.slice(0, MAX_STORED_TEXT)}…`
      : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return JSON.stringify(value);
}

function flattenInto(
  out: FlatRecord,
  prefix: string,
  value: unknown,
  depth: number,
): void {
  if (Array.isArray(value)) {
    if (value.every(item => !isPlainObject(item))) {
      out[prefix] = value
        .map(item => String(toFlatValue(item) ?? ""))
        .filter(item => item !== "")
        .sort()
        .join(", ");
      return;
    }
    if (depth >= MAX_DEPTH) {
      out[prefix] = toFlatValue(value);
      return;
    }
    for (const [index, item] of value.entries()) {
      const key = isPlainObject(item) ? itemKey(item, index) : String(index);
      flattenInto(out, `${prefix}[${key}]`, item, depth + 1);
    }
    return;
  }
  if (isPlainObject(value)) {
    if (depth >= MAX_DEPTH) {
      out[prefix] = toFlatValue(value);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (IGNORED_KEYS.has(key)) {
        continue;
      }
      flattenInto(out, prefix === "" ? key : `${prefix}.${key}`, child, depth);
    }
    return;
  }
  out[prefix] = toFlatValue(value);
}

/**
 * Nested object -> dotted keys. Arrays of objects are keyed by code / id /
 * name (`board_options[BB].price`), arrays of scalars become a sorted CSV.
 */
export function flattenForAudit(value: unknown): FlatRecord {
  const out: FlatRecord = {};
  if (value === null || value === undefined) {
    return out;
  }
  flattenInto(out, "", value, 0);
  return out;
}

const NUMERIC = /^-?\d+(?:\.\d+)?$/;

/** null, undefined, "" are the same "empty"; "80.00" equals 80. */
function normalized(value: FlatValue | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string" && NUMERIC.test(value)) {
    return String(Number(value));
  }
  return String(value);
}

/**
 * Only the fields that changed between two states (nested objects allowed).
 * Returns null when nothing changed, so nothing is written.
 */
export function diffForAudit(
  before: unknown,
  after: unknown,
): FieldDiff | null {
  const flatBefore = flattenForAudit(before);
  const flatAfter = flattenForAudit(after);
  const keys = new Set([...Object.keys(flatBefore), ...Object.keys(flatAfter)]);
  const diff: FieldDiff = { before: {}, after: {} };
  let changed = false;
  for (const key of [...keys].sort()) {
    const from = flatBefore[key];
    const to = flatAfter[key];
    if (normalized(from) === normalized(to)) {
      continue;
    }
    changed = true;
    diff.before[key] = from ?? null;
    diff.after[key] = to ?? null;
  }
  return changed ? diff : null;
}
