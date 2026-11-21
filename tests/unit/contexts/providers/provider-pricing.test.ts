import type { ProviderCancellationPolicy } from "@/contexts/providers/domain/provider.types";

import { describe, expect, it } from "vitest";

import {
  computeProviderPenalty,
  computeSellPrice,
} from "@/contexts/providers/domain/provider-pricing";

describe("computeSellPrice", () => {
  it("adds the markup rounded half up to cents", () => {
    expect(computeSellPrice(24_055, 0.15)).toEqual({
      netCents: 24_055,
      markupRate: 0.15,
      markupCents: 3608, // 3608.25
      sellCents: 27_663,
    });
    // 10 x 0.15 = 1.5 -> 2 (half up, not banker's)
    expect(computeSellPrice(10, 0.15).markupCents).toBe(2);
    expect(computeSellPrice(1001, 0.15).markupCents).toBe(150); // 150.15
    expect(computeSellPrice(1005, 0.1).markupCents).toBe(101); // 100.5
  });

  it("zero markup and zero net", () => {
    expect(computeSellPrice(5000, 0).sellCents).toBe(5000);
    expect(computeSellPrice(0, 0.2).sellCents).toBe(0);
  });

  it("rejects invalid input", () => {
    expect(() => computeSellPrice(10.5, 0.1)).toThrow();
    expect(() => computeSellPrice(-1, 0.1)).toThrow();
    expect(() => computeSellPrice(100, 1.5)).toThrow();
    expect(() => computeSellPrice(100, -0.1)).toThrow();
  });
});

describe("computeProviderPenalty", () => {
  const policies: ProviderCancellationPolicy[] = [
    // Deliberately unsorted; the zero node marks free cancellation.
    {
      deadline: "2026-12-10T12:00:00.000Z",
      amountCents: 12_027,
      currency: "EUR",
      timezone: "GMT",
    },
    {
      deadline: "2026-12-01T00:00:00.000Z",
      amountCents: 0,
      currency: "EUR",
      timezone: "GMT",
    },
    {
      deadline: "2026-12-14T00:00:00.000Z",
      amountCents: 24_055,
      currency: "EUR",
      timezone: "GMT",
    },
  ];

  it("is 0 before the first paid deadline (zero nodes ignored)", () => {
    expect(
      computeProviderPenalty(policies, new Date("2026-11-30T00:00:00Z")),
    ).toBe(0);
    expect(
      computeProviderPenalty(policies, new Date("2026-12-05T00:00:00Z")),
    ).toBe(0);
    expect(
      computeProviderPenalty(policies, new Date("2026-12-10T11:59:59Z")),
    ).toBe(0);
  });

  it("applies the latest deadline already passed (inclusive)", () => {
    expect(
      computeProviderPenalty(policies, new Date("2026-12-10T12:00:00Z")),
    ).toBe(12_027);
    expect(
      computeProviderPenalty(policies, new Date("2026-12-13T23:59:59Z")),
    ).toBe(12_027);
    expect(
      computeProviderPenalty(policies, new Date("2026-12-14T00:00:00Z")),
    ).toBe(24_055);
    expect(
      computeProviderPenalty(policies, new Date("2027-01-01T00:00:00Z")),
    ).toBe(24_055);
  });

  it("no policies -> 0 when refundable", () => {
    expect(computeProviderPenalty([], new Date())).toBe(0);
  });

  it("NRFN -> full amount at any time", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    expect(
      computeProviderPenalty(policies, now, {
        refundable: false,
        fullAmountCents: 30_000,
      }),
    ).toBe(30_000);
    // Without the full amount: the highest policy amount.
    expect(computeProviderPenalty(policies, now, { refundable: false })).toBe(
      24_055,
    );
    expect(computeProviderPenalty([], now, { refundable: false })).toBe(0);
  });

  it("skips malformed deadlines", () => {
    expect(
      computeProviderPenalty(
        [
          {
            deadline: "not-a-date",
            amountCents: 500,
            currency: "EUR",
            timezone: null,
          },
        ],
        new Date("2030-01-01T00:00:00Z"),
      ),
    ).toBe(0);
  });
});
