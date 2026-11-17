import type {
  SnapshotDeposit,
  SnapshotDog,
  SnapshotDogPolicy,
  SnapshotDogSizeRef,
  SnapshotDogZone,
  SnapshotF2Extension,
  SnapshotSelectedExtra,
  SnapshotSelectedService,
} from "../../payments/domain/reservation-snapshot";

import { type PriceLineDraft } from "../../payments/domain/price-lines";
import {
  DOG_SUPPLEMENT_MODE_LABEL,
  dogSupplementFormula,
  type DogSupplementMode,
  EXTRA_PRICING_MODE_LABEL,
  extraFormula,
  type PricedExtraOption,
  type PricedServiceOption,
  priceReservation,
  type PricingBoard,
  type ReservationPricing,
  type SelectedService,
  SERVICE_PRICING_MODE_LABEL,
  serviceFormula,
  type ServiceSelectionType,
} from "../../payments/domain/reservation-pricing";
import {
  type Cents,
  formatMoney,
  toCents,
} from "../../payments/utils/money.util";
import {
  type DeclaredDogInput,
  type DogCompatibilityResult,
  type DogSizeRange,
  evaluateDogCompatibility,
  isPolicyComplete,
  resolveDogCountLimit,
  type SiteDogLimitSettings,
} from "../../pet-policies/domain/dog-compatibility";

/**
 * F2: pure assembly of everything a quote/checkout derives from the wizard
 * data: dog compatibility (B3), selected paid services/extras, price lines
 * (same function for quote and checkout), informative deposit (A26/C6) and
 * the snapshot extension (C7/A10). No I/O.
 */

export const SELECTION_ISSUE_CODE = {
  SERVICE_NOT_AVAILABLE: "service_not_available",
  SERVICE_DUPLICATED: "service_duplicated",
  SERVICE_REQUIRES_DOGS: "service_requires_dogs",
  EXTRA_NOT_AVAILABLE: "extra_not_available",
  EXTRA_DUPLICATED: "extra_duplicated",
} as const;

export type SelectionIssueCode =
  (typeof SELECTION_ISSUE_CODE)[keyof typeof SELECTION_ISSUE_CODE];

export interface SelectionIssue {
  code: SelectionIssueCode;
  message: string;
  type: ServiceSelectionType | "extra";
  id: number;
}

export interface UnitDogPolicyZoneInput {
  zone_id: number;
  slug: string | null;
  name: string | null;
  allows_dining: boolean;
  other_text: string | null;
}

/** Plain copy of unit_pet_policies (+ zones) used by the pure functions. */
export interface UnitDogPolicyInput {
  id: number;
  room_id: number;
  species_id: number;
  max_size_id: number | null;
  ppp_allowed: boolean | null;
  supplement_mode: DogSupplementMode | null;
  supplement_amount: number | string | null;
  left_alone: string | null;
  left_alone_conditions: string | null;
  full_unit_access: boolean | null;
  deposit_required: boolean | null;
  deposit_amount: number | string | null;
  deposit_return: string | null;
  deposit_return_days: number | null;
  common_zones_answered: boolean | null;
  dining_zones_answered: boolean | null;
  notes: string | null;
  zones: UnitDogPolicyZoneInput[];
}

export interface ServiceSelectionInput {
  type: ServiceSelectionType;
  id: number;
  quantity?: number;
}

export interface ExtraSelectionInput {
  id: number;
}

export interface QuotePricingInput {
  roomId: number;
  roomName: string | null;
  roomMaxPets: number | null;
  nightlyRateCents: Cents;
  nights: number;
  guests: number;
  board: PricingBoard | null;
  /** null = legacy request (only `pets`). */
  dogs: readonly DeclaredDogInput[] | null;
  legacyPets: number;
  serviceSelections: readonly ServiceSelectionInput[];
  extraSelections: readonly ExtraSelectionInput[];
  sizes: readonly DogSizeRange[];
  policy: UnitDogPolicyInput | null;
  siteSettings: SiteDogLimitSettings | null;
  dogServices: readonly PricedServiceOption[];
  additionalServices: readonly PricedServiceOption[];
  roomExtras: readonly PricedExtraOption[];
  /** Cribs requested by the traveler (0 = none). */
  cribsRequested?: number;
  /** Site crib offer (null = no cribs offered). */
  cribOffer?: CribOffer | null;
}

