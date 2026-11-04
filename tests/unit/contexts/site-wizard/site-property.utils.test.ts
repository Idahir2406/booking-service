import { describe, expect, it } from "vitest";

import {
  firstCsvId,
  formatWhatsapp,
  legacySlug,
  normalizeCsvIds,
  parseCoordinate,
  parseWhatsapp,
  TIPO_DE_ALQUILER,
  TIPRENT,
  tiprentFromTipoDeAlquiler,
} from "@/contexts/site-wizard/utils/site-property.utils";

describe("tiprentFromTipoDeAlquiler", () => {
  it("maps whole place (1) to tiprent integro (2)", () => {
    expect(tiprentFromTipoDeAlquiler(TIPO_DE_ALQUILER.WHOLE_PLACE)).toBe(
      TIPRENT.INTEGRO,
    );
    expect(TIPRENT.INTEGRO).toBe(2);
  });

  it("maps by rooms (2) to tiprent habitaciones (1)", () => {
    expect(tiprentFromTipoDeAlquiler(TIPO_DE_ALQUILER.BY_ROOMS)).toBe(
      TIPRENT.HABITACIONES,
    );
    expect(TIPRENT.HABITACIONES).toBe(1);
  });
});

describe("normalizeCsvIds", () => {
  it("dedupes, sorts ascending and joins without spaces", () => {
    expect(normalizeCsvIds([9, 3, 9, 2])).toBe("2,3,9");
  });

  it("always includes required ids (main tipsite)", () => {
    expect(normalizeCsvIds([9, 3], [5])).toBe("3,5,9");
    expect(normalizeCsvIds([], [5])).toBe("5");
    expect(normalizeCsvIds([5, 1], [5])).toBe("1,5");
  });

  it("drops non-positive and non-integer ids, empty -> ''", () => {
    expect(normalizeCsvIds([0, -1, 1.5, Number.NaN])).toBe("");
    expect(normalizeCsvIds([])).toBe("");
  });
});

describe("firstCsvId", () => {
  it("returns the first valid id or null", () => {
    expect(firstCsvId("2")).toBe(2);
    expect(firstCsvId("3,1")).toBe(3);
    expect(firstCsvId("0")).toBeNull();
    expect(firstCsvId("")).toBeNull();
    expect(firstCsvId(null)).toBeNull();
  });
});

describe("parseCoordinate", () => {
  it("parses legacy text coordinates", () => {
    expect(parseCoordinate("42.137247122320254")).toBeCloseTo(42.137_247, 5);
    expect(parseCoordinate("")).toBeNull();
    expect(parseCoordinate("abc")).toBeNull();
    expect(parseCoordinate(null)).toBeNull();
  });
});

describe("parseWhatsapp", () => {
  it("splits '+34 612345678'", () => {
    expect(parseWhatsapp("+34 612345678")).toEqual({
      prefix: "+34",
      number: "612345678",
    });
  });

  it("keeps only digits in the number part", () => {
    expect(parseWhatsapp("+593 98 370-8845")).toEqual({
      prefix: "+593",
      number: "983708845",
    });
    expect(parseWhatsapp("+34 612 345")).toEqual({
      prefix: "+34",
      number: "612345",
    });
  });

  it("without '+prefix ' puts all digits in number", () => {
    expect(parseWhatsapp("612345678")).toEqual({
      prefix: null,
      number: "612345678",
    });
    expect(parseWhatsapp("+34612345678")).toEqual({
      prefix: null,
      number: "34612345678",
    });
  });

  it("empty -> nulls", () => {
    expect(parseWhatsapp("")).toEqual({ prefix: null, number: null });
    expect(parseWhatsapp(null)).toEqual({ prefix: null, number: null });
  });
});

describe("formatWhatsapp", () => {
  it("formats '+34 612345678'", () => {
    expect(formatWhatsapp("+34", "612 345 678")).toBe("+34 612345678");
  });

  it("returns '' without number (column is NOT NULL)", () => {
    expect(formatWhatsapp("+34", "")).toBe("");
    expect(formatWhatsapp("", "")).toBe("");
    expect(formatWhatsapp(null, null)).toBe("");
  });

  it("round-trips with parseWhatsapp", () => {
    const parts = parseWhatsapp("+34 612345678");
    expect(formatWhatsapp(parts.prefix, parts.number)).toBe("+34 612345678");
  });
});

describe("legacySlug (PHP jSlugify)", () => {
  it("removes accents, lowercases and dashes separators", () => {
    expect(legacySlug("Costa Brava")).toBe("costa-brava");
    expect(legacySlug("Picos de Europa")).toBe("picos-de-europa");
    expect(legacySlug("A Baña")).toBe("a-bana");
    expect(legacySlug("Albanyà")).toBe("albanya");
  });

  it("turns any non [a-z0-9] run into a single dash and trims dashes", () => {
    expect(legacySlug("Santa Cristina d´Aro")).toBe("santa-cristina-d-aro");
    expect(legacySlug("  --Hola,   Mundo!!  ")).toBe("hola-mundo");
  });

  it("maps special letters like PHP (ß, æ, œ, ø)", () => {
    expect(legacySlug("Straße Æsir Œuvre Ørsted")).toBe(
      "strasse-aesir-oeuvre-orsted",
    );
  });

  it("empty -> ''", () => {
    expect(legacySlug("")).toBe("");
    expect(legacySlug(null)).toBe("");
  });
});
