import { dogPolicy, pricedQuote, pricingInput } from "@/tests/utils/quote";

import { summarizePriceLines } from "@/src/contexts/payments/domain/price-lines";
import {
  buildReservationPriceLines,
  computeFrozenCommission,
  dogSupplementFormula,
  extraFormula,
  priceReservation,
  type PricingStay,
  SERVICE_SELECTION_TYPE,
  serviceFormula,
} from "@/src/contexts/payments/domain/reservation-pricing";
import {
  buildStripeLineItems,
  STRIPE_LINE_ITEMS_MODE,
} from "@/src/contexts/payments/domain/stripe-line-items";
import { assembleQuotePricing } from "@/src/contexts/reservations/utils/reservation-quote.util";

const STAY: PricingStay = { nights: 3, guests: 2, dogs: 2 };

const baseInput = () => ({
  stay: STAY,
  room: { id: 3, name: "Suite", price_per_night_cents: 10_000 },
  board: null,
  dogSupplement: null,
  services: [],
  extras: [],
});

describe("dog supplement (B5/C5)", () => {
  it.each([
    ["per_pet_night", 1500, 9000, 6], // 15 × 2 perros × 3 noches = 90 €
    ["per_pet_stay", 1500, 3000, 2], // 15 × 2 perros = 30 €
    ["fixed_stay", 2500, 2500, 1], // 25 € fijo
  ] as const)(
    "%s: amount %i -> %i cents",
    (mode, amount, expected, multiplier) => {
      const lines = buildReservationPriceLines({
        ...baseInput(),
        dogSupplement: { mode, amount_cents: amount },
      });
      const supplement = lines.find(line => line.type === "dog_supplement");
      expect(supplement).toMatchObject({
        amount_cents: expected,
        unit_amount_cents: amount,
        quantity: multiplier,
        is_optional: false,
        is_commissionable: true,
        is_penalizable: true,
      });
    },
  );

  it("none / not configured / 0 dogs -> no line", () => {
    expect(
      dogSupplementFormula({ mode: "none", amount_cents: null }, STAY),
    ).toBeNull();
    expect(
      dogSupplementFormula({ mode: null, amount_cents: 1500 }, STAY),
    ).toBeNull();
    expect(
      dogSupplementFormula(
        { mode: "per_pet_night", amount_cents: 1500 },
        { ...STAY, dogs: 0 },
      ),
    ).toBeNull();
    const lines = buildReservationPriceLines({
      ...baseInput(),
      dogSupplement: { mode: "none", amount_cents: null },
    });
    expect(lines.map(line => line.type)).toEqual(["accommodation"]);
  });
});

describe("services and extras pricing modes", () => {
  it.each([
    ["per_stay", 1000, 1, 1000],
    ["per_night", 1000, 1, 3000],
    ["per_pet_night", 1000, 1, 6000],
    ["per_pet_stay", 1000, 1, 2000],
    ["per_night", 1000, 2, 6000], // quantity multiplies the formula
  ] as const)(
    "service %s price %i qty %i -> %i",
    (mode, price, quantity, expected) => {
      const formula = serviceFormula(mode, price, STAY, quantity);
      expect(price * formula.multiplier).toBe(expected);
    },
  );

  it.each([
    ["per_night", 500, 1500],
    ["per_night_per_guest", 500, 3000],
    ["per_stay", 500, 500],
  ] as const)("extra %s price %i -> %i", (mode, price, expected) => {
    expect(price * extraFormula(mode, price, STAY).multiplier).toBe(expected);
  });

  it("services/extras are optional, commissionable and NOT penalizable", () => {
    const lines = buildReservationPriceLines({
      ...baseInput(),
      services: [
        {
          option: {
            type: SERVICE_SELECTION_TYPE.DOG_SUPPLY,
            id: 7,
            name: "Kit de bienvenida",
            price_cents: 1200,
            pricing_mode: "per_stay",
          },
          quantity: 1,
        },
        {
          option: {
            type: SERVICE_SELECTION_TYPE.ADDITIONAL_SERVICE,
            id: 2,
            name: "Paseador",
            price_cents: 800,
            pricing_mode: "per_pet_night",
          },
          quantity: 1,
        },
      ],
      extras: [
        {
          id: 4,
          name: "Parking",
          description: null,
          price_cents: 500,
          pricing_mode: "per_night",
        },
      ],
    });
    const optional = lines.filter(line => line.type !== "accommodation");
    expect(optional.map(line => [line.type, line.amount_cents])).toEqual([
      ["dog_service", 1200],
      ["additional_service", 4800], // 8 € × 2 perros × 3 noches
      ["extra", 1500],
    ]);
    for (const line of optional) {
      expect(line).toMatchObject({
        is_optional: true,
        is_commissionable: true,
        is_penalizable: false,
      });
    }
    expect(optional[0].description).toBe(
      "Servicio para perros · Kit de bienvenida",
    );
  });
});