/** Crib offer of the site (site_settings.cribs_*), public in the quote. */
export interface CribOffer {
  count: number;
  is_paid: boolean;
  price_cents: Cents;
  pricing_mode: "per_stay" | "per_night";
  note: string | null;
}

/** Paid option the traveler may add in checkout (with its estimate). */
export interface AvailableServiceOption {
  type: ServiceSelectionType;
  id: number;
  name: string;
  price_cents: Cents;
  pricing_mode: string;
  pricing_mode_label: string;
  /** Amount for the current stay with quantity 1 (0 if it needs dogs). */
  estimated_amount_cents: Cents;
  estimated_detail: string;
  requires_dogs: boolean;
  selected: boolean;
  quantity: number;
}

export interface AvailableExtraOption {
  id: number;
  name: string;
  description: string | null;
  price_cents: Cents;
  pricing_mode: string;
  pricing_mode_label: string;
  estimated_amount_cents: Cents;
  estimated_detail: string;
  selected: boolean;
}

export interface QuotePricingOutcome {
  compatibility: DogCompatibilityResult;
  selectionIssues: SelectionIssue[];
  pricing: ReservationPricing;
  selectedServices: SelectedService[];
  selectedExtras: PricedExtraOption[];
  dogPolicy: SnapshotDogPolicy | null;
  deposit: SnapshotDeposit | null;
  availableServices: AvailableServiceOption[];
  availableExtras: AvailableExtraOption[];
  snapshotExtension: SnapshotF2Extension;
  /** Crib request problems (not offered / more than available). */
  cribIssues: string[];
  /** Cribs actually booked (0 when invalid). */
  cribs: number;
}

/** Validates the crib request against the site offer (max per reservation). */
export function resolveCribs(
  requested: number | undefined,
  offer: CribOffer | null | undefined,
): { cribs: number; issues: string[] } {
  const quantity = Math.max(0, Math.trunc(Number(requested ?? 0)));
  if (quantity === 0) {
    return { cribs: 0, issues: [] };
  }
  if (!offer || offer.count < 1) {
    return {
      cribs: 0,
      issues: ["El alojamiento no ofrece cunas."],
    };
  }
  if (quantity > offer.count) {
    return {
      cribs: 0,
      issues: [
        offer.count === 1
          ? "El alojamiento solo dispone de 1 cuna."
          : `El alojamiento solo dispone de ${offer.count} cunas.`,
      ],
    };
  }
  return { cribs: quantity, issues: [] };
}

export const DEPOSIT_NOT_CHARGED_NOTE =
  "La fianza la gestiona el alojamiento; no se cobra en Viajes 4Patas.";

function isPerPetMode(mode: string): boolean {
  return mode === "per_pet_night" || mode === "per_pet_stay";
}

/** B6/C6/A26: informative deposit; never a price line. */
export function buildDepositInfo(
  policy: UnitDogPolicyInput | null,
): SnapshotDeposit | null {
  const required = policy?.deposit_required ?? null;
  if (policy === null || required === null) {
    return null;
  }
  if (!required) {
    return {
      required: false,
      amount_cents: null,
      return_mode: null,
      return_days: null,
      charged_by_v4p: false,
      message: null,
    };
  }
  const amountCents =
    policy.deposit_amount === null ? null : toCents(policy.deposit_amount);
  let returnText = "";
  if (policy.deposit_return === "end_of_stay") {
    returnText = " Devolución: al finalizar la estancia.";
  } else if (
    policy.deposit_return === "days" &&
    policy.deposit_return_days !== null
  ) {
    returnText = ` Devolución: en un plazo máximo de ${policy.deposit_return_days} días después de la salida.`;
  }
  const amountText =
    amountCents === null ? "" : `: ${formatMoney(amountCents)}`;
  return {
    required: true,
    amount_cents: amountCents,
    return_mode: policy.deposit_return,
    return_days: policy.deposit_return_days,
    charged_by_v4p: false,
    message: `Fianza por posibles daños${amountText}. Se abonará directamente al alojamiento y no está incluida en el importe de esta reserva.${returnText} ${DEPOSIT_NOT_CHARGED_NOTE}`,
  };
}

