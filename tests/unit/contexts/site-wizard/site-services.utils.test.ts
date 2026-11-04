import type { ServicesValidationContext } from "@/contexts/site-wizard/utils/site-services.utils";

import { describe, expect, it } from "vitest";

import {
  dedupeFeatureOptions,
  SITE_FEATURE_GROUPS,
} from "@/shared/legacy-db/site-feature-groups";

import { stripHtml } from "@/contexts/catalogs/utils/strip-html.util";
import {
  deriveServicesTipspec,
  featureIdsFrom,
  parseServicesInput,
  SERVICE_TIPSPEC,
  serviceRowFor,
  SUPPLY_TIPSPEC,
  tipspecExtraFrom,
} from "@/contexts/site-wizard/utils/site-services.utils";

const CTX: ServicesValidationContext = {
  supplyIds: new Set([1, 2, 3]),
  serviceIds: new Set([10, 11]),
  featureOptions: new Map([
    [
      "exterior",
      new Map([
        [1, 1],
        [2, 2],
        [7, 2],
      ]),
    ],
    ["ubicación_y_entorno", new Map([[12, 12]])],
  ]),
  tipservIds: new Set([1, 2, 3, 4]),
  tipspecExtraIds: new Set([7, 8, 21]),
};

function errorsOf(body: unknown): string[] {
  const result = parseServicesInput(body, CTX);
  return result.ok ? [] : result.errors;
}

