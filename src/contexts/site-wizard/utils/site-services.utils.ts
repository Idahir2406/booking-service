import type {
  WizardAdditionalServiceAnswer,
  WizardDogSupplyAnswer,
  WizardFeatures,
  WizardServiceAnswer,
  WizardServiceRow,
  WizardServicesUpdate,
} from "../types/site-wizard.types";
import type { ParseResult } from "./site-units.utils";

import { parseCsvIds } from "@/shared/transformers/csv-ids.transformer";

import {
  answer_state_values,
  type AnswerStateValue,
} from "@/contexts/shared/types/answer-state";
import {
  service_pricing_mode_values,
  type ServicePricingModeValue,
} from "@/contexts/shared/types/service-pricing-mode";

import { normalizeCsvIds } from "./site-property.utils";
import { toNumber } from "./site-units.utils";

/**
 * Pure parsing/validation + derived-field helpers of wizard step 4
 * ("Servicios"). The whole step is optional: every item may stay
 * "unanswered". Errors are "field: reason" with nested keys
 * ("dog_supplies.12.price", "features.exterior"). No I/O here.
 */

export const SERVICE_LIMITS = {
  PRICE_MIN: 0.01,
  PRICE_MAX: 10_000,
} as const;

/** v4p_jtipspec ids the owner picks by hand in step 4. */
export const TIPSPEC_EXTRA = {
  CATS_ALLOWED: 7,
  SHELTER_SUPPORT: 8,
  SAFE_SPACE: 21,
} as const;

export const TIPSPEC_EXTRA_IDS: readonly number[] =
  Object.values(TIPSPEC_EXTRA);

/** dog_supplies.slug -> v4p_jtipspec id derived when the answer is "yes". */
export const SUPPLY_TIPSPEC: Readonly<Record<string, number>> = {
  "piscina-perros": 9,
  "kit-bienvenida": 10,
  "cama-perro": 11,
  "comedero-bebedero": 12,
  "ducha-perros": 17,
  "zona-recreo": 19,
  bienestar: 20,
};

/** additional_services.slug -> v4p_jtipspec id derived when "yes". */
export const SERVICE_TIPSPEC: Readonly<Record<string, number>> = {
  guarderia: 13,
};

/** Every tipspec id owned by step 4 (step-3 dog policy ids are disjoint). */
export const SERVICES_MANAGED_TIPSPEC_IDS: readonly number[] = [
  ...TIPSPEC_EXTRA_IDS,
  ...Object.values(SUPPLY_TIPSPEC),
  ...Object.values(SERVICE_TIPSPEC),
];

const BODY_KEYS = [
  "dog_supplies",
  "additional_services",
  "features",
  "tipserv",
  "tipspec_extra",
  /** Parsed separately (site-cribs.utils.ts). */
  "cribs",
] as const;

export interface ServicesValidationContext {
  /** Active dog_supplies ids (species "Perro"). */
  supplyIds: ReadonlySet<number>;
  /** Active additional_services ids (species "Perro"). */
  serviceIds: ReadonlySet<number>;
  /** namesql -> (any aux id -> canonical option id), whitelisted groups only. */
  featureOptions: ReadonlyMap<string, ReadonlyMap<number, number>>;
  /** Active v4p_jtipserv ids. */
  tipservIds: ReadonlySet<number>;
  /** Active ids among TIPSPEC_EXTRA_IDS. */
  tipspecExtraIds: ReadonlySet<number>;
}

/** Item whose answer changes in a PUT, for the tipspec derivation. */
export interface SlugAnswer {
  slug: string;
  state: AnswerStateValue;
}