function sizeRef(size: DogSizeRange): SnapshotDogSizeRef {
  return { id: size.id, name: size.name, slug: size.slug, rank: size.rank };
}

export function buildDogPolicySnapshot(
  policy: UnitDogPolicyInput | null,
  compatibility: DogCompatibilityResult,
  sizes: readonly DogSizeRange[],
  roomId: number,
  supplementTotalCents: Cents,
): SnapshotDogPolicy | null {
  if (policy === null) {
    return null;
  }
  const maxRank = compatibility.max_size?.rank ?? null;
  const zones: SnapshotDogZone[] = policy.zones.map(zone => ({ ...zone }));
  return {
    policy_id: policy.id,
    room_id: roomId,
    species_id: policy.species_id,
    complete: isPolicyComplete(policy),
    max_size: compatibility.max_size ? { ...compatibility.max_size } : null,
    max_size_unlimited: compatibility.max_size_unlimited,
    admitted_sizes:
      maxRank === null
        ? []
        : sizes.filter(size => size.rank <= maxRank).map(size => sizeRef(size)),
    ppp_allowed: policy.ppp_allowed,
    max_dogs: compatibility.limit.max,
    max_dogs_source: compatibility.limit.source,
    supplement_mode: policy.supplement_mode,
    supplement_amount_cents:
      policy.supplement_amount === null
        ? null
        : toCents(policy.supplement_amount),
    supplement_total_cents: supplementTotalCents,
    left_alone: policy.left_alone,
    left_alone_conditions: policy.left_alone_conditions,
    common_zones_answered: policy.common_zones_answered,
    dining_zones_answered: policy.dining_zones_answered,
    zones,
    full_unit_access: policy.full_unit_access,
    deposit: buildDepositInfo(policy) ?? {
      required: null,
      amount_cents: null,
      return_mode: null,
      return_days: null,
      charged_by_v4p: false,
      message: null,
    },
    notes: policy.notes,
  };
}

function resolveServices(
  input: QuotePricingInput,
  dogCount: number,
  issues: SelectionIssue[],
): SelectedService[] {
  const catalog = [...input.dogServices, ...input.additionalServices];
  const seen = new Set<string>();
  const selected: SelectedService[] = [];
  for (const selection of input.serviceSelections) {
    const key = `${selection.type}:${selection.id}`;
    if (seen.has(key)) {
      issues.push({
        code: SELECTION_ISSUE_CODE.SERVICE_DUPLICATED,
        message: "Has seleccionado el mismo servicio más de una vez.",
        type: selection.type,
        id: selection.id,
      });
      continue;
    }
    seen.add(key);
    const option = catalog.find(
      item => item.type === selection.type && item.id === selection.id,
    );
    if (!option) {
      issues.push({
        code: SELECTION_ISSUE_CODE.SERVICE_NOT_AVAILABLE,
        message: "Uno de los servicios seleccionados ya no está disponible.",
        type: selection.type,
        id: selection.id,
      });
      continue;
    }
    if (isPerPetMode(option.pricing_mode) && dogCount === 0) {
      issues.push({
        code: SELECTION_ISSUE_CODE.SERVICE_REQUIRES_DOGS,
        message: `«${option.name}» se cobra por perro: indica al menos un perro.`,
        type: selection.type,
        id: selection.id,
      });
      continue;
    }
    selected.push({ option, quantity: selection.quantity ?? 1 });
  }
  return selected;
}