describe("parseServicesInput", () => {
  it("accepts a partial body and returns only the keys sent", () => {
    const result = parseServicesInput({ tipserv: [3, 1, 3] }, CTX);
    expect(result).toEqual({ ok: true, value: { tipserv: [1, 3] } });
  });

  it("rejects non-object bodies and unknown keys", () => {
    expect(errorsOf([])).toEqual(["body: formato no válido"]);
    expect(errorsOf({ foo: 1 })).toEqual(["foo: campo desconocido"]);
  });

  it("accepts yes + paid with price and pricing mode", () => {
    const result = parseServicesInput(
      {
        dog_supplies: [
          {
            supply_id: 1,
            state: "yes",
            is_paid: true,
            price: "12.5",
            pricing_mode: "per_night",
          },
          { supply_id: 2, state: "yes", is_paid: false },
          { supply_id: 3, state: "no" },
        ],
      },
      CTX,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        dog_supplies: [
          {
            supply_id: 1,
            state: "yes",
            is_paid: true,
            price: 12.5,
            pricing_mode: "per_night",
          },
          {
            supply_id: 2,
            state: "yes",
            is_paid: false,
            price: null,
            pricing_mode: null,
          },
          {
            supply_id: 3,
            state: "no",
            is_paid: null,
            price: null,
            pricing_mode: null,
          },
        ],
      },
    });
  });

  it("requires price and mode when paid, with nested keys", () => {
    expect(
      errorsOf({
        dog_supplies: [{ supply_id: 2, state: "yes", is_paid: true }],
      }),
    ).toEqual([
      "dog_supplies.2.price: obligatorio si es de pago",
      "dog_supplies.2.pricing_mode: obligatorio si es de pago",
    ]);
  });

  it("validates price range and decimals", () => {
    const base = {
      service_id: 10,
      state: "yes",
      is_paid: true,
      pricing_mode: "per_stay",
    };
    expect(errorsOf({ additional_services: [{ ...base, price: 0 }] })).toEqual([
      "additional_services.10.price: debe estar entre 0.01 y 10000",
    ]);
    expect(
      errorsOf({ additional_services: [{ ...base, price: 10_000.01 }] }),
    ).toEqual(["additional_services.10.price: debe estar entre 0.01 y 10000"]);
    expect(
      errorsOf({ additional_services: [{ ...base, price: 1.234 }] }),
    ).toEqual(["additional_services.10.price: máximo 2 decimales"]);
  });

  it("rejects price/mode when free and paid fields when not yes", () => {
    expect(
      errorsOf({
        dog_supplies: [
          {
            supply_id: 1,
            state: "yes",
            is_paid: false,
            price: 5,
            pricing_mode: "per_stay",
          },
          { supply_id: 2, state: "unanswered", is_paid: true },
        ],
      }),
    ).toEqual([
      "dog_supplies.1.price: debe ser null si no es de pago",
      "dog_supplies.1.pricing_mode: debe ser null si no es de pago",
      "dog_supplies.2.is_paid: debe ser null si la respuesta no es sí",
    ]);
  });

  it("rejects unknown/inactive/duplicated ids and bad states or modes", () => {
    expect(
      errorsOf({
        dog_supplies: [
          { supply_id: 99, state: "yes" },
          { supply_id: 1, state: "maybe" },
          { supply_id: 2, state: "yes" },
          { supply_id: 2, state: "no" },
          {
            supply_id: 3,
            state: "yes",
            is_paid: true,
            price: 1,
            pricing_mode: "per_hour",
          },
        ],
      }),
    ).toEqual([
      "dog_supplies.99.supply_id: desconocido o inactivo",
      "dog_supplies.1.state: valor no válido (unanswered, no, yes)",
      "dog_supplies.2.supply_id: repetido",
      "dog_supplies.3.pricing_mode: valor no válido (per_stay, per_night, per_pet_night, per_pet_stay)",
    ]);
  });

  it("only accepts whitelisted feature groups and known options (aliases folded)", () => {
    const ok = parseServicesInput(
      { features: { exterior: [7, 1, 2], ubicación_y_entorno: [] } },
      CTX,
    );
    expect(ok).toEqual({
      ok: true,
      value: { features: { exterior: [1, 2], ubicación_y_entorno: [] } },
    });

    expect(
      errorsOf({
        features: {
          comodidades_para_tu_perro: [1],
          "tipsite`; DROP": [1],
          exterior: [3],
        },
      }),
    ).toEqual([
      "features.comodidades_para_tu_perro: grupo no válido",
      "features.tipsite`; DROP: grupo no válido",
      "features.exterior: opciones no válidas 3",
    ]);
    expect(errorsOf({ features: [] })).toEqual([
      "features: debe ser un objeto { grupo: [ids] }",
    ]);
  });

  it("validates tipserv and tipspec_extra ids", () => {
    expect(errorsOf({ tipserv: [5], tipspec_extra: [9] })).toEqual([
      "tipserv: ids no válidos o inactivos 5",
      "tipspec_extra: ids no válidos o inactivos 9",
    ]);
    expect(errorsOf({ tipserv: "1,2" })).toEqual([
      "tipserv: debe ser una lista de ids",
    ]);
  });
});

describe("deriveServicesTipspec", () => {
  it("replaces extras + derived ids and keeps step-3 policy ids", () => {
    const csv = deriveServicesTipspec("18,2,7,9,3,6,14,15,16,10", {
      tipspecExtra: [21, 8],
      supplies: [
        { slug: "piscina-perros", state: "no" },
        { slug: "kit-bienvenida", state: "yes" },
        { slug: "cama-perro", state: "yes" },
        { slug: "comedero-bebedero", state: "unanswered" },
        { slug: "ducha-perros", state: "yes" },
        { slug: "zona-recreo", state: "yes" },
        { slug: "bienestar", state: "yes" },
        { slug: "agua-fresca", state: "yes" },
      ],
      services: [{ slug: "guarderia", state: "yes" }],
    });
    expect(csv).toBe("2,3,6,8,10,11,13,14,15,16,17,18,19,20,21");
  });

  it("keeps extras when tipspec_extra is not sent and untouched derived ids", () => {
    const csv = deriveServicesTipspec("7,9,12,13", {
      tipspecExtra: null,
      supplies: [{ slug: "comedero-bebedero", state: "no" }],
      services: [],
    });
    expect(csv).toBe("7,9,13");
  });

  it("clears all extras with an empty list", () => {
    expect(
      deriveServicesTipspec("7,8,21,2", {
        tipspecExtra: [],
        supplies: [],
        services: [],
      }),
    ).toBe("2");
    expect(
      deriveServicesTipspec(null, {
        tipspecExtra: [],
        supplies: [],
        services: [],
      }),
    ).toBe("");
  });
});

