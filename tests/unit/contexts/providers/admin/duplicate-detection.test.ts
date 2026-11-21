import type { DuplicateCandidate } from "@/contexts/providers/admin/domain/duplicate-detection";

import { describe, expect, it } from "vitest";

import {
  boundingBox,
  findDuplicates,
  haversineMeters,
  isValidPoint,
  nameSimilarity,
  normalizeName,
  parseLegacyCoordinate,
} from "@/contexts/providers/admin/domain/duplicate-detection";

// Plaça de Catalunya (Barcelona).
const ORIGIN = { latitude: 41.387, longitude: 2.17 };
/** Meters -> degrees of latitude (north offset). */
const north = (meters: number) => meters / 111_320;

function candidate(
  overrides: Partial<DuplicateCandidate> & { siteId: number },
): DuplicateCandidate {
  return {
    name: "Hotel Sol",
    latitude: ORIGIN.latitude,
    longitude: ORIGIN.longitude,
    active: true,
    profileMode: "legacy",
    ...overrides,
  };
}

describe("haversineMeters", () => {
  it("is 0 for the same point and symmetric", () => {
    expect(haversineMeters(ORIGIN, ORIGIN)).toBe(0);
    const other = { latitude: 41.39, longitude: 2.18 };
    expect(haversineMeters(ORIGIN, other)).toBeCloseTo(
      haversineMeters(other, ORIGIN),
      6,
    );
  });

  it("measures known distances", () => {
    // 1 degree of latitude ~ 111.2 km
    expect(
      haversineMeters(
        { latitude: 0, longitude: 0 },
        { latitude: 1, longitude: 0 },
      ),
    ).toBeCloseTo(111_195, -1);
    // ~150 m north
    expect(
      haversineMeters(ORIGIN, {
        latitude: ORIGIN.latitude + north(150),
        longitude: ORIGIN.longitude,
      }),
    ).toBeCloseTo(150, 0);
    // Madrid (Sol) - Barcelona (Pl. Catalunya) ~ 505 km
    const km =
      haversineMeters(
        { latitude: 40.4169, longitude: -3.7035 },
        { latitude: 41.387, longitude: 2.17 },
      ) / 1000;
    expect(km).toBeGreaterThan(500);
    expect(km).toBeLessThan(510);
  });
});

describe("isValidPoint / parseLegacyCoordinate", () => {
  it("rejects missing, out of range and 0,0", () => {
    expect(isValidPoint(null, 2)).toBe(false);
    expect(isValidPoint(91, 2)).toBe(false);
    expect(isValidPoint(0, 0)).toBe(false);
    expect(isValidPoint(41.3, 2.1)).toBe(true);
  });

  it("parses the TEXT columns of jsites1", () => {
    expect(parseLegacyCoordinate("41.387")).toBe(41.387);
    expect(parseLegacyCoordinate(" 2,17 ")).toBe(2.17);
    expect(parseLegacyCoordinate("-3.7")).toBe(-3.7);
    expect(parseLegacyCoordinate("")).toBeNull();
    expect(parseLegacyCoordinate("41.3N")).toBeNull();
    expect(parseLegacyCoordinate(null)).toBeNull();
  });
});

describe("boundingBox", () => {
  it("contains every point within the radius", () => {
    const box = boundingBox([ORIGIN], 200);
    expect(box).not.toBeNull();
    expect((box?.maxLat ?? 0) - ORIGIN.latitude).toBeCloseTo(north(200), 8);
    // Longitude degrees are shorter away from the equator -> wider box.
    expect((box?.maxLng ?? 0) - ORIGIN.longitude).toBeGreaterThan(north(200));
  });

  it("ignores invalid points and returns null without any", () => {
    expect(boundingBox([{ latitude: 0, longitude: 0 }], 200)).toBeNull();
  });
});

