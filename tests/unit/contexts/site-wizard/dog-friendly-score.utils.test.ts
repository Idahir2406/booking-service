import type { ScoreUnitInput } from "@/contexts/site-wizard/utils/dog-friendly-score.utils";

import { describe, expect, it } from "vitest";

import {
  computeDogFriendlyScore,
  integrationPoints,
  pawsFor,
  policyPoints,
  reviewEquivalence,
  reviewWeight,
  scoreFromObjectivePoints,
  servicesPoints,
  sizePoints,
} from "@/contexts/site-wizard/utils/dog-friendly-score.utils";

// common_zones seed: 1 restaurant, 2 breakfast, 3 cafe_bar, 4 terrace,
// 5 pool_outdoor, 6 spa, 7 gym, 8 other. counts_as_extra_zone: 3,5,6,7,8
const EXTRA_ZONES = new Set([3, 5, 6, 7, 8]);

function unit(overrides: Partial<ScoreUnitInput> = {}): ScoreUnitInput {
  return {
    ppp_allowed: false,
    max_size_rank: 1,
    is_full_use: false,
    full_unit_access: null,
    zone_ids: [],
    dining_zone_ids: [],
    ...overrides,
  };
}

const NO_REVIEWS = { count: 0, average: null };
const FIVE_GOOD = { count: 5, average: 4.7 };

describe("Block 1 - policies (max 16)", () => {
  it("size points by rank: small 0, medium 2, large 4, XL 8", () => {
    expect(sizePoints(null)).toBe(0);
    expect(sizePoints(1)).toBe(0);
    expect(sizePoints(2)).toBe(2);
    expect(sizePoints(3)).toBe(4);
    expect(sizePoints(4)).toBe(8);
  });

  it("PPP yes 8 + XL 8 = 16", () => {
    expect(policyPoints([unit({ ppp_allowed: true, max_size_rank: 4 })])).toBe(
      16,
    );
    expect(policyPoints([unit({ ppp_allowed: null, max_size_rank: 3 })])).toBe(
      4,
    );
  });

  it("multi-unit: most favorable unit per criterion", () => {
    expect(
      policyPoints([
        unit({ ppp_allowed: true, max_size_rank: 1 }),
        unit({ ppp_allowed: false, max_size_rank: 4 }),
      ]),
    ).toBe(16);
  });

  it("no units -> 0", () => {
    expect(policyPoints([])).toBe(0);
  });
});

describe("Block 2 - services (max 20)", () => {
  it("amenities capped at 12, facilities at 4, services at 4", () => {
    expect(
      servicesPoints({
        amenityPoints: [3, 3, 3, 2, 2, 1, 1, 1, 1, 0.5, 0],
        facilityPoints: [1, 1, 1, 1, 1, 1, 1],
        servicePoints: [1, 1, 1, 1],
      }),
    ).toBe(20);
  });

  it("sums below the caps (0.5 secador kept)", () => {
    expect(
      servicesPoints({
        amenityPoints: [3, 0.5],
        facilityPoints: [1],
        servicePoints: [1, 1],
      }),
    ).toBe(6.5);
  });
});

describe("Block 3 - integration (max 5)", () => {
  it("A: at least one dining zone -> 3; 'Ninguna' -> 0", () => {
    expect(
      integrationPoints([unit({ dining_zone_ids: [1] })], EXTRA_ZONES),
    ).toBe(3);
    expect(
      integrationPoints([unit({ dining_zone_ids: [] })], EXTRA_ZONES),
    ).toBe(0);
  });

  it("B: extra zones 0/1/>=2 -> 0/1/2, restaurant/breakfast/terrace never count", () => {
    expect(
      integrationPoints([unit({ zone_ids: [1, 2, 4] })], EXTRA_ZONES),
    ).toBe(0);
    expect(integrationPoints([unit({ zone_ids: [5] })], EXTRA_ZONES)).toBe(1);
    expect(
      integrationPoints([unit({ zone_ids: [5, 6, 7] })], EXTRA_ZONES),
    ).toBe(2);
  });

  it("B excludes zones already selected as dining zones (dedupe by id)", () => {
    // cafe_bar is both a common zone and the dining zone -> only spa counts
    expect(
      integrationPoints(
        [unit({ zone_ids: [3, 6], dining_zone_ids: [3] })],
        EXTRA_ZONES,
      ),
    ).toBe(3 + 1);
  });

  it("A + B capped at 5", () => {
    expect(
      integrationPoints(
        [unit({ zone_ids: [1, 5, 6, 7], dining_zone_ids: [1] })],
        EXTRA_ZONES,
      ),
    ).toBe(5);
  });

  it("C: full use + free access yes -> 5, no -> 0", () => {
    expect(
      integrationPoints(
        [unit({ is_full_use: true, full_unit_access: true })],
        EXTRA_ZONES,
      ),
    ).toBe(5);
    expect(
      integrationPoints(
        [unit({ is_full_use: true, full_unit_access: false })],
        EXTRA_ZONES,
      ),
    ).toBe(0);
    // access flag without full use never scores
    expect(
      integrationPoints([unit({ full_unit_access: true })], EXTRA_ZONES),
    ).toBe(0);
  });

  it("multi-unit: best A and best B may come from different units", () => {
    expect(
      integrationPoints(
        [unit({ dining_zone_ids: [1] }), unit({ zone_ids: [5, 6] })],
        EXTRA_ZONES,
      ),
    ).toBe(5);
  });
});