describe("CSV helpers", () => {
  it("featureIdsFrom maps aliases, drops unknown, sorts and dedupes", () => {
    const aliases = new Map([
      [1, 1],
      [2, 2],
      [7, 2],
    ]);
    expect(featureIdsFrom("7, 1,2,99,,x", aliases)).toEqual([1, 2]);
    expect(featureIdsFrom(null, aliases)).toEqual([]);
  });

  it("tipspecExtraFrom keeps only available extras", () => {
    expect(tipspecExtraFrom("21,2,7,9,8", new Set([7, 21]))).toEqual([7, 21]);
  });
});

describe("dedupeFeatureOptions", () => {
  it("trims names and folds duplicates into the lowest id", () => {
    const result = dedupeFeatureOptions([
      { id: 5, name: "Barbacoa " },
      { id: 3, name: "Barbacoa" },
      { id: 4, name: "Jardín" },
      { id: 6, name: "  " },
    ]);
    expect(result.options).toEqual([
      { id: 3, name: "Barbacoa" },
      { id: 4, name: "Jardín" },
    ]);
    expect([...result.aliases]).toEqual([
      [5, 3],
      [3, 3],
      [4, 4],
    ]);
  });

  it("whitelist excludes hidden and step-1 groups", () => {
    const names = SITE_FEATURE_GROUPS.map(group => group.namesql);
    expect(names).not.toContain("comodidades_para_tu_perro");
    expect(names).not.toContain("tipo_de_alquiler");
    expect(names).toHaveLength(9);
  });
});

describe("stripHtml", () => {
  it("removes tags and decodes common entities", () => {
    expect(
      stripHtml("Kits <a href='x.pdf' target='_blank'>aquí</a>&nbsp;&amp; más"),
    ).toBe("Kits aquí & más");
    expect(stripHtml(null)).toBe("");
  });
});

describe("serviceRowFor (step 4 prefill)", () => {
  const tipspec = new Set([2, 9, 13]);

  it("prefills yes/free when the derived tipspec id is in jsites1.tipspec", () => {
    expect(
      serviceRowFor(undefined, SUPPLY_TIPSPEC["piscina-perros"], tipspec),
    ).toEqual({
      state: "yes",
      is_paid: false,
      price: null,
      pricing_mode: null,
      prefilled: true,
    });
    expect(
      serviceRowFor(undefined, SERVICE_TIPSPEC.guarderia, tipspec),
    ).toEqual(expect.objectContaining({ state: "yes", prefilled: true }));
  });

  it("stays unanswered when the id is absent or the item has no tipspec", () => {
    expect(
      serviceRowFor(undefined, SUPPLY_TIPSPEC["cama-perro"], tipspec),
    ).toEqual({
      state: "unanswered",
      is_paid: null,
      price: null,
      pricing_mode: null,
      prefilled: false,
    });
    expect(serviceRowFor(undefined, undefined, tipspec).prefilled).toBe(false);
  });

  it("a stored answer always wins (even an explicit no)", () => {
    const stored = {
      state: "no" as const,
      is_paid: null,
      price: null,
      pricing_mode: null,
    };
    expect(
      serviceRowFor(stored, SUPPLY_TIPSPEC["piscina-perros"], tipspec),
    ).toEqual({ ...stored, prefilled: false });
    const paid = {
      state: "yes" as const,
      is_paid: true,
      price: 10,
      pricing_mode: "per_stay" as const,
    };
    expect(serviceRowFor(paid, 9, tipspec)).toEqual({
      ...paid,
      prefilled: false,
    });
  });
});