export interface ServicesTipspecChanges {
  /** null = tipspec_extra not sent (extras kept as they are). */
  tipspecExtra: readonly number[] | null;
  supplies: readonly SlugAnswer[];
  services: readonly SlugAnswer[];
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

function hasKey(source: RawRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

export function emptyServiceAnswer(): WizardServiceAnswer {
  return {
    state: "unanswered",
    is_paid: null,
    price: null,
    pricing_mode: null,
  };
}

function parsePrice(
  raw: unknown,
  key: string,
  errors: string[],
): number | null {
  const value = toNumber(raw);
  if (!Number.isFinite(value)) {
    errors.push(`${key}: debe ser un número`);
    return null;
  }
  if (value < SERVICE_LIMITS.PRICE_MIN || value > SERVICE_LIMITS.PRICE_MAX) {
    errors.push(
      `${key}: debe estar entre ${SERVICE_LIMITS.PRICE_MIN} y ${SERVICE_LIMITS.PRICE_MAX}`,
    );
    return null;
  }
  if (!hasAtMostTwoDecimals(value)) {
    errors.push(`${key}: máximo 2 decimales`);
    return null;
  }
  return value;
}

/**
 * One answer. Rules: state yes + is_paid true -> price and pricing_mode
 * required; yes + is_paid false/null -> both null; no/unanswered -> is_paid,
 * price and pricing_mode null.
 */
export function parseServiceAnswer(
  item: RawRecord,
  prefix: string,
  errors: string[],
): WizardServiceAnswer | null {
  const before = errors.length;
  const rawState = item.state;
  if (
    typeof rawState !== "string" ||
    !(answer_state_values as readonly string[]).includes(rawState)
  ) {
    errors.push(
      `${prefix}.state: valor no válido (${answer_state_values.join(", ")})`,
    );
    return null;
  }
  const state = rawState as AnswerStateValue;

  let isPaid: boolean | null = null;
  if (!isBlank(item.is_paid)) {
    if (typeof item.is_paid === "boolean") {
      isPaid = item.is_paid;
    } else {
      errors.push(`${prefix}.is_paid: debe ser verdadero o falso`);
    }
  }

  let pricingMode: ServicePricingModeValue | null = null;
  if (!isBlank(item.pricing_mode)) {
    const raw = item.pricing_mode;
    if (
      typeof raw === "string" &&
      (service_pricing_mode_values as readonly string[]).includes(raw)
    ) {
      pricingMode = raw as ServicePricingModeValue;
    } else {
      errors.push(
        `${prefix}.pricing_mode: valor no válido (${service_pricing_mode_values.join(", ")})`,
      );
    }
  }

  let price: number | null = null;
  if (state === "yes" && isPaid === true) {
    if (isBlank(item.price)) {
      errors.push(`${prefix}.price: obligatorio si es de pago`);
    } else {
      price = parsePrice(item.price, `${prefix}.price`, errors);
    }
    if (isBlank(item.pricing_mode)) {
      errors.push(`${prefix}.pricing_mode: obligatorio si es de pago`);
    }
  } else if (state === "yes") {
    if (!isBlank(item.price)) {
      errors.push(`${prefix}.price: debe ser null si no es de pago`);
    }
    if (!isBlank(item.pricing_mode)) {
      errors.push(`${prefix}.pricing_mode: debe ser null si no es de pago`);
    }
  } else {
    for (const field of ["is_paid", "price", "pricing_mode"] as const) {
      if (!isBlank(item[field])) {
        errors.push(
          `${prefix}.${field}: debe ser null si la respuesta no es sí`,
        );
      }
    }
  }

  if (errors.length > before) {
    return null;
  }
  return state === "yes"
    ? { state, is_paid: isPaid, price, pricing_mode: pricingMode }
    : { ...emptyServiceAnswer(), state };
}

interface AnswerRowsSpec {
  key: "dog_supplies" | "additional_services";
  idKey: "supply_id" | "service_id";
  validIds: ReadonlySet<number>;
}

function parseAnswerRows(
  raw: unknown,
  spec: AnswerRowsSpec,
  errors: string[],
): { id: number; answer: WizardServiceAnswer }[] {
  if (!Array.isArray(raw)) {
    errors.push(`${spec.key}: debe ser una lista`);
    return [];
  }
  const rows: { id: number; answer: WizardServiceAnswer }[] = [];
  const seen = new Set<number>();
  for (const [index, item] of raw.entries()) {
    if (!isRecord(item)) {
      errors.push(`${spec.key}.${index}: formato no válido`);
      continue;
    }
    const id = toNumber(item[spec.idKey]);
    if (!Number.isInteger(id)) {
      errors.push(`${spec.key}.${index}.${spec.idKey}: debe ser un id entero`);
      continue;
    }
    if (!spec.validIds.has(id)) {
      errors.push(`${spec.key}.${id}.${spec.idKey}: desconocido o inactivo`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`${spec.key}.${id}.${spec.idKey}: repetido`);
      continue;
    }
    seen.add(id);
    const answer = parseServiceAnswer(item, `${spec.key}.${id}`, errors);
    if (answer) {
      rows.push({ id, answer });
    }
  }
  return rows;
}

function parseIdList(
  raw: unknown,
  key: string,
  errors: string[],
): number[] | null {
  if (!Array.isArray(raw)) {
    errors.push(`${key}: debe ser una lista de ids`);
    return null;
  }
  const ids: number[] = [];
  for (const item of raw) {
    const id = toNumber(item);
    if (!Number.isInteger(id) || id < 1) {
      errors.push(`${key}: debe contener ids enteros`);
      return null;
    }
    if (!ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

function parseFeatures(
  raw: unknown,
  featureOptions: ServicesValidationContext["featureOptions"],
  errors: string[],
): WizardFeatures {
  if (!isRecord(raw)) {
    errors.push("features: debe ser un objeto { grupo: [ids] }");
    return {};
  }
  const features: WizardFeatures = {};
  for (const [namesql, value] of Object.entries(raw)) {
    const key = `features.${namesql}`;
    const aliases = featureOptions.get(namesql);
    if (!aliases) {
      errors.push(`${key}: grupo no válido`);
      continue;
    }
    const ids = parseIdList(value, key, errors);
    if (ids === null) {
      continue;
    }
    const unknown = ids.filter(id => !aliases.has(id));
    if (unknown.length > 0) {
      errors.push(`${key}: opciones no válidas ${unknown.join(",")}`);
      continue;
    }
    features[namesql] = [...new Set(ids.map(id => aliases.get(id) ?? id))].sort(
      (a, b) => a - b,
    );
  }
  return features;
}

function parseCatalogIds(
  raw: unknown,
  key: string,
  validIds: ReadonlySet<number>,
  errors: string[],
): number[] | undefined {
  const ids = parseIdList(raw, key, errors);
  if (ids === null) {
    return undefined;
  }
  const invalid = ids.filter(id => !validIds.has(id));
  if (invalid.length > 0) {
    errors.push(`${key}: ids no válidos o inactivos ${invalid.join(",")}`);
    return undefined;
  }
  return [...ids].sort((a, b) => a - b);
}

/** Body of PUT /services. Partial: only the keys present are returned. */
export function parseServicesInput(
  body: unknown,
  ctx: ServicesValidationContext,
): ParseResult<WizardServicesUpdate> {
  if (!isRecord(body)) {
    return { ok: false, errors: ["body: formato no válido"] };
  }
  const errors: string[] = [];
  for (const key of Object.keys(body)) {
    if (!(BODY_KEYS as readonly string[]).includes(key)) {
      errors.push(`${key}: campo desconocido`);
    }
  }

  const value: WizardServicesUpdate = {};
  if (hasKey(body, "dog_supplies")) {
    value.dog_supplies = parseAnswerRows(
      body.dog_supplies,
      { key: "dog_supplies", idKey: "supply_id", validIds: ctx.supplyIds },
      errors,
    ).map(
      ({ id, answer }): WizardDogSupplyAnswer => ({ supply_id: id, ...answer }),
    );
  }
  if (hasKey(body, "additional_services")) {
    value.additional_services = parseAnswerRows(
      body.additional_services,
      {
        key: "additional_services",
        idKey: "service_id",
        validIds: ctx.serviceIds,
      },
      errors,
    ).map(
      ({ id, answer }): WizardAdditionalServiceAnswer => ({
        service_id: id,
        ...answer,
      }),
    );
  }
  if (hasKey(body, "features")) {
    value.features = parseFeatures(body.features, ctx.featureOptions, errors);
  }
  if (hasKey(body, "tipserv")) {
    value.tipserv = parseCatalogIds(
      body.tipserv,
      "tipserv",
      ctx.tipservIds,
      errors,
    );
  }
  if (hasKey(body, "tipspec_extra")) {
    value.tipspec_extra = parseCatalogIds(
      body.tipspec_extra,
      "tipspec_extra",
      ctx.tipspecExtraIds,
      errors,
    );
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

/**
 * New v4p_jsites1.tipspec after a step-4 save. Only what the request touched
 * is recomputed, so ids set by legacy PHP for items the owner never answered
 * survive: extras (7, 8, 21) are replaced when tipspec_extra was sent; each
 * derived id is set/cleared from the answer of its supply/service when that
 * item was sent. Every other id (step-3 dog policy ids...) is kept.
 */
export function deriveServicesTipspec(
  currentCsv: string | null,
  changes: ServicesTipspecChanges,
): string {
  const remove = new Set<number>();
  const add = new Set<number>();

  if (changes.tipspecExtra !== null) {
    for (const id of TIPSPEC_EXTRA_IDS) {
      remove.add(id);
    }
    for (const id of changes.tipspecExtra) {
      if (TIPSPEC_EXTRA_IDS.includes(id)) {
        add.add(id);
      }
    }
  }

  const apply = (
    answers: readonly SlugAnswer[],
    map: Readonly<Record<string, number>>,
  ) => {
    for (const answer of answers) {
      const id = map[answer.slug] as number | undefined;
      if (id === undefined) {
        continue;
      }
      remove.add(id);
      if (answer.state === "yes") {
        add.add(id);
      } else {
        add.delete(id);
      }
    }
  };
  apply(changes.supplies, SUPPLY_TIPSPEC);
  apply(changes.services, SERVICE_TIPSPEC);

  const kept = parseCsvIds(currentCsv).filter(id => !remove.has(id));
  return normalizeCsvIds([...kept, ...add]);
}

/** Selected manual extras stored in a tipspec CSV. */
export function tipspecExtraFrom(
  currentCsv: string | null,
  available: ReadonlySet<number>,
): number[] {
  return parseCsvIds(currentCsv)
    .filter(id => available.has(id))
    .sort((a, b) => a - b);
}

/** Legacy CSV of a feature column -> canonical option ids (unknown dropped). */
export function featureIdsFrom(
  currentCsv: string | null,
  aliases: ReadonlyMap<number, number>,
): number[] {
  const ids = parseCsvIds(currentCsv)
    .map(id => aliases.get(id))
    .filter((id): id is number => id !== undefined);
  return [...new Set(ids)].sort((a, b) => a - b);
}

/**
 * GET row of one supply/service. A stored answer always wins; without one,
 * the item is prefilled as "yes" (free, no price) when its derived tipspec id
 * is already in the legacy jsites1.tipspec (set by PHP before the wizard).
 */
export function serviceRowFor(
  stored: WizardServiceAnswer | undefined,
  derivedTipspecId: number | undefined,
  tipspecIds: ReadonlySet<number>,
): WizardServiceRow {
  if (stored) {
    return { ...stored, prefilled: false };
  }
  if (derivedTipspecId !== undefined && tipspecIds.has(derivedTipspecId)) {
    return {
      state: "yes",
      is_paid: false,
      price: null,
      pricing_mode: null,
      prefilled: true,
    };
  }
  return { ...emptyServiceAnswer(), prefilled: false };
}
