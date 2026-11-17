import { describe, expect, it } from "vitest";

import { buildReservationPriceLines } from "@/contexts/payments/domain/reservation-pricing";
import { resolveCribs } from "@/contexts/reservations/utils/reservation-quote.util";
import {
  cribsFromRow,
  parseCribsInput,
  syncFamiliarCrib,
} from "@/contexts/site-wizard/utils/site-cribs.utils";

describe("parseCribsInput", () => {
  it("is untouched when absent and cleared when not offered", () => {
    expect(parseCribsInput({})).toEqual({ ok: true, value: undefined });
    const off = parseCribsInput({ cribs: { offered: false, count: 3 } });
    expect(off.ok && off.value?.offered).toBe(false);
    expect(off.ok && off.value?.count).toBeNull();
  });

  it("validates count, price and mode", () => {
    expect(parseCribsInput({ cribs: { offered: true, count: 0 } }).ok).toBe(
      false,
    );
    expect(
      parseCribsInput({
        cribs: { offered: true, count: 2, is_paid: true, price: 0 },
      }).ok,
    ).toBe(false);
    expect(
      parseCribsInput({
        cribs: {
          offered: true,
          count: 2,
          is_paid: true,
          price: 5,
          pricing_mode: "per_night",
          note: " Avísanos ",
        },
      }),
    ).toEqual({
      ok: true,
      value: {
        offered: true,
        count: 2,
        is_paid: true,
        price: 5,
        pricing_mode: "per_night",
        note: "Avísanos",
      },
    });
  });

  it("reads stored rows", () => {
    expect(
      cribsFromRow({
        cribs_offered: 1,
        cribs_count: 1,
        cribs_is_paid: 0,
        cribs_price: null,
        cribs_pricing_mode: null,
        cribs_note: null,
      }),
    ).toEqual({
      offered: true,
      count: 1,
      is_paid: false,
      price: null,
      pricing_mode: null,
      note: null,
    });
  });
});

describe("syncFamiliarCrib", () => {
  it("adds or removes option 1 keeping the rest", () => {
    expect(syncFamiliarCrib("3,5", true)).toBe("3,5,1");
    expect(syncFamiliarCrib("1,3", false)).toBe("3");
    expect(syncFamiliarCrib(null, true)).toBe("1");
    expect(syncFamiliarCrib("1", true)).toBe("1");
  });
});

describe("resolveCribs", () => {
  const offer = {
    count: 2,
    is_paid: true,
    price_cents: 500,
    pricing_mode: "per_night" as const,
    note: null,
  };

  it("caps at the cribs the site has", () => {
    expect(resolveCribs(2, offer)).toEqual({ cribs: 2, issues: [] });
    expect(resolveCribs(3, offer).issues.length).toBe(1);
    expect(resolveCribs(1, null).issues.length).toBe(1);
    expect(resolveCribs(0, null)).toEqual({ cribs: 0, issues: [] });
  });
});

describe("crib price line", () => {
  it("charges quantity × nights × price per night as an optional extra", () => {
    const lines = buildReservationPriceLines({
      stay: { nights: 3, guests: 2, dogs: 0 },
      room: { id: 1, name: "Suite", price_per_night_cents: 10_000 },
      board: null,
      dogSupplement: null,
      services: [],
      extras: [],
      cribs: { quantity: 2, price_cents: 500, pricing_mode: "per_night" },
    });
    const crib = lines.find(line => line.metadata?.crib === true);
    expect(crib?.amount_cents).toBe(3000);
    expect(crib?.is_optional).toBe(true);
    expect(crib?.is_penalizable).toBe(false);
  });
});