function resolveExtras(
  input: QuotePricingInput,
  issues: SelectionIssue[],
): PricedExtraOption[] {
  const seen = new Set<number>();
  const selected: PricedExtraOption[] = [];
  for (const selection of input.extraSelections) {
    if (seen.has(selection.id)) {
      issues.push({
        code: SELECTION_ISSUE_CODE.EXTRA_DUPLICATED,
        message: "Has seleccionado el mismo extra más de una vez.",
        type: "extra",
        id: selection.id,
      });
      continue;
    }
    seen.add(selection.id);
    const extra = input.roomExtras.find(item => item.id === selection.id);
    if (!extra) {
      issues.push({
        code: SELECTION_ISSUE_CODE.EXTRA_NOT_AVAILABLE,
        message: "Uno de los extras seleccionados ya no está disponible.",
        type: "extra",
        id: selection.id,
      });
      continue;
    }
    selected.push(extra);
  }
  return selected;
}

function lineAmountOf(
  lines: readonly PriceLineDraft[],
  predicate: (line: PriceLineDraft) => boolean,
): Cents {
  return lines
    .filter(line => predicate(line))
    .reduce((sum, line) => sum + line.amount_cents, 0);
}

export function assembleQuotePricing(
  input: QuotePricingInput,
): QuotePricingOutcome {
  const compatibility = evaluateDogCompatibility({
    roomId: input.roomId,
    dogs: input.dogs,
    legacyPetsCount: input.legacyPets,
    sizes: input.sizes,
    policy: input.policy,
    limit: resolveDogCountLimit(input.siteSettings, input.roomMaxPets),
  });
  const dogCount = compatibility.dog_count;
  const stay = { nights: input.nights, guests: input.guests, dogs: dogCount };

  const issues: SelectionIssue[] = [];
  const selectedServices = resolveServices(input, dogCount, issues);
  const selectedExtras = resolveExtras(input, issues);
  const cribResult = resolveCribs(input.cribsRequested, input.cribOffer);
  const cribOffer = input.cribOffer ?? null;

  const supplementRule = input.policy
    ? {
        mode: input.policy.supplement_mode,
        amount_cents:
          input.policy.supplement_amount === null
            ? null
            : toCents(input.policy.supplement_amount),
      }
    : null;

  const pricing = priceReservation({
    stay,
    room: {
      id: input.roomId,
      name: input.roomName,
      price_per_night_cents: input.nightlyRateCents,
    },
    board: input.board,
    dogSupplement: supplementRule,
    services: selectedServices,
    extras: selectedExtras,
    cribs:
      cribOffer && cribResult.cribs > 0 && cribOffer.is_paid
        ? {
            quantity: cribResult.cribs,
            price_cents: cribOffer.price_cents,
            pricing_mode: cribOffer.pricing_mode,
          }
        : null,
    touristTax: null,
  });

  const supplementTotal = lineAmountOf(
    pricing.lines,
    line => line.type === "dog_supplement",
  );
  const dogPolicy = buildDogPolicySnapshot(
    input.policy,
    compatibility,
    input.sizes,
    input.roomId,
    supplementTotal,
  );
  const deposit = buildDepositInfo(input.policy);

  const availableServices: AvailableServiceOption[] = [
    ...input.dogServices,
    ...input.additionalServices,
  ].map(option => {
    const chosen = selectedServices.find(
      item => item.option.type === option.type && item.option.id === option.id,
    );
    const formula = serviceFormula(
      option.pricing_mode,
      option.price_cents,
      stay,
    );
    return {
      type: option.type,
      id: option.id,
      name: option.name,
      price_cents: option.price_cents,
      pricing_mode: option.pricing_mode,
      pricing_mode_label: SERVICE_PRICING_MODE_LABEL[option.pricing_mode],
      estimated_amount_cents: option.price_cents * formula.multiplier,
      estimated_detail: formula.detail,
      requires_dogs: isPerPetMode(option.pricing_mode),
      selected: chosen !== undefined,
      quantity: chosen?.quantity ?? 1,
    };
  });

  const availableExtras: AvailableExtraOption[] = input.roomExtras.map(
    extra => {
      const formula = extraFormula(extra.pricing_mode, extra.price_cents, stay);
      return {
        id: extra.id,
        name: extra.name,
        description: extra.description,
        price_cents: extra.price_cents,
        pricing_mode: extra.pricing_mode,
        pricing_mode_label: EXTRA_PRICING_MODE_LABEL[extra.pricing_mode],
        estimated_amount_cents: extra.price_cents * formula.multiplier,
        estimated_detail: formula.detail,
        selected: selectedExtras.some(item => item.id === extra.id),
      };
    },
  );

  const findAmount = (predicate: (line: PriceLineDraft) => boolean) =>
    lineAmountOf(pricing.lines, predicate);

  const services: SnapshotSelectedService[] = selectedServices.map(item => ({
    type: item.option.type,
    id: item.option.id,
    name: item.option.name,
    pricing_mode: item.option.pricing_mode,
    price_cents: item.option.price_cents,
    quantity: item.quantity,
    amount_cents: findAmount(
      line =>
        line.metadata?.selection_type === item.option.type &&
        line.metadata.service_id === item.option.id,
    ),
  }));
  const extras: SnapshotSelectedExtra[] = selectedExtras.map(extra => ({
    id: extra.id,
    name: extra.name,
    pricing_mode: extra.pricing_mode,
    price_cents: extra.price_cents,
    amount_cents: findAmount(
      line => line.type === "extra" && line.metadata?.extra_id === extra.id,
    ),
  }));
  const dogs: SnapshotDog[] = compatibility.dogs.map(dog => ({
    ...dog,
    size: dog.size === null ? null : { ...dog.size },
  }));

  return {
    compatibility,
    selectionIssues: issues,
    pricing,
    selectedServices,
    selectedExtras,
    dogPolicy,
    deposit,
    availableServices,
    availableExtras,
    snapshotExtension: {
      dogs,
      compatibility: {
        mode: compatibility.mode,
        compatible: compatibility.compatible,
        dogs_declared: compatibility.dogs_declared,
      },
      dog_policy: dogPolicy,
      services,
      extras,
      deposit,
      tourist_tax: null,
      cribs:
        cribResult.cribs > 0 && cribOffer
          ? {
              quantity: cribResult.cribs,
              is_paid: cribOffer.is_paid,
              price_cents: cribOffer.is_paid ? cribOffer.price_cents : 0,
              pricing_mode: cribOffer.pricing_mode,
            }
          : null,
    },
    cribIssues: cribResult.issues,
    cribs: cribResult.cribs,
  };
}

