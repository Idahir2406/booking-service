import type {
  SiteWizardProperty,
  WizardCompleteness,
  WizardCompletenessItem,
  WizardMissingItem,
} from "../types/site-wizard.types";
import type { ParseResult } from "./site-units.utils";

import { toNumber } from "./site-units.utils";

/**
 * Pure helpers of wizard step 7 ("Revisión"): completeness checklist and the
 * publish (submission) body. No I/O here.
 */

export const COMPLETENESS_WEIGHT = {
  REQUIRED: 2,
  OPTIONAL: 1,
} as const;

export const REVIEW_ITEM = {
  PROPERTY: "property",
  UNITS: "units",
  DOG_POLICY: "dog_policy",
  SUPPLIES_REVIEWED: "supplies_reviewed",
  FEATURES: "features",
  COVER_PHOTO: "cover_photo",
  DESCRIPTION_SHORT: "description_short",
  DESCRIPTION_LONG: "description_long",
  AVAILABILITY: "availability",
  CANCELLATION_POLICY: "cancellation_policy",
  SCHEDULE: "schedule",
  STRIPE: "stripe",
} as const;

export type ReviewItemKey = (typeof REVIEW_ITEM)[keyof typeof REVIEW_ITEM];

interface ReviewItemSpec {
  key: ReviewItemKey;
  step: number;
  label: string;
  required: boolean;
}

/** Checklist in wizard order (labels shown to the owner). */
export const REVIEW_ITEMS: readonly ReviewItemSpec[] = [
  {
    key: REVIEW_ITEM.PROPERTY,
    step: 1,
    label: "Datos del alojamiento completos",
    required: true,
  },
  {
    key: REVIEW_ITEM.UNITS,
    step: 2,
    label: "Al menos una unidad activa",
    required: true,
  },
  {
    key: REVIEW_ITEM.DOG_POLICY,
    step: 3,
    label: "Política de perros completa",
    required: true,
  },
  {
    key: REVIEW_ITEM.SUPPLIES_REVIEWED,
    step: 4,
    label: "Servicios para perros revisados",
    required: false,
  },
  {
    key: REVIEW_ITEM.FEATURES,
    step: 4,
    label: "Características del alojamiento",
    required: false,
  },
  {
    key: REVIEW_ITEM.COVER_PHOTO,
    step: 5,
    label: "Foto de portada",
    required: true,
  },
  {
    key: REVIEW_ITEM.DESCRIPTION_SHORT,
    step: 5,
    label: "Descripción corta",
    required: true,
  },
  {
    key: REVIEW_ITEM.DESCRIPTION_LONG,
    step: 5,
    label: "Descripción larga",
    required: false,
  },
  {
    key: REVIEW_ITEM.AVAILABILITY,
    step: 6,
    label: "Disponibilidad configurada",
    required: true,
  },
  {
    // Required to publish a NEW site; sites already submitted keep the
    // legacy rule until the owner sets one (see buildCompleteness options).
    key: REVIEW_ITEM.CANCELLATION_POLICY,
    step: 6,
    label: "Política de cancelación",
    required: true,
  },
  {
    // Same rule as the cancellation policy: optional for sites submitted
    // before the schedule existed (relaxedItemsFor).
    key: REVIEW_ITEM.SCHEDULE,
    step: 6,
    label: "Horario de entrada y salida",
    required: true,
  },
  {
    key: REVIEW_ITEM.STRIPE,
    step: 6,
    label: "Cobros con Stripe conectados",
    required: false,
  },
];

export type ReviewChecks = Record<ReviewItemKey, boolean>;

export const TERMS_VERSION_MAX = 20;

export interface PublishInput {
  terms_version: string;
  user_id: number;
}

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function filled(value: string | null | undefined): boolean {
  return (value ?? "").trim() !== "";
}

/** Every field step 1 requires (UpdateSitePropertyDto) is present. */
export function isPropertyComplete(property: SiteWizardProperty): boolean {
  return (
    filled(property.name) &&
    filled(property.email) &&
    filled(property.telefono) &&
    property.main_tipsite_id !== null &&
    property.tipo_de_alquiler !== null &&
    property.id_provincia !== null &&
    property.id_poblacion !== null &&
    property.tipenv !== null
  );
}

export interface CompletenessOptions {
  /** Required items treated as optional (e.g. already-submitted sites). */
  optional?: readonly ReviewItemKey[];
}

/**
 * Items added after a site was submitted must not block it: an already
 * submitted site (wizard_completed_at) without a cancellation policy keeps
 * the legacy rule, so that item is optional for it.
 */
export function relaxedItemsFor(submitted: boolean): ReviewItemKey[] {
  return submitted
    ? [REVIEW_ITEM.CANCELLATION_POLICY, REVIEW_ITEM.SCHEDULE]
    : [];
}

export function buildCompleteness(
  checks: ReviewChecks,
  options: CompletenessOptions = {},
): WizardCompleteness {
  const optional = new Set<ReviewItemKey>(options.optional ?? []);
  const items: WizardCompletenessItem[] = REVIEW_ITEMS.map(item => ({
    ...item,
    required: item.required && !optional.has(item.key),
    done: checks[item.key],
  }));
  const weightOf = (item: WizardCompletenessItem) =>
    item.required ? COMPLETENESS_WEIGHT.REQUIRED : COMPLETENESS_WEIGHT.OPTIONAL;
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  const done = items
    .filter(item => item.done)
    .reduce((sum, item) => sum + weightOf(item), 0);
  return {
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    items,
  };
}

export function missingRequired(
  completeness: WizardCompleteness,
): WizardMissingItem[] {
  return completeness.items
    .filter(item => item.required && !item.done)
    .map(({ key, step, label }) => ({ key, step, label }));
}

/** "field: msg" errors of a blocked submission. */
export function missingRequiredErrors(
  missing: readonly WizardMissingItem[],
): string[] {
  return missing.map(item => `${item.key}: ${item.label} (paso ${item.step})`);
}

/** Body of POST /publish: {accept: true, terms_version: 1..20 chars, user_id: int}. */
export function parsePublishInput(body: unknown): ParseResult<PublishInput> {
  if (!isRecord(body)) {
    return { ok: false, errors: ["body: formato no válido"] };
  }
  const errors: string[] = [];
  if (body.accept !== true) {
    errors.push("accept: Debes aceptar las condiciones");
  }

  const rawVersion = body.terms_version;
  const version = typeof rawVersion === "string" ? rawVersion.trim() : "";
  if (version === "") {
    errors.push("terms_version: Obligatorio");
  } else if (version.length > TERMS_VERSION_MAX) {
    errors.push(`terms_version: máximo ${TERMS_VERSION_MAX} caracteres`);
  }

  const userId = toNumber(body.user_id);
  if (!Number.isInteger(userId) || userId < 1 || userId > 2_147_483_647) {
    errors.push("user_id: debe ser un id válido");
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: { terms_version: version, user_id: userId } };
}

/** Optional ?user_id= of GET /review; invalid or absent -> null. */
export function parseOptionalUserId(raw?: unknown): number | null {
  const value = toNumber(raw);
  return Number.isInteger(value) && value >= 1 && value <= 2_147_483_647
    ? value
    : null;
}
