import type { WizardDogPolicy } from "@/contexts/site-wizard/types/site-wizard.types";
import type {
  DogPolicyValidationContext,
  DogZoneInfo,
} from "@/contexts/site-wizard/utils/dog-policy.utils";

import { describe, expect, it } from "vitest";

import {
  computeDogPolicyMissing,
  copyDogPolicy,
  deriveDogTipspec,
  emptyDogPolicy,
  isMaxPetsAnswered,
  parseDogPolicyInput,
  parseMaxPetsInput,
  roomMaxPetsFor,
} from "@/contexts/site-wizard/utils/dog-policy.utils";

const ZONES: DogZoneInfo[] = [
  {
    id: 1,
    slug: "restaurant",
    is_dining_capable: true,
    requires_text: false,
    is_active: true,
  },
  {
    id: 4,
    slug: "terrace",
    is_dining_capable: true,
    requires_text: false,
    is_active: true,
  },
  {
    id: 5,
    slug: "pool_outdoor",
    is_dining_capable: false,
    requires_text: false,
    is_active: true,
  },
  {
    id: 7,
    slug: "gym",
    is_dining_capable: false,
    requires_text: false,
    is_active: true,
  },
  {
    id: 8,
    slug: "other",
    is_dining_capable: true,
    requires_text: true,
    is_active: true,
  },
  {
    id: 9,
    slug: "old",
    is_dining_capable: false,
    requires_text: false,
    is_active: false,
  },
];
const zonesById = new Map(ZONES.map(zone => [zone.id, zone]));

const ctx: DogPolicyValidationContext = {
  sizeIds: new Set([1, 2, 3, 4]),
  zonesById,
  isFullUse: false,
};

function complete(overrides: Partial<WizardDogPolicy> = {}): WizardDogPolicy {
  return {
    ...emptyDogPolicy(),
    max_size_id: 2,
    ppp_allowed: false,
    supplement_mode: "none",
    left_alone: "no",
    common_zones_answered: true,
    deposit_required: false,
    ...overrides,
  };
}

function parseErrors(body: unknown, context = ctx): string[] {
  const result = parseDogPolicyInput(body, context);
  return result.ok ? [] : result.errors;
}

