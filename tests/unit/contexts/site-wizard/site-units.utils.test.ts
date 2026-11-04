import { describe, expect, it } from "vitest";

import {
  buildCopyNames,
  computeLegacyDerivedColumns,
  formatLegacyPrice,
  parseBoardOptions,
  parseCreateUnitInput,
  parseExtras,
  parseUnitInput,
  summarizeUnits,
} from "@/contexts/site-wizard/utils/site-units.utils";

const validBody = {
  site_unit_id: 3,
  name: "  Habitación doble ",
  price_per_night: "85.50",
  max_guests: 2,
  bathrooms: 1,
  board_options: [
    { code: "room_only", price: 0, is_included: true, is_default: true },
    { code: "breakfast_included", price: 12.5 },
  ],
  extras: [{ name: "Cuna", pricing_mode: "per_stay", price: 10 }],
};

function boardErrors(raw?: unknown): string[] {
  const errors: string[] = [];
  parseBoardOptions(raw, errors);
  return errors;
}

describe("parseBoardOptions", () => {
  it("accepts a valid set and applies defaults", () => {
    const errors: string[] = [];
    const options = parseBoardOptions(validBody.board_options, errors);
    expect(errors).toEqual([]);
    expect(options[1]).toEqual({
      code: "breakfast_included",
      price: 12.5,
      is_included: false,
      is_default: false,
      is_active: true,
    });
  });

  it("requires at least one option", () => {
    expect(boardErrors([])).toEqual([
      "board_options: marca al menos un régimen",
    ]);
    expect(boardErrors()).toEqual(["board_options: marca al menos un régimen"]);
  });

  it("rejects unknown and duplicated codes with nested field names", () => {
    const errors = boardErrors([
      { code: "room_only", price: 0, is_default: true },
      { code: "room_only", price: 5 },
      { code: "brunch", price: 5 },
    ]);
    expect(errors).toContain("board_options.1.code: régimen repetido");
    expect(
      errors.some(e => e.startsWith("board_options.2.code: valor no válido")),
    ).toBe(true);
  });

  it("requires exactly one active default", () => {
    expect(
      boardErrors([
        { code: "room_only", price: 0 },
        { code: "half_board", price: 20 },
      ]),
    ).toContain("board_options: debe haber exactamente un régimen por defecto");
    expect(
      boardErrors([
        { code: "room_only", price: 0, is_default: true },
        { code: "half_board", price: 20, is_default: true },
      ]),
    ).toContain("board_options: debe haber exactamente un régimen por defecto");
    // an inactive default does not count
    expect(
      boardErrors([
        { code: "room_only", price: 0, is_default: true, is_active: false },
        { code: "half_board", price: 20 },
      ]),
    ).toContain("board_options: debe haber exactamente un régimen por defecto");
  });

  it("requires at least one active option", () => {
    expect(
      boardErrors([
        { code: "room_only", price: 0, is_default: true, is_active: false },
      ]),
    ).toContain("board_options: marca al menos un régimen activo");
  });

  it("forces price 0 when included and bounds the supplement", () => {
    const errors = boardErrors([
      { code: "room_only", price: 5, is_included: true, is_default: true },
      { code: "half_board", price: 10_000.01 },
      { code: "full_board", price: -1 },
      { code: "all_inclusive", price: 1.234 },
    ]);
    expect(errors).toEqual([
      "board_options.0.price: debe ser 0 si está incluido en el precio",
      "board_options.1.price: no puede ser mayor que 10000",
      "board_options.2.price: debe ser 0 o más",
      "board_options.3.price: máximo 2 decimales",
    ]);
  });

  it("allows only one included regime", () => {
    expect(
      boardErrors([
        { code: "room_only", price: 0, is_included: true, is_default: true },
        { code: "breakfast_included", price: 0, is_included: true },
      ]),
    ).toContain(
      "board_options: solo un régimen puede estar incluido en el precio",
    );
  });
});

describe("parseExtras", () => {
  it("validates name, mode, price and max count", () => {
    const errors: string[] = [];
    parseExtras(
      [
        { name: " ", pricing_mode: "per_night", price: 5 },
        { name: "Parking", pricing_mode: "per_week", price: 5 },
      ],
      errors,
    );
    expect(errors[0]).toBe("extras.0.name: es obligatorio");
    expect(errors[1]).toMatch(/^extras\.1\.pricing_mode: valor no válido/);

    const tooMany: string[] = [];
    parseExtras(
      Array.from({ length: 21 }, () => ({
        name: "x",
        pricing_mode: "per_stay",
        price: 1,
      })),
      tooMany,
    );
    expect(tooMany).toEqual(["extras: máximo 20 extras"]);
  });
});

describe("parseUnitInput / parseCreateUnitInput", () => {
  it("parses a valid body (trim, numeric strings, default copies)", () => {
    const result = parseCreateUnitInput(validBody);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Habitación doble");
      expect(result.value.price_per_night).toBe(85.5);
      expect(result.value.description).toBeNull();
      expect(result.value.copies).toBe(1);
    }
  });

  it("collects every field error at once", () => {
    const result = parseCreateUnitInput({
      ...validBody,
      name: "",
      price_per_night: 0,
      max_guests: 51,
      bathrooms: 1.5,
      copies: 51,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        "name: es obligatorio",
        "price_per_night: debe ser mayor que 0",
        "max_guests: debe estar entre 1 y 50",
        "bathrooms: debe ser un número entero",
        "copies: debe estar entre 1 y 50",
      ]);
    }
  });

  it("rejects prices over 100000 and non-object bodies", () => {
    const result = parseUnitInput({ ...validBody, price_per_night: 100_000.5 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        "price_per_night: no puede ser mayor que 100000",
      ]);
    }
    expect(parseUnitInput(null)).toEqual({
      ok: false,
      errors: ["body: formato no válido"],
    });
  });
});

describe("buildCopyNames", () => {
  it("numbers copies from the second one", () => {
    expect(buildCopyNames("Doble", 3)).toEqual(["Doble", "Doble 2", "Doble 3"]);
    expect(buildCopyNames("Suite", 1)).toEqual(["Suite"]);
  });

  it("truncates the base so every name fits the max length", () => {
    const names = buildCopyNames("x".repeat(255), 12);
    expect(names.every(name => name.length <= 255)).toBe(true);
    expect(names[11]).toBe(`${"x".repeat(252)} 12`);
  });
});

describe("derived fields", () => {
  const units = [
    { price_per_night: "85.00", max_guests: 2, bathrooms: 1, is_active: true },
    { price_per_night: "60.50", max_guests: 4, bathrooms: 2, is_active: true },
    { price_per_night: "10.00", max_guests: 8, bathrooms: 3, is_active: false },
  ];

  it("summarizes active units only", () => {
    expect(summarizeUnits(units)).toEqual({
      count: 2,
      capacity: 6,
      bathrooms: 3,
      min_price: 60.5,
    });
  });

  it("formats legacy columns as text without trailing zeros", () => {
    expect(computeLegacyDerivedColumns(units)).toEqual({
      precio: "60.5",
      capacity: "6",
      rooms: "2",
      banos: "3",
    });
    expect(formatLegacyPrice(85)).toBe("85");
    expect(formatLegacyPrice(85.25)).toBe("85.25");
  });

  it("empties precio when there are no active units", () => {
    expect(computeLegacyDerivedColumns([units[2]])).toEqual({
      precio: "",
      capacity: "0",
      rooms: "0",
      banos: "0",
    });
  });
});
