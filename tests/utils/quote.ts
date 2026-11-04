import type { DogSizeRange } from "@/src/contexts/pet-policies/domain/dog-compatibility";
import type {
  QuotePricingInput,
  UnitDogPolicyInput,
} from "@/src/contexts/reservations/utils/reservation-quote.util";
import type { ResolvedBoardOption } from "@/src/contexts/rooms/services/room-board-options.service";

import {
  buildPricedQuote,
  type QuoteReservationResult,
} from "@/src/contexts/reservations/services/reservation.service";

/** Seeds of migration 1790218045430 (species "Perro"). */
export const DOG_SIZES: DogSizeRange[] = [
  { id: 1, name: "Pequeño", slug: "pequeno", rank: 1, min_kg: 0, max_kg: 10 },
  {
    id: 2,
    name: "Mediano",
    slug: "mediano",
    rank: 2,
    min_kg: 10.01,
    max_kg: 20,
  },
  { id: 3, name: "Grande", slug: "grande", rank: 3, min_kg: 20.01, max_kg: 40 },
  {
    id: 4,
    name: "Extra grande",
    slug: "extra-grande",
    rank: 4,
    min_kg: 40.01,
    max_kg: null,
  },
];

export const HALF_BOARD: ResolvedBoardOption = {
  id: 5,
  code: "HB",
  name: "Media pensión",
  description: null,
  is_included: false,
  price: 15,
};

/** Complete unit policy: up to "Mediano", no PPP, free dogs, no deposit. */
export function dogPolicy(
  overrides: Partial<UnitDogPolicyInput> = {},
): UnitDogPolicyInput {
  return {
    id: 9,
    room_id: 3,
    species_id: 1,
    max_size_id: 2,
    ppp_allowed: false,
    supplement_mode: "none",
    supplement_amount: null,
    left_alone: "no",
    left_alone_conditions: null,
    full_unit_access: null,
    deposit_required: false,
    deposit_amount: null,
    deposit_return: null,
    deposit_return_days: null,
    common_zones_answered: true,
    dining_zones_answered: true,
    notes: null,
    zones: [
      {
        zone_id: 1,
        slug: "terrace",
        name: "Terraza",
        allows_dining: true,
        other_text: null,
      },
    ],
    ...overrides,
  };
}

export function pricingInput(
  overrides: Partial<QuotePricingInput> = {},
): QuotePricingInput {
  return {
    roomId: 3,
    roomName: "Suite Perruna",
    roomMaxPets: 2,
    nightlyRateCents: 10_000,
    nights: 2,
    guests: 2,
    board: {
      id: HALF_BOARD.id,
      code: HALF_BOARD.code,
      name: HALF_BOARD.name,
      is_included: false,
      price_cents: 1500,
    },
    dogs: null,
    legacyPets: 1,
    serviceSelections: [],
    extraSelections: [],
    sizes: DOG_SIZES,
    policy: null,
    siteSettings: null,
    dogServices: [],
    additionalServices: [],
    roomExtras: [],
    ...overrides,
  };
}

/** A quote exactly as ReservationService.quoteReservation() builds it. */
export function pricedQuote(
  overrides: Partial<QuotePricingInput> = {},
  board: ResolvedBoardOption | null = HALF_BOARD,
): QuoteReservationResult {
  const pricing = pricingInput(overrides);
  return buildPricedQuote({
    errors: [],
    nights: pricing.nights,
    nightlyRate: pricing.nightlyRateCents / 100,
    minNights: 1,
    maxNights: 30,
    guests: pricing.guests,
    resolvedBoard: board,
    activeExtras: [],
    pricing,
  });
}