/** Public dog policy summary for the checkout UI (no free-text notes, C2). */
export interface PublicDogPolicySummary {
  complete: boolean;
  max_size: SnapshotDogSizeRef | null;
  max_size_unlimited: boolean;
  ppp_allowed: boolean | null;
  max_dogs: number | null;
  supplement_mode: string | null;
  supplement_mode_label: string | null;
  supplement_amount_cents: Cents | null;
  supplement_detail: string | null;
  left_alone: string | null;
}

export function toPublicDogPolicy(
  policy: SnapshotDogPolicy | null,
  compatibility: DogCompatibilityResult,
  nights: number,
  guests: number,
): PublicDogPolicySummary {
  const mode = (policy?.supplement_mode ?? null) as DogSupplementMode | null;
  const formula = policy
    ? dogSupplementFormula(
        { mode, amount_cents: policy.supplement_amount_cents },
        { nights, guests, dogs: Math.max(1, compatibility.dog_count) },
      )
    : null;
  return {
    complete: policy?.complete ?? false,
    max_size: policy?.max_size ?? null,
    max_size_unlimited: policy?.max_size_unlimited ?? false,
    ppp_allowed: policy?.ppp_allowed ?? null,
    max_dogs: compatibility.limit.max,
    supplement_mode: mode,
    supplement_mode_label:
      mode === null ? null : DOG_SUPPLEMENT_MODE_LABEL[mode],
    supplement_amount_cents: policy?.supplement_amount_cents ?? null,
    supplement_detail: formula?.detail ?? null,
    left_alone: policy?.left_alone ?? null,
  };
}