describe("normalizeName / nameSimilarity", () => {
  it("drops accents, punctuation and generic words", () => {
    expect(normalizeName("Hôtel Ça-Va & Spa, Barcelona")).toBe(
      "ca va barcelona",
    );
    expect(normalizeName("Hostal de la Plaça")).toBe("placa");
  });

  it("scores the same hotel high", () => {
    expect(nameSimilarity("Hotel Sol", "Hostal Sol")).toBe(1);
    expect(nameSimilarity("Hotel Arts Barcelona", "ARTS BARCELONA")).toBe(1);
    expect(
      nameSimilarity("Casa Fuster", "Hotel Casa Fuster G.L. Monumento"),
    ).toBeGreaterThanOrEqual(0.5);
    expect(
      nameSimilarity("Hotel Majestic", "Majestic Hotel & Spa Barcelona"),
    ).toBeGreaterThanOrEqual(0.5);
  });

  it("scores different hotels low", () => {
    expect(nameSimilarity("Hotel Sol", "Hotel Luna")).toBeLessThan(0.5);
    expect(nameSimilarity("Hotel Arts", "Hotel Pulitzer")).toBeLessThan(0.5);
    expect(nameSimilarity("Hotel", "Hostal")).toBe(0);
  });
});

describe("findDuplicates", () => {
  const hotel = {
    name: "Hotel Sol Barcelona",
    latitude: ORIGIN.latitude,
    longitude: ORIGIN.longitude,
  };

  it("flags a nearby site with a similar name", () => {
    const result = findDuplicates(hotel, [
      candidate({
        siteId: 7,
        name: "Hostal Sol Barcelona",
        latitude: ORIGIN.latitude + north(120),
      }),
    ]);
    expect(result).toEqual([
      {
        site_id: 7,
        name: "Hostal Sol Barcelona",
        distance_m: 120,
        similarity: 1,
        active: true,
        profile_mode: "legacy",
      },
    ]);
  });

  it("ignores sites farther than 200 m even with the same name", () => {
    expect(
      findDuplicates(hotel, [
        candidate({
          siteId: 8,
          name: "Hotel Sol Barcelona",
          latitude: ORIGIN.latitude + north(260),
        }),
      ]),
    ).toEqual([]);
  });

  it("ignores nearby sites with a different name", () => {
    expect(
      findDuplicates(hotel, [
        candidate({
          siteId: 9,
          name: "Apartamentos Luna",
          latitude: ORIGIN.latitude + north(60),
        }),
      ]),
    ).toEqual([]);
  });

  it("flags a site in the same building with a weaker name match", () => {
    const result = findDuplicates({ ...hotel, name: "Sol Rooms" }, [
      candidate({
        siteId: 10,
        name: "Sol Suites Center",
        latitude: ORIGIN.latitude + north(10),
      }),
    ]);
    expect(result.map(match => match.site_id)).toEqual([10]);
  });

  it("excludes already linked sites and invalid coordinates", () => {
    const result = findDuplicates(
      hotel,
      [
        candidate({ siteId: 11, name: "Hotel Sol Barcelona" }),
        candidate({
          siteId: 12,
          name: "Hotel Sol Barcelona",
          latitude: 0,
          longitude: 0,
        }),
      ],
      new Set([11]),
    );
    expect(result).toEqual([]);
  });

  it("returns nothing when the hotel has no coordinates", () => {
    expect(
      findDuplicates({ ...hotel, latitude: null }, [
        candidate({ siteId: 13, name: "Hotel Sol Barcelona" }),
      ]),
    ).toEqual([]);
  });

  it("sorts by similarity, then distance", () => {
    const result = findDuplicates(hotel, [
      candidate({
        siteId: 1,
        name: "Sol Centro",
        latitude: ORIGIN.latitude + north(30),
      }),
      candidate({
        siteId: 2,
        name: "Hotel Sol Barcelona",
        latitude: ORIGIN.latitude + north(150),
      }),
      candidate({
        siteId: 3,
        name: "Hotel Sol Barcelona",
        latitude: ORIGIN.latitude + north(50),
      }),
    ]);
    expect(result.map(match => match.site_id)).toEqual([3, 2, 1]);
  });
});
