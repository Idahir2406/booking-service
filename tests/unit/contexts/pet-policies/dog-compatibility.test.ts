import { DOG_SIZES } from "@/tests/utils/quote";

import {
  type DeclaredDogInput,
  deriveDogSize,
  DOG_COMPATIBILITY_MODE,
  DOG_VIOLATION_CODE,
  evaluateDogCompatibility,
  resolveDogCountLimit,
  type UnitDogPolicyRules,
} from "@/src/contexts/pet-policies/domain/dog-compatibility";

const ROOM_ID = 3;
const UP_TO_MEDIUM: UnitDogPolicyRules = { max_size_id: 2, ppp_allowed: false };

const evaluate = (
  dogs: DeclaredDogInput[] | null,
  policy: UnitDogPolicyRules | null = UP_TO_MEDIUM,
  limit = resolveDogCountLimit({ max_pets: 2, max_pets_unlimited: false }, 99),
  legacyPetsCount = 0,
) =>
  evaluateDogCompatibility({
    roomId: ROOM_ID,
    dogs,
    legacyPetsCount,
    sizes: DOG_SIZES,
    policy,
    limit,
  });

const dog = (weight_kg: number, is_ppp = false, name?: string) => ({
  weight_kg,
  is_ppp,
  name,
});

describe("weight -> size (C2, configurable ranges)", () => {
  it.each([
    [0.5, "pequeno"],
    [10, "pequeno"],
    [10.01, "mediano"],
    [20, "mediano"],
    [20.005, "grande"], // rounded to 20.01
    [40, "grande"],
    [40.01, "extra-grande"],
    [120, "extra-grande"],
  ])("%f kg -> %s", (weight, slug) => {
    expect(deriveDogSize(weight, DOG_SIZES)?.slug).toBe(slug);
  });
});

describe("compatibility with the unit policy (B3)", () => {
  it("sizes are cumulative: max Mediano admits Pequeño and Mediano", () => {
    const result = evaluate([dog(4, false, "Luna"), dog(18)]);
    expect(result).toMatchObject({
      compatible: true,
      mode: DOG_COMPATIBILITY_MODE.POLICY,
      dog_count: 2,
    });
    expect(result.dogs.map(item => item.size?.slug)).toEqual([
      "pequeno",
      "mediano",
    ]);
    expect(result.dogs[0].room_id).toBe(ROOM_ID); // auto-assigned (B2.1)
  });

  it("rejects a dog above the max size", () => {
    const result = evaluate([dog(25, false, "Thor")]);
    expect(result.compatible).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({
        code: DOG_VIOLATION_CODE.SIZE_NOT_ALLOWED,
        dog_indexes: [0],
        details: { weight_kg: 25, size: "grande", max_size: "mediano" },
      }),
    ]);
    expect(result.violations[0].message).toContain("«Thor»");
  });

  it("XL (top rank, no upper bound) admits every size", () => {
    const result = evaluate([dog(80), dog(3)], {
      max_size_id: 4,
      ppp_allowed: true,
    });
    expect(result.compatible).toBe(true);
    expect(result.max_size_unlimited).toBe(true);
  });

  it("PPP only if ppp_allowed", () => {
    expect(evaluate([dog(8, true)]).violations[0].code).toBe(
      DOG_VIOLATION_CODE.PPP_NOT_ALLOWED,
    );
    expect(
      evaluate([dog(8, true)], { max_size_id: 2, ppp_allowed: true })
        .compatible,
    ).toBe(true);
  });

  it("returns ALL violations at once (size + PPP + count)", () => {
    const result = evaluate([dog(30, true), dog(5), dog(6)]);
    expect(result.violations.map(item => item.code).sort()).toEqual(
      [
        DOG_VIOLATION_CODE.PPP_NOT_ALLOWED,
        DOG_VIOLATION_CODE.SIZE_NOT_ALLOWED,
        DOG_VIOLATION_CODE.TOO_MANY_DOGS,
      ].sort(),
    );
    const count = result.violations.find(
      item => item.code === DOG_VIOLATION_CODE.TOO_MANY_DOGS,
    );
    expect(count?.message).toContain("máximo de 2 perros");
    // C2: never expose host contact data in messages
    for (const violation of result.violations) {
      expect(violation.message).not.toMatch(/@|tel[eé]fono|whatsapp|\+?\d{9}/i);
    }
  });

  it("unlimited site setting never fails the count", () => {
    const result = evaluate(
      Array.from({ length: 7 }, () => dog(5)),
      UP_TO_MEDIUM,
      resolveDogCountLimit({ max_pets: null, max_pets_unlimited: true }, 2),
    );
    expect(result.limit.max).toBeNull();
    expect(result.compatible).toBe(true);
  });

  it("dog assigned to another unit is rejected (single-unit reservations)", () => {
    const result = evaluate([{ ...dog(5), room_id: 99 }]);
    expect(result.violations[0].code).toBe(
      DOG_VIOLATION_CODE.DOG_ROOM_MISMATCH,
    );
  });
});

describe("legacy behaviour", () => {
  it("no site_settings -> rooms.max_pets is the limit", () => {
    expect(resolveDogCountLimit(null, 1)).toEqual({ max: 1, source: "room" });
    expect(
      resolveDogCountLimit({ max_pets: null, max_pets_unlimited: false }, 3),
    ).toEqual({ max: 3, source: "room" });
    const result = evaluate(
      [dog(5), dog(5)],
      null,
      resolveDogCountLimit(null, 1),
    );
    expect(result.mode).toBe(DOG_COMPATIBILITY_MODE.LEGACY);
    expect(result.violations.map(item => item.code)).toEqual([
      DOG_VIOLATION_CODE.TOO_MANY_DOGS,
    ]);
  });

  it("incomplete policy (PPP not answered) -> count only, no size/PPP checks", () => {
    const result = evaluate([dog(60, true)], {
      max_size_id: 1,
      ppp_allowed: null,
    });
    expect(result.mode).toBe(DOG_COMPATIBILITY_MODE.LEGACY);
    expect(result.compatible).toBe(true);
  });

  it("legacy `pets` count without dogs: only the count is validated", () => {
    const ok = evaluate(null, UP_TO_MEDIUM, undefined, 2);
    expect(ok).toMatchObject({
      compatible: true,
      dogs_declared: false,
      dog_count: 2,
      mode: DOG_COMPATIBILITY_MODE.LEGACY,
    });
    const tooMany = evaluate(null, UP_TO_MEDIUM, undefined, 3);
    expect(tooMany.violations.map(item => item.code)).toEqual([
      DOG_VIOLATION_CODE.TOO_MANY_DOGS,
    ]);
  });

  it("a room with max_pets 0 says it does not admit dogs", () => {
    const result = evaluate([dog(5)], null, resolveDogCountLimit(null, 0));
    expect(result.violations[0].message).toContain("no admite perros");
  });
});