describe("reviews", () => {
  it("weight 0..25% by count", () => {
    expect([0, 1, 2, 3, 4, 5, 12].map(count => reviewWeight(count))).toEqual([
      0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.25,
    ]);
  });

  it("equivalence R by average", () => {
    expect(reviewEquivalence(null)).toBe(0);
    expect(reviewEquivalence(2.9)).toBe(0);
    expect(reviewEquivalence(3)).toBe(40);
    expect(reviewEquivalence(3.4)).toBe(40);
    expect(reviewEquivalence(3.5)).toBe(60);
    expect(reviewEquivalence(3.9)).toBe(60);
    expect(reviewEquivalence(4)).toBe(80);
    expect(reviewEquivalence(4.4)).toBe(80);
    expect(reviewEquivalence(4.5)).toBe(100);
    expect(reviewEquivalence(5)).toBe(100);
  });
});

describe("paws", () => {
  it("thresholds on the unrounded score", () => {
    expect(pawsFor(0, NO_REVIEWS)).toBe(2);
    expect(pawsFor(59.99, NO_REVIEWS)).toBe(2);
    expect(pawsFor(60, NO_REVIEWS)).toBe(3);
    // 74.96 is shown as 75.0 but still 3 paws
    expect(pawsFor(74.96, NO_REVIEWS)).toBe(3);
    expect(pawsFor(75, NO_REVIEWS)).toBe(4);
    expect(pawsFor(89.99, NO_REVIEWS)).toBe(4);
    expect(pawsFor(90, NO_REVIEWS)).toBe(5);
    expect(pawsFor(100, NO_REVIEWS)).toBe(5);
  });

  it("veto: >= 5 reviews and average < 3.5 -> max 2 paws", () => {
    expect(pawsFor(95, { count: 5, average: 3.4 })).toBe(2);
    expect(pawsFor(95, { count: 4, average: 3.4 })).toBe(5);
    expect(pawsFor(95, { count: 5, average: 3.5 })).toBe(5);
  });
});

describe("PDF examples (section 6 and 8)", () => {
  it("no reviews: 33/41 = 80.5 -> 4 paws", () => {
    const result = scoreFromObjectivePoints(33, NO_REVIEWS);
    expect(result.objective).toBe(80.5);
    expect(result.score).toBe(80.5);
    expect(result.paws).toBe(4);
  });

  it.each([
    { points: 37, objective: 90.2, score: 92.7, paws: 5 },
    { points: 36, objective: 87.8, score: 90.9, paws: 5 },
    { points: 27, objective: 65.9, score: 74.4, paws: 3 },
    { points: 33, objective: 80.5, score: 85.4, paws: 4 },
    { points: 41, objective: 100, score: 100, paws: 5 },
  ])(
    "$points/41 with 5+ reviews avg 4.7 (R=100) -> $score, $paws paws",
    ({ points, objective, score, paws }) => {
      const result = scoreFromObjectivePoints(points, FIVE_GOOD);
      expect(result.raw.reviewEquivalence).toBe(100);
      expect(result.objective).toBe(objective);
      expect(result.score).toBe(score);
      expect(result.paws).toBe(paws);
    },
  );

  it("33/41 with 5+ reviews avg 3.3 (R=40) -> 70.4 numeric, veto 2 paws", () => {
    const result = scoreFromObjectivePoints(33, { count: 5, average: 3.3 });
    expect(result.score).toBe(70.4);
    expect(result.paws).toBe(2);
  });

  it("1 review weighs 5%", () => {
    const result = scoreFromObjectivePoints(41, { count: 1, average: 1 });
    expect(result.raw.score).toBeCloseTo(95, 10);
    expect(result.paws).toBe(5);
  });
});

describe("computeDogFriendlyScore", () => {
  it("full site: 16 + 20 + 5 = 41 -> 100", () => {
    const result = computeDogFriendlyScore({
      units: [
        unit({
          ppp_allowed: true,
          max_size_rank: 4,
          zone_ids: [1, 5, 6],
          dining_zone_ids: [1],
        }),
      ],
      extraZoneIds: EXTRA_ZONES,
      amenityPoints: [3, 3, 3, 3],
      facilityPoints: [1, 1, 1, 1],
      servicePoints: [1, 1, 1, 1],
      reviews: NO_REVIEWS,
    });
    expect(result.blocks).toEqual({
      policy: { points: 16, max: 16 },
      services: { points: 20, max: 20 },
      integration: { points: 5, max: 5 },
    });
    expect(result.score).toBe(100);
    expect(result.paws).toBe(5);
  });

  it("empty site: minimum 2 paws", () => {
    const result = computeDogFriendlyScore({
      units: [],
      extraZoneIds: EXTRA_ZONES,
      amenityPoints: [],
      facilityPoints: [],
      servicePoints: [],
      reviews: NO_REVIEWS,
    });
    expect(result.score).toBe(0);
    expect(result.paws).toBe(2);
  });
});
