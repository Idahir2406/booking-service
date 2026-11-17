import type { ExtraPricingModeValue } from "../../rooms/entities/room-extra.entity";
import type { ServicePricingModeValue } from "../../shared/types/service-pricing-mode";

import { PRICE_LINE_TYPE } from "../entities/reservation-price-line.entity";
import {
  assertCents,
  type Cents,
  formatMoney,
  MoneyError,
  percentOfCents,
  type Rate,
} from "../utils/money.util";
import {
  type PriceLineDraft,
  type PriceLinesSummary,
  summarizePriceLines,
  validatePriceLine,
} from "./price-lines";

/**
 * F2 pricing engine: ONE pure function builds the price lines for both the
 * public quote and the checkout (no drift between what the traveler sees and
 * what is charged). All amounts are integer cents; quantities are integers
 * (nights, dogs, guests), so unit x quantity is exact and no rounding line is
 * ever needed. Only the commission uses half-up rounding.
 *
 * Line flags (A3/A4/A11):
 *  - accommodation, board, dog_supplement: mandatory, commissionable, penalizable
 *  - dog_service, additional_service, extra: optional, commissionable,
 *    NOT penalizable (refunded in full if the traveler cancels, A4)
 *  - tourist_tax: hook only (no data source yet): not commissionable.
 */

/** Dog supplement modes (unit_pet_policies.supplement_mode). */
export const DOG_SUPPLEMENT_MODE = {
  NONE: "none",
  PER_PET_NIGHT: "per_pet_night",
  PER_PET_STAY: "per_pet_stay",
  FIXED_STAY: "fixed_stay",
} as const;

export type DogSupplementMode =
  (typeof DOG_SUPPLEMENT_MODE)[keyof typeof DOG_SUPPLEMENT_MODE];

export const SERVICE_PRICING_MODE = {
  PER_STAY: "per_stay",
  PER_NIGHT: "per_night",
  PER_PET_NIGHT: "per_pet_night",
  PER_PET_STAY: "per_pet_stay",
} as const satisfies Record<string, ServicePricingModeValue>;

export const EXTRA_PRICING_MODE = {
  PER_NIGHT: "per_night",
  PER_NIGHT_PER_GUEST: "per_night_per_guest",
  PER_STAY: "per_stay",
} as const satisfies Record<string, ExtraPricingModeValue>;

export const SERVICE_SELECTION_TYPE = {
  DOG_SUPPLY: "dog_supply",
  ADDITIONAL_SERVICE: "additional_service",
} as const;

export type ServiceSelectionType =
  (typeof SERVICE_SELECTION_TYPE)[keyof typeof SERVICE_SELECTION_TYPE];

export const SERVICE_PRICING_MODE_LABEL: Readonly<
  Record<ServicePricingModeValue, string>
> = {
  per_stay: "por estancia",
  per_night: "por noche",
  per_pet_night: "por perro y noche",
  per_pet_stay: "por perro y estancia",
};

export const EXTRA_PRICING_MODE_LABEL: Readonly<
  Record<ExtraPricingModeValue, string>
> = {
  per_night: "por noche",
  per_night_per_guest: "por noche y huésped",
  per_stay: "por estancia",
};

export const DOG_SUPPLEMENT_MODE_LABEL: Readonly<
  Record<DogSupplementMode, string>
> = {
  none: "sin suplemento (perros gratis)",
  per_pet_night: "por perro y noche",
  per_pet_stay: "por perro y estancia",
  fixed_stay: "importe fijo por estancia",
};

/** Max units of one service in a single booking. */
export const MAX_SERVICE_QUANTITY = 20;

export interface PricingStay {
  nights: number;
  guests: number;
  /** Dogs the supplements/per-pet services are charged for. */
  dogs: number;
}

export interface PricingRoom {
  id: number;
  name: string | null;
  price_per_night_cents: Cents;
}

export interface PricingBoard {
  id: number | null;
  code: string;
  name: string;
  is_included: boolean;
  /** Supplement per night (ignored when included). */
  price_cents: Cents;
}

export interface DogSupplementRule {
  mode: DogSupplementMode | null;
  amount_cents: Cents | null;
}

export interface PricedServiceOption {
  type: ServiceSelectionType;
  /** Catalog id: dog_supplies.id / additional_services.id. */
  id: number;
  name: string;
  price_cents: Cents;
  pricing_mode: ServicePricingModeValue;
}

