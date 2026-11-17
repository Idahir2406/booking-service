import type { SiteWizardProperty } from "@/contexts/site-wizard/types/site-wizard.types";
import type { ReviewChecks } from "@/contexts/site-wizard/utils/site-review.utils";

import { describe, expect, it } from "vitest";

import {
  buildCompleteness,
  isPropertyComplete,
  missingRequired,
  missingRequiredErrors,
  parseOptionalUserId,
  parsePublishInput,
  relaxedItemsFor,
  REVIEW_ITEM,
  REVIEW_ITEMS,
} from "@/contexts/site-wizard/utils/site-review.utils";

const PROPERTY: SiteWizardProperty = {
  main_tipsite_id: 1,
  tipsite: [1],
  tipo_de_alquiler: 1,
  name: "Casa",
  email: "a@b.es",
  email2: "",
  telefono: "600000000",
  whatsapp_prefix: null,
  whatsapp_number: null,
  id_provincia: 8,
  provincia_label: "Barcelona",
  id_poblacion: 100,
  poblacion_label: "Vic",
  geolat: null,
  geolng: null,
  interes: "",
  distancia: "",
  ubicacion: "",
  tipenv: 2,
  tipdest: [],
};

function checks(value: boolean): ReviewChecks {
  return Object.fromEntries(
    REVIEW_ITEMS.map(item => [item.key, value]),
  ) as ReviewChecks;
}

describe("isPropertyComplete", () => {
  it("requires every step-1 mandatory field", () => {
    expect(isPropertyComplete(PROPERTY)).toBe(true);
    expect(isPropertyComplete({ ...PROPERTY, name: " " })).toBe(false);
    expect(isPropertyComplete({ ...PROPERTY, tipenv: null })).toBe(false);
    expect(isPropertyComplete({ ...PROPERTY, main_tipsite_id: null })).toBe(
      false,
    );
    expect(isPropertyComplete({ ...PROPERTY, id_poblacion: null })).toBe(false);
  });
});

describe("buildCompleteness", () => {
  it("weights: required 2, optional 1 (8 required + 4 optional = 20)", () => {
    expect(buildCompleteness(checks(true)).percent).toBe(100);
    expect(buildCompleteness(checks(false)).percent).toBe(0);

    const onlyRequired = checks(true);
    onlyRequired[REVIEW_ITEM.SUPPLIES_REVIEWED] = false;
    onlyRequired[REVIEW_ITEM.FEATURES] = false;
    onlyRequired[REVIEW_ITEM.DESCRIPTION_LONG] = false;
    onlyRequired[REVIEW_ITEM.STRIPE] = false;
    // 16 / 20 = 80
    expect(buildCompleteness(onlyRequired).percent).toBe(80);
  });

  it("missing required items keep wizard order", () => {
    const value = checks(true);
    value[REVIEW_ITEM.COVER_PHOTO] = false;
    value[REVIEW_ITEM.AVAILABILITY] = false;
    value[REVIEW_ITEM.STRIPE] = false;
    const missing = missingRequired(buildCompleteness(value));
    expect(missing).toEqual([
      { key: "cover_photo", step: 5, label: "Foto de portada" },
      { key: "availability", step: 6, label: "Disponibilidad configurada" },
    ]);
    expect(missingRequiredErrors(missing)).toEqual([
      "cover_photo: Foto de portada (paso 5)",
      "availability: Disponibilidad configurada (paso 6)",
    ]);
  });
});

describe("cancellation_policy item", () => {
  it("is a required step-6 item placed after availability", () => {
    const keys = REVIEW_ITEMS.map(item => item.key);
    expect(keys.indexOf(REVIEW_ITEM.CANCELLATION_POLICY)).toBe(
      keys.indexOf(REVIEW_ITEM.AVAILABILITY) + 1,
    );
    expect(
      REVIEW_ITEMS.find(item => item.key === REVIEW_ITEM.CANCELLATION_POLICY),
    ).toEqual({
      key: "cancellation_policy",
      step: 6,
      label: "Política de cancelación",
      required: true,
    });
  });

  it("blocks publishing a new site without a policy", () => {
    const value = checks(true);
    value[REVIEW_ITEM.CANCELLATION_POLICY] = false;
    const missing = missingRequired(
      buildCompleteness(value, { optional: relaxedItemsFor(false) }),
    );
    expect(missing).toEqual([
      { key: "cancellation_policy", step: 6, label: "Política de cancelación" },
    ]);
  });

  it("does not block a site already submitted (legacy rule)", () => {
    expect(relaxedItemsFor(true)).toEqual([
      REVIEW_ITEM.CANCELLATION_POLICY,
      REVIEW_ITEM.SCHEDULE,
    ]);
    const value = checks(true);
    value[REVIEW_ITEM.CANCELLATION_POLICY] = false;
    const completeness = buildCompleteness(value, {
      optional: relaxedItemsFor(true),
    });
    expect(missingRequired(completeness)).toEqual([]);
    const item = completeness.items.find(
      row => row.key === REVIEW_ITEM.CANCELLATION_POLICY,
    );
    expect(item).toMatchObject({ required: false, done: false });
    // 7 required -> 6 (+ the item is optional now): 16 / 17 = 94.1
    expect(completeness.percent).toBe(94);
  });
});

describe("parsePublishInput", () => {
  it("valid body", () => {
    expect(
      parsePublishInput({
        accept: true,
        terms_version: " 2026-09 ",
        user_id: "12",
      }),
    ).toEqual({ ok: true, value: { terms_version: "2026-09", user_id: 12 } });
  });

  it("collects every error", () => {
    const result = parsePublishInput({
      accept: "true",
      terms_version: "x".repeat(21),
      user_id: 0,
    });
    expect(result).toEqual({
      ok: false,
      errors: [
        "accept: Debes aceptar las condiciones",
        "terms_version: máximo 20 caracteres",
        "user_id: debe ser un id válido",
      ],
    });
    expect(parsePublishInput({ accept: true, user_id: 1 })).toEqual({
      ok: false,
      errors: ["terms_version: Obligatorio"],
    });
  });

  it("optional user id query", () => {
    expect(parseOptionalUserId("7")).toBe(7);
    expect(parseOptionalUserId()).toBeNull();
    expect(parseOptionalUserId("abc")).toBeNull();
  });
});