describe("totals and frozen commission (A2/A3/A4)", () => {
  it("total = sum(lines); commission = half-up(rate × commissionable base)", () => {
    const pricing = priceReservation({
      ...baseInput(),
      room: { id: 3, name: "Suite", price_per_night_cents: 3335 }, // 3 × 33,35 = 100,05 €
      board: {
        id: 1,
        code: "BB",
        name: "Desayuno",
        is_included: true,
        price_cents: 900,
      },
    });
    expect(pricing.totals.total_cents).toBe(10_005);
    // board included: amount 0, still documented (quantity 1)
    expect(pricing.lines[1]).toMatchObject({
      type: "board",
      amount_cents: 0,
      quantity: 1,
    });
    // 12 % × 10005 = 1200.6 -> 1201 (half-up), never float noise
    expect(computeFrozenCommission(pricing.lines, 0.12)).toEqual({
      commission_rate: 0.12,
      commission_cents: 1201,
      commissionable_cents: 10_005,
    });
  });

  it("the commission base excludes nothing commissionable but excludes the tourist tax hook", () => {
    const pricing = priceReservation({
      ...baseInput(),
      dogSupplement: { mode: "per_pet_stay", amount_cents: 1000 },
      extras: [
        {
          id: 1,
          name: "Cuna",
          description: null,
          price_cents: 1000,
          pricing_mode: "per_stay",
        },
      ],
      touristTax: { amount_cents: 450, description: "Tasa turística" },
    });
    const totals = summarizePriceLines(pricing.lines);
    // 30000 alojamiento + 2000 suplemento + 1000 extra (+ 450 tasa)
    expect(totals.total_cents).toBe(33_450);
    expect(totals.commissionable_cents).toBe(33_000);
    expect(totals.penalizable_cents).toBe(32_000); // extra + tax excluded
    expect(computeFrozenCommission(pricing.lines, 0.12).commission_cents).toBe(
      3960,
    );
  });
});

describe("quote and checkout share ONE pricing function", () => {
  it("public quote lines == internal checkout lines (same amounts, flags, totals)", () => {
    const quote = pricedQuote({
      dogs: [{ name: "Luna", weight_kg: 8, is_ppp: false }],
      policy: dogPolicy({
        supplement_mode: "per_pet_night",
        supplement_amount: "15.00",
      }),
    });
    expect(quote.valid).toBe(true);
    const internal = quote.internal?.lines ?? [];
    expect(
      quote.price_lines?.map(line => [line.type, line.amount_cents]),
    ).toEqual(internal.map(line => [line.type, line.amount_cents]));
    // 2 × 100 + 2 × 15 (pensión) + 1 perro × 2 noches × 15
    expect(quote.totals?.total_cents).toBe(26_000);
    expect(quote.total).toBe(260);
    expect(quote.subtotal).toBe(260);
    expect(quote.commission).toBe(0); // legacy surcharge, not the V4P fee
  });

  it("selected services and extras appear as lines and in the available list", () => {
    const outcome = assembleQuotePricing(
      pricingInput({
        dogs: [
          { weight_kg: 5, is_ppp: false },
          { weight_kg: 7, is_ppp: false },
        ],
        policy: dogPolicy(),
        serviceSelections: [{ type: "dog_supply", id: 11, quantity: 2 }],
        extraSelections: [{ id: 21 }],
        dogServices: [
          {
            type: "dog_supply",
            id: 11,
            name: "Comedero",
            price_cents: 300,
            pricing_mode: "per_pet_stay",
          },
        ],
        roomExtras: [
          {
            id: 21,
            name: "Desayuno en habitación",
            description: null,
            price_cents: 400,
            pricing_mode: "per_night_per_guest",
          },
        ],
      }),
    );
    const byType = Object.fromEntries(
      outcome.pricing.lines.map(line => [line.type, line.amount_cents]),
    );
    expect(byType.dog_service).toBe(1200); // 2 uds × 2 perros × 3 €
    expect(byType.extra).toBe(1600); // 2 noches × 2 huéspedes × 4 €
    expect(outcome.availableServices[0]).toMatchObject({
      selected: true,
      quantity: 2,
      pricing_mode_label: "por perro y estancia",
    });
    expect(outcome.snapshotExtension.services[0]).toMatchObject({
      id: 11,
      pricing_mode: "per_pet_stay",
      price_cents: 300,
      quantity: 2,
      amount_cents: 1200,
    });
  });

  it("rejects unknown / duplicated / per-pet-without-dogs selections", () => {
    const outcome = assembleQuotePricing(
      pricingInput({
        legacyPets: 0,
        serviceSelections: [
          { type: "additional_service", id: 1 },
          { type: "additional_service", id: 1 },
          { type: "dog_supply", id: 99 },
        ],
        extraSelections: [{ id: 5 }],
        additionalServices: [
          {
            type: "additional_service",
            id: 1,
            name: "Paseador",
            price_cents: 800,
            pricing_mode: "per_pet_night",
          },
        ],
      }),
    );
    expect(outcome.selectionIssues.map(issue => issue.code)).toEqual([
      "service_requires_dogs",
      "service_duplicated",
      "service_not_available",
      "extra_not_available",
    ]);
    expect(
      outcome.pricing.lines.some(line => line.type === "additional_service"),
    ).toBe(false);
  });
});