describe("parseDogPolicyInput", () => {
  it("accepts an empty draft (everything unanswered)", () => {
    const result = parseDogPolicyInput({}, ctx);
    expect(result).toEqual({ ok: true, value: emptyDogPolicy() });
  });

  it("parses a full policy and trims texts", () => {
    const result = parseDogPolicyInput(
      {
        max_size_id: 4,
        ppp_allowed: true,
        supplement_mode: "per_pet_night",
        supplement_amount: "12.5",
        left_alone: "conditional",
        left_alone_conditions: "  En transportín ",
        common_zones_answered: true,
        zones: [{ zone_id: 1 }, { zone_id: 8, other_text: " Jardín " }],
        dining_zones_answered: true,
        dining_zone_ids: [8],
        deposit_required: true,
        deposit_amount: 100,
        deposit_return: "days",
        deposit_return_days: 7,
        notes: "   ",
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      supplement_amount: 12.5,
      left_alone_conditions: "En transportín",
      zones: [
        { zone_id: 1, other_text: null },
        { zone_id: 8, other_text: "Jardín" },
      ],
      dining_zone_ids: [8],
      notes: null,
    });
  });

  it("rejects wrong types and ranges", () => {
    expect(
      parseErrors({
        max_size_id: 99,
        ppp_allowed: "yes",
        supplement_mode: "weekly",
        supplement_amount: 1000.01,
        deposit_required: true,
        deposit_amount: 0,
        deposit_return: "days",
        deposit_return_days: 61,
        notes: "x".repeat(1001),
      }),
    ).toEqual([
      "max_size_id: tamaño desconocido",
      "supplement_mode: valor no válido (none, per_pet_night, per_pet_stay, fixed_stay)",
      "supplement_amount: debe estar entre 0.01 y 1000",
      "deposit_amount: debe estar entre 0.01 y 10000",
      "deposit_return_days: debe estar entre 1 y 60",
      "ppp_allowed: debe ser verdadero o falso",
      "notes: máximo 1000 caracteres",
    ]);
  });

  it("supplement_amount must be null when mode is none", () => {
    expect(
      parseErrors({ supplement_mode: "none", supplement_amount: 5 }),
    ).toEqual(["supplement_amount: debe ser null si no cobras suplemento"]);
  });

  it("left_alone_conditions only when conditional, max 500", () => {
    expect(
      parseErrors({ left_alone: "yes", left_alone_conditions: "algo" }),
    ).toEqual([
      "left_alone_conditions: solo si puede quedarse solo con condiciones",
    ]);
    expect(
      parseErrors({
        left_alone: "conditional",
        left_alone_conditions: "x".repeat(501),
      }),
    ).toEqual(["left_alone_conditions: máximo 500 caracteres"]);
  });

  it("validates zones: known, active, unique, answered flag", () => {
    expect(
      parseErrors({
        common_zones_answered: true,
        zones: [
          { zone_id: 1 },
          { zone_id: 1 },
          { zone_id: 9 },
          { zone_id: 99 },
        ],
      }),
    ).toEqual([
      "zones.1.zone_id: zona repetida",
      "zones.2.zone_id: zona desconocida o inactiva",
      "zones.3.zone_id: zona desconocida o inactiva",
    ]);
    expect(parseErrors({ zones: [{ zone_id: 1 }] })).toEqual([
      "common_zones_answered: debe ser true si hay zonas seleccionadas",
    ]);
    expect(parseErrors({ common_zones_answered: false })).toEqual([
      "common_zones_answered: solo admite true o null",
    ]);
  });

  it("other_text: empty is allowed (draft), only for requires_text zones, max 150", () => {
    expect(
      parseErrors({
        common_zones_answered: true,
        zones: [{ zone_id: 8, other_text: "" }],
      }),
    ).toEqual([]);
    expect(
      parseErrors({
        common_zones_answered: true,
        zones: [{ zone_id: 1, other_text: "Salón" }],
      }),
    ).toEqual(["zones.1.other_text: solo para zonas que requieren texto"]);
    expect(
      parseErrors({
        common_zones_answered: true,
        zones: [{ zone_id: 8, other_text: "x".repeat(151) }],
      }),
    ).toEqual(["zones.8.other_text: máximo 150 caracteres"]);
  });

  it("dining zones must be selected, dining capable and answered", () => {
    expect(
      parseErrors({
        common_zones_answered: true,
        zones: [{ zone_id: 1 }, { zone_id: 5 }],
        dining_zones_answered: true,
        dining_zone_ids: [5, 4],
      }),
    ).toEqual([
      "dining_zone_ids: la zona 5 no está entre las zonas seleccionadas o no admite comer",
      "dining_zone_ids: la zona 4 no está entre las zonas seleccionadas o no admite comer",
    ]);
    expect(
      parseErrors({
        common_zones_answered: true,
        zones: [{ zone_id: 1 }],
        dining_zone_ids: [1],
      }),
    ).toEqual([
      "dining_zones_answered: debe ser true si hay zonas para comer seleccionadas",
    ]);
  });

  it("full_unit_access only for full-use units", () => {
    expect(parseErrors({ full_unit_access: true })).toEqual([
      "full_unit_access: solo para unidades de uso completo",
    ]);
    expect(
      parseErrors({ full_unit_access: true }, { ...ctx, isFullUse: true }),
    ).toEqual([]);
  });

  it("deposit fields only when deposit is required / return in days", () => {
    expect(
      parseErrors({
        deposit_required: false,
        deposit_amount: 50,
        deposit_return: "end_of_stay",
      }),
    ).toEqual([
      "deposit_amount: solo si pides fianza",
      "deposit_return: solo si pides fianza",
    ]);
    expect(
      parseErrors({
        deposit_required: true,
        deposit_return: "end_of_stay",
        deposit_return_days: 5,
      }),
    ).toEqual([
      "deposit_return_days: solo si la devolución es en un máximo de días",
    ]);
  });

  it("rejects a non-object body", () => {
    expect(parseErrors([])).toEqual(["body: formato no válido"]);
  });
});

describe("computeDogPolicyMissing", () => {
  const unitCtx = { zonesById, isFullUse: false };

  it("lists every base field of an empty policy (notes never)", () => {
    expect(computeDogPolicyMissing(emptyDogPolicy(), unitCtx)).toEqual([
      "max_size_id",
      "ppp_allowed",
      "supplement_mode",
      "left_alone",
      "common_zones_answered",
      "deposit_required",
    ]);
  });

  it("adds full_unit_access only for full-use units", () => {
    expect(
      computeDogPolicyMissing(emptyDogPolicy(), { zonesById, isFullUse: true }),
    ).toContain("full_unit_access");
    expect(
      computeDogPolicyMissing(complete({ full_unit_access: false }), {
        zonesById,
        isFullUse: true,
      }),
    ).toEqual([]);
  });

  it("is empty for a complete policy", () => {
    expect(computeDogPolicyMissing(complete(), unitCtx)).toEqual([]);
  });

  it("requires conditional children", () => {
    expect(
      computeDogPolicyMissing(
        complete({
          supplement_mode: "per_pet_stay",
          left_alone: "conditional",
          left_alone_conditions: "  ",
          deposit_required: true,
        }),
        unitCtx,
      ),
    ).toEqual([
      "supplement_amount",
      "left_alone_conditions",
      "deposit_amount",
      "deposit_return",
    ]);
    expect(
      computeDogPolicyMissing(
        complete({
          deposit_required: true,
          deposit_amount: 50,
          deposit_return: "days",
        }),
        unitCtx,
      ),
    ).toEqual(["deposit_return_days"]);
  });

  it("requires other_text and dining answer only when relevant", () => {
    expect(
      computeDogPolicyMissing(
        complete({ zones: [{ zone_id: 5, other_text: null }] }),
        unitCtx,
      ),
    ).toEqual([]);
    expect(
      computeDogPolicyMissing(
        complete({
          zones: [
            { zone_id: 5, other_text: null },
            { zone_id: 8, other_text: null },
          ],
        }),
        unitCtx,
      ),
    ).toEqual(["zones.8.other_text", "dining_zones_answered"]);
  });
});