export interface SelectedService {
  option: PricedServiceOption;
  quantity: number;
}

export interface PricedExtraOption {
  /** room_extras.id */
  id: number;
  name: string;
  description: string | null;
  price_cents: Cents;
  pricing_mode: ExtraPricingModeValue;
}

/** Placeholder for the tourist tax (no data source yet; see F2 doc). */
export interface TouristTaxInput {
  amount_cents: Cents;
  description: string;
}

/** Cot / crib rental of the accommodation (wizard step 4, site_settings.cribs_*). */
export interface CribSelection {
  quantity: number;
  /** 0 = free cribs (no price line, only recorded). */
  price_cents: Cents;
  pricing_mode: "per_stay" | "per_night";
}

export interface ReservationPricingInput {
  stay: PricingStay;
  room: PricingRoom;
  board: PricingBoard | null;
  dogSupplement: DogSupplementRule | null;
  services: readonly SelectedService[];
  extras: readonly PricedExtraOption[];
  /** Paid cribs requested by the traveler (null/0 = none or free). */
  cribs?: CribSelection | null;
  touristTax?: TouristTaxInput | null;
}

export interface ReservationPricing {
  lines: PriceLineDraft[];
  totals: PriceLinesSummary;
}

export interface FrozenCommissionResult {
  commission_rate: Rate;
  commission_cents: Cents;
  commissionable_cents: Cents;
}

function money(cents: Cents): string {
  return formatMoney(cents);
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function nonNegativeInt(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new MoneyError(`${label} must be a non-negative integer`);
  }
  return value;
}

export interface FormulaResult {
  /** Multiplier applied to the unit price (always an integer >= 0). */
  multiplier: number;
  /** Human formula, e.g. "2 perros × 3 noches × 15,00 €". */
  detail: string;
}

/** Service formula (dog supplies + additional services, wizard step 4). */
export function serviceFormula(
  mode: ServicePricingModeValue,
  priceCents: Cents,
  stay: PricingStay,
  quantity = 1,
): FormulaResult {
  const nights = nonNegativeInt(stay.nights, "nights");
  const dogs = nonNegativeInt(stay.dogs, "dogs");
  const qty = nonNegativeInt(quantity, "quantity");
  const qtyPrefix = qty > 1 ? `${qty} × ` : "";
  const price = money(priceCents);
  switch (mode) {
    case "per_stay": {
      return { multiplier: qty, detail: `${qtyPrefix}${price} por estancia` };
    }
    case "per_night": {
      return {
        multiplier: qty * nights,
        detail: `${qtyPrefix}${plural(nights, "noche", "noches")} × ${price}`,
      };
    }
    case "per_pet_night": {
      return {
        multiplier: qty * dogs * nights,
        detail: `${qtyPrefix}${plural(dogs, "perro", "perros")} × ${plural(nights, "noche", "noches")} × ${price}`,
      };
    }
    case "per_pet_stay": {
      return {
        multiplier: qty * dogs,
        detail: `${qtyPrefix}${plural(dogs, "perro", "perros")} × ${price}`,
      };
    }
    default: {
      throw new MoneyError(`Unknown service pricing mode: ${String(mode)}`);
    }
  }
}

/** Room extra formula (room_extras.pricing_mode). */
export function extraFormula(
  mode: ExtraPricingModeValue,
  priceCents: Cents,
  stay: PricingStay,
): FormulaResult {
  const nights = nonNegativeInt(stay.nights, "nights");
  const guests = nonNegativeInt(stay.guests, "guests");
  const price = money(priceCents);
  switch (mode) {
    case "per_night": {
      return {
        multiplier: nights,
        detail: `${plural(nights, "noche", "noches")} × ${price}`,
      };
    }
    case "per_night_per_guest": {
      return {
        multiplier: nights * guests,
        detail: `${plural(nights, "noche", "noches")} × ${plural(guests, "huésped", "huéspedes")} × ${price}`,
      };
    }
    case "per_stay": {
      return { multiplier: 1, detail: `${price} por estancia` };
    }
    default: {
      throw new MoneyError(`Unknown extra pricing mode: ${String(mode)}`);
    }
  }
}