describe("deposit is informative only (A26/C6)", () => {
  it("never becomes a price line and explains who manages it", () => {
    const quote = pricedQuote({
      policy: dogPolicy({
        deposit_required: true,
        deposit_amount: "150.00",
        deposit_return: "days",
        deposit_return_days: 7,
      }),
      dogs: [{ weight_kg: 9, is_ppp: false }],
    });
    expect(quote.deposit).toMatchObject({
      required: true,
      amount_cents: 15_000,
      charged_by_v4p: false,
    });
    expect(quote.deposit?.message).toContain(
      "La fianza la gestiona el alojamiento; no se cobra en Viajes 4Patas.",
    );
    expect(quote.deposit?.message).toContain("7 días después de la salida");
    expect(quote.totals?.total_cents).toBe(23_000);
  });
});

describe("Stripe Checkout line_items (one per price line)", () => {
  it("itemizes every non-zero line and the sum equals total_cents", () => {
    const quote = pricedQuote({
      dogs: [{ weight_kg: 9, is_ppp: false }],
      policy: dogPolicy({
        supplement_mode: "fixed_stay",
        supplement_amount: 25,
      }),
    });
    const lines = quote.internal?.lines ?? [];
    const total = quote.totals?.total_cents ?? 0;
    const result = buildStripeLineItems(lines, total, "eur", "Alojamiento");
    expect(result.mode).toBe(STRIPE_LINE_ITEMS_MODE.ITEMIZED);
    expect(
      result.line_items.map(item => item.price_data.product_data.name),
    ).toEqual([
      "Alojamiento · Suite Perruna",
      "Régimen · Media pensión",
      "Suplemento por perro",
    ]);
    const sum = result.line_items.reduce(
      (acc, item) => acc + item.price_data.unit_amount * item.quantity,
      0,
    );
    expect(sum).toBe(total);
    expect(result.line_items[0].price_data.product_data.description).toMatch(
      /2 noches × 100,00/,
    );
  });

  it("falls back to a single item if a line is negative or the sum differs", () => {
    const negative = buildStripeLineItems(
      [
        { description: "Alojamiento", amount_cents: 10_000 },
        { description: "Descuento", amount_cents: -1000 },
      ],
      9000,
      "eur",
      "Casa Rural",
    );
    expect(negative.mode).toBe(STRIPE_LINE_ITEMS_MODE.SINGLE);
    expect(negative.line_items).toHaveLength(1);
    expect(negative.line_items[0].price_data.unit_amount).toBe(9000);

    const mismatch = buildStripeLineItems(
      [{ description: "Alojamiento", amount_cents: 10_000 }],
      10_001,
      "eur",
      "Casa Rural",
    );
    expect(mismatch.mode).toBe(STRIPE_LINE_ITEMS_MODE.SINGLE);
    expect(mismatch.line_items[0].price_data.unit_amount).toBe(10_001);
  });
});