describe("deriveDogTipspec", () => {
  const tipCtx = {
    maxRankSizeId: 4,
    zoneSlugById: new Map(ZONES.map(zone => [zone.id, zone.slug])),
  };

  it("removes stale dog ids and keeps the others sorted", () => {
    expect(deriveDogTipspec("7,2,18,5,3", [], tipCtx)).toBe("5,7");
    expect(deriveDogTipspec(null, [], tipCtx)).toBe("");
  });

  it("adds ids when ANY active unit matches", () => {
    const strict = complete({
      supplement_mode: "per_pet_night",
      supplement_amount: 10,
      left_alone: "no",
    });
    const permissive = complete({
      max_size_id: 4,
      ppp_allowed: true,
      supplement_mode: "none",
      left_alone: "conditional",
      left_alone_conditions: "x",
      zones: [
        { zone_id: 1, other_text: null },
        { zone_id: 4, other_text: null },
        { zone_id: 5, other_text: null },
      ],
    });
    expect(deriveDogTipspec("5,7", [strict], tipCtx)).toBe("5,7");
    expect(deriveDogTipspec("5,7,16", [strict, permissive], tipCtx)).toBe(
      "2,3,5,6,7,14,15,16,18",
    );
  });

  it("left_alone yes also derives 18", () => {
    expect(
      deriveDogTipspec("", [complete({ left_alone: "yes" })], tipCtx),
    ).toBe("2,18");
  });
});

describe("copyDogPolicy", () => {
  const source = complete({
    full_unit_access: true,
    zones: [{ zone_id: 8, other_text: "Jardín" }],
    dining_zones_answered: true,
    dining_zone_ids: [8],
  });

  it("copies every field and clones the lists", () => {
    const copy = copyDogPolicy(source, true);
    expect(copy).toEqual(source);
    expect(copy.zones).not.toBe(source.zones);
    expect(copy.zones[0]).not.toBe(source.zones[0]);
    expect(copy.dining_zone_ids).not.toBe(source.dining_zone_ids);
  });

  it("nulls full_unit_access when the target is not full use", () => {
    expect(copyDogPolicy(source, false).full_unit_access).toBeNull();
  });
});

describe("parseMaxPetsInput / roomMaxPetsFor", () => {
  it("accepts a limit or unlimited", () => {
    expect(parseMaxPetsInput({ max_pets: 3, unlimited: false })).toEqual({
      ok: true,
      value: { max_pets: 3, unlimited: false },
    });
    expect(parseMaxPetsInput({ max_pets: null, unlimited: true })).toEqual({
      ok: true,
      value: { max_pets: null, unlimited: true },
    });
  });

  it("rejects incoherent or out of range bodies", () => {
    expect(parseMaxPetsInput({ max_pets: 2, unlimited: true })).toEqual({
      ok: false,
      errors: ["max_pets: debe ser null si no hay límite"],
    });
    expect(parseMaxPetsInput({ max_pets: null, unlimited: false })).toEqual({
      ok: false,
      errors: ["max_pets: debe ser un número entero"],
    });
    expect(parseMaxPetsInput({ max_pets: 6, unlimited: false })).toEqual({
      ok: false,
      errors: ["max_pets: debe estar entre 1 y 5"],
    });
    expect(parseMaxPetsInput({ max_pets: 2 })).toEqual({
      ok: false,
      errors: ["unlimited: debe ser verdadero o falso"],
    });
  });

  it("maps the site setting to rooms.max_pets", () => {
    expect(roomMaxPetsFor(null)).toBeNull();
    expect(
      roomMaxPetsFor({ max_pets: null, max_pets_unlimited: false }),
    ).toBeNull();
    expect(roomMaxPetsFor({ max_pets: 2, max_pets_unlimited: false })).toBe(2);
    expect(roomMaxPetsFor({ max_pets: null, max_pets_unlimited: true })).toBe(
      99,
    );
    expect(
      isMaxPetsAnswered({ max_pets: null, max_pets_unlimited: false }),
    ).toBe(false);
  });
});