/** B5/C5 dog supplement formula; null = no line (none / not configured / 0 dogs). */
export function dogSupplementFormula(
  rule: DogSupplementRule | null,
  stay: PricingStay,
): FormulaResult | null {
  const mode = rule?.mode ?? null;
  const amountCents = rule?.amount_cents ?? null;
  if (
    mode === null ||
    mode === DOG_SUPPLEMENT_MODE.NONE ||
    amountCents === null ||
    amountCents <= 0
  ) {
    return null;
  }
  const nights = nonNegativeInt(stay.nights, "nights");
  const dogs = nonNegativeInt(stay.dogs, "dogs");
  if (dogs === 0) {
    return null;
  }
  const price = money(amountCents);
  switch (mode) {
    case "per_pet_night": {
      return {
        multiplier: dogs * nights,
        detail: `${plural(dogs, "perro", "perros")} × ${plural(nights, "noche", "noches")} × ${price}`,
      };
    }
    case "per_pet_stay": {
      return {
        multiplier: dogs,
        detail: `${plural(dogs, "perro", "perros")} × ${price}`,
      };
    }
    case "fixed_stay": {
      return { multiplier: 1, detail: `${price} fijo por estancia` };
    }
    default: {
      throw new MoneyError(`Unknown supplement mode: ${String(mode)}`);
    }
  }
}

function line(
  draft: Omit<PriceLineDraft, "amount_cents" | "quantity"> & {
    multiplier: number;
    detail: string;
    metadata?: Record<string, unknown>;
  },
): PriceLineDraft {
  // Stored quantity must be > 0; a 0 multiplier (e.g. board included) keeps
  // quantity 1 with a 0 amount so the line still documents the choice.
  const quantity = draft.multiplier > 0 ? draft.multiplier : 1;
  const amount = assertCents(
    draft.unit_amount_cents * draft.multiplier,
    `${draft.type} amount`,
  );
  return {
    type: draft.type,
    description: draft.description,
    quantity,
    unit_amount_cents: draft.unit_amount_cents,
    amount_cents: amount,
    is_optional: draft.is_optional,
    is_commissionable: draft.is_commissionable,
    is_penalizable: draft.is_penalizable,
    metadata: { ...draft.metadata, detail: draft.detail },
  };
}

/**
 * Builds every price line of a reservation (order = display order).
 * Throws MoneyError on invalid input; the caller validates selections first.
 */
export function buildReservationPriceLines(
  input: ReservationPricingInput,
): PriceLineDraft[] {
  const { stay } = input;
  const nights = nonNegativeInt(stay.nights, "nights");
  const lines: PriceLineDraft[] = [];

  lines.push(
    line({
      type: PRICE_LINE_TYPE.ACCOMMODATION,
      description: input.room.name
        ? `Alojamiento · ${input.room.name}`
        : "Alojamiento",
      unit_amount_cents: assertCents(input.room.price_per_night_cents),
      multiplier: nights,
      detail: `${plural(nights, "noche", "noches")} × ${money(input.room.price_per_night_cents)}`,
      is_optional: false,
      is_commissionable: true,
      is_penalizable: true,
      metadata: {
        room_id: input.room.id,
        nights,
        nightly_rate_cents: input.room.price_per_night_cents,
      },
    }),
  );

  if (input.board) {
    const unit = input.board.is_included
      ? 0
      : assertCents(input.board.price_cents);
    lines.push(
      line({
        type: PRICE_LINE_TYPE.BOARD,
        description: `Régimen · ${input.board.name}`,
        unit_amount_cents: unit,
        multiplier: input.board.is_included ? 0 : nights,
        detail: input.board.is_included
          ? "Incluido en el precio"
          : `${plural(nights, "noche", "noches")} × ${money(unit)}`,
        is_optional: false,
        is_commissionable: true,
        is_penalizable: true,
        metadata: {
          board_option_id: input.board.id,
          code: input.board.code,
          is_included: input.board.is_included,
          price_cents: input.board.price_cents,
          nights,
        },
      }),
    );
  }

  const supplement = dogSupplementFormula(input.dogSupplement, stay);
  if (supplement && input.dogSupplement?.amount_cents) {
    lines.push(
      line({
        type: PRICE_LINE_TYPE.DOG_SUPPLEMENT,
        description: "Suplemento por perro",
        unit_amount_cents: assertCents(input.dogSupplement.amount_cents),
        multiplier: supplement.multiplier,
        detail: supplement.detail,
        is_optional: false,
        is_commissionable: true,
        is_penalizable: true,
        metadata: {
          supplement_mode: input.dogSupplement.mode,
          supplement_amount_cents: input.dogSupplement.amount_cents,
          dogs: stay.dogs,
          nights,
        },
      }),
    );
  }

  for (const selected of input.services) {
    const { option } = selected;
    const formula = serviceFormula(
      option.pricing_mode,
      option.price_cents,
      stay,
      selected.quantity,
    );
    const isDogService = option.type === SERVICE_SELECTION_TYPE.DOG_SUPPLY;
    lines.push(
      line({
        type: isDogService
          ? PRICE_LINE_TYPE.DOG_SERVICE
          : PRICE_LINE_TYPE.ADDITIONAL_SERVICE,
        description: `${isDogService ? "Servicio para perros" : "Servicio adicional"} · ${option.name}`,
        unit_amount_cents: assertCents(option.price_cents),
        multiplier: formula.multiplier,
        detail: formula.detail,
        is_optional: true,
        is_commissionable: true,
        is_penalizable: false,
        metadata: {
          selection_type: option.type,
          service_id: option.id,
          pricing_mode: option.pricing_mode,
          price_cents: option.price_cents,
          quantity: selected.quantity,
          dogs: stay.dogs,
          nights,
        },
      }),
    );
  }

  for (const extra of input.extras) {
    const formula = extraFormula(extra.pricing_mode, extra.price_cents, stay);
    lines.push(
      line({
        type: PRICE_LINE_TYPE.EXTRA,
        description: `Extra · ${extra.name}`,
        unit_amount_cents: assertCents(extra.price_cents),
        multiplier: formula.multiplier,
        detail: formula.detail,
        is_optional: true,
        is_commissionable: true,
        is_penalizable: false,
        metadata: {
          extra_id: extra.id,
          pricing_mode: extra.pricing_mode,
          price_cents: extra.price_cents,
          guests: stay.guests,
          nights,
        },
      }),
    );
  }

  // Cribs (paid only): optional extra, commissionable, never penalized (same
  // money rules as room extras). Stored as type `extra` with metadata.crib.
  const cribs = input.cribs ?? null;
  if (cribs && cribs.quantity > 0 && cribs.price_cents > 0) {
    const formula = serviceFormula(
      cribs.pricing_mode,
      cribs.price_cents,
      stay,
      cribs.quantity,
    );
    lines.push(
      line({
        type: PRICE_LINE_TYPE.EXTRA,
        description: cribs.quantity > 1 ? `Cunas (${cribs.quantity})` : "Cuna",
        unit_amount_cents: assertCents(cribs.price_cents),
        multiplier: formula.multiplier,
        detail: formula.detail,
        is_optional: true,
        is_commissionable: true,
        is_penalizable: false,
        metadata: {
          crib: true,
          quantity: cribs.quantity,
          pricing_mode: cribs.pricing_mode,
          price_cents: cribs.price_cents,
          nights,
        },
      }),
    );
  }

  // Hook (F2): no data source yet, callers pass null. When it exists it is
  // collected for the host/authority and is outside the V4P commission (A3).
  if (input.touristTax && input.touristTax.amount_cents > 0) {
    lines.push(
      line({
        type: PRICE_LINE_TYPE.TOURIST_TAX,
        description: input.touristTax.description,
        unit_amount_cents: assertCents(input.touristTax.amount_cents),
        multiplier: 1,
        detail: "Tasa turística",
        is_optional: false,
        is_commissionable: false,
        is_penalizable: false,
      }),
    );
  }

  for (const draft of lines) {
    validatePriceLine(draft);
  }
  return lines;
}

export function priceReservation(
  input: ReservationPricingInput,
): ReservationPricing {
  const lines = buildReservationPriceLines(input);
  return { lines, totals: summarizePriceLines(lines) };
}

/**
 * A2/A3: commission = round_half_up(rate x commissionable base), frozen on
 * the reservation. Non-commissionable lines (tourist tax) never count.
 */
export function computeFrozenCommission(
  lines: readonly Pick<
    PriceLineDraft,
    "amount_cents" | "is_optional" | "is_commissionable" | "is_penalizable"
  >[],
  rate: Rate,
): FrozenCommissionResult {
  const { commissionable_cents } = summarizePriceLines(lines);
  return {
    commission_rate: rate,
    commission_cents: percentOfCents(commissionable_cents, rate),
    commissionable_cents,
  };
}

export function priceLineDetail(line: PriceLineDraft): string | null {
  const detail = line.metadata?.detail;
  return typeof detail === "string" && detail !== "" ? detail : null;
}
