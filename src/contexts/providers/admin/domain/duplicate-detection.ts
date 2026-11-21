/**
 * Duplicate detection for the admin import (plan cases A/B): a provider hotel
 * is "probably the same" as an existing v4p_jsites1 profile when both are
 * within DUPLICATE_LIMITS.MAX_DISTANCE_M and their normalized names look
 * alike. Pure functions (unit tested), no I/O.
 */

export const DUPLICATE_LIMITS = {
  /** Plan: "jsites1 a menos de 200 m". */
  MAX_DISTANCE_M: 200,
  /** 0..1 name similarity from which a nearby site counts as duplicate. */
  MIN_SIMILARITY: 0.5,
  /** Nearby sites this close are flagged even with a weak name match. */
  VERY_CLOSE_M: 25,
  VERY_CLOSE_MIN_SIMILARITY: 0.3,
} as const;

const EARTH_RADIUS_M = 6_371_000;
const METERS_PER_DEGREE_LAT = 111_320;

/**
 * Generic words that say nothing about which hotel it is ("Hotel Sol" vs
 * "Hostal Sol" must match). Compared after accent stripping.
 */
const NAME_STOPWORDS: ReadonlySet<string> = new Set([
  "hotel",
  "hoteles",
  "hostal",
  "hostel",
  "apartamento",
  "apartamentos",
  "apartments",
  "apartment",
  "apart",
  "aparthotel",
  "casa",
  "rural",
  "resort",
  "spa",
  "suites",
  "suite",
  "boutique",
  "pension",
  "posada",
  "albergue",
  "camping",
  "the",
  "el",
  "la",
  "los",
  "las",
  "les",
  "de",
  "del",
  "dels",
  "d",
  "l",
  "y",
  "i",
  "and",
  "by",
]);

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface DuplicateCandidate {
  siteId: number;
  name: string;
  latitude: number;
  longitude: number;
  active: boolean;
  profileMode: string;
}

export interface DuplicateMatch {
  site_id: number;
  name: string;
  /** Rounded meters. */
  distance_m: number;
  /** 0..1, two decimals. */
  similarity: number;
  active: boolean;
  profile_mode: string;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function isValidPoint(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): boolean {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}

/** Valid point or null (narrows nullable provider coordinates). */
export function toGeoPoint(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): GeoPoint | null {
  if (
    latitude === null ||
    latitude === undefined ||
    longitude === null ||
    longitude === undefined ||
    !isValidPoint(latitude, longitude)
  ) {
    return null;
  }
  return { latitude, longitude };
}

/** Great-circle distance in meters (haversine). */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) *
      Math.cos(toRadians(b.latitude)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Box that contains every point within `radiusM` of the given points (SQL
 * prefilter; the exact distance is computed afterwards).
 */
export function boundingBox(
  points: readonly GeoPoint[],
  radiusM: number,
): BoundingBox | null {
  const valid = points.filter(point =>
    isValidPoint(point.latitude, point.longitude),
  );
  if (valid.length === 0) {
    return null;
  }
  const lats = valid.map(point => point.latitude);
  const maxAbsLat = Math.min(
    89,
    Math.max(...lats.map(latitude => Math.abs(latitude))),
  );
  const dLat = radiusM / METERS_PER_DEGREE_LAT;
  const dLng =
    radiusM / (METERS_PER_DEGREE_LAT * Math.cos(toRadians(maxAbsLat)));
  const lngs = valid.map(point => point.longitude);
  return {
    minLat: Math.min(...lats) - dLat,
    maxLat: Math.max(...lats) + dLat,
    minLng: Math.min(...lngs) - dLng,
    maxLng: Math.max(...lngs) + dLng,
  };
}

/** Lower case, no accents, no punctuation, no generic words. */
export function normalizeName(name: string): string {
  const plain = name
    .normalize("NFD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replaceAll("&", " ")
    .replaceAll(/[^a-z0-9]+/g, " ");
  const tokens = plain
    .split(" ")
    .filter(token => token !== "" && !NAME_STOPWORDS.has(token));
  return tokens.join(" ");
}

function bigrams(value: string): Map<string, number> {
  const compact = value.replaceAll(" ", "");
  const grams = new Map<string, number>();
  for (let index = 0; index < compact.length - 1; index += 1) {
    const gram = compact.slice(index, index + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** Sørensen–Dice coefficient over character bigrams (0..1). */
function diceCoefficient(a: string, b: string): number {
  const gramsA = bigrams(a);
  const gramsB = bigrams(b);
  let sizeA = 0;
  let sizeB = 0;
  for (const count of gramsA.values()) {
    sizeA += count;
  }
  for (const count of gramsB.values()) {
    sizeB += count;
  }
  if (sizeA === 0 || sizeB === 0) {
    return a.replaceAll(" ", "") === b.replaceAll(" ", "") && a !== "" ? 1 : 0;
  }
  let overlap = 0;
  for (const [gram, count] of gramsA) {
    overlap += Math.min(count, gramsB.get(gram) ?? 0);
  }
  return (2 * overlap) / (sizeA + sizeB);
}

/** Share of the shorter name's tokens present in the other name (0..1). */
function tokenContainment(a: string, b: string): number {
  const tokensA = new Set(a.split(" ").filter(token => token.length > 1));
  const tokensB = new Set(b.split(" ").filter(token => token.length > 1));
  if (tokensA.size === 0 || tokensB.size === 0) {
    return 0;
  }
  const [small, large] =
    tokensA.size <= tokensB.size ? [tokensA, tokensB] : [tokensB, tokensA];
  let shared = 0;
  for (const token of small) {
    if (large.has(token)) {
      shared += 1;
    }
  }
  return shared / small.size;
}

/**
 * Name similarity 0..1 on normalized names: the best of bigram Dice and
 * token containment ("Sol" vs "Sol y Mar Playa" still scores high).
 */
export function nameSimilarity(a: string, b: string): number {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (left === "" || right === "") {
    return 0;
  }
  if (left === right) {
    return 1;
  }
  const score = Math.max(
    diceCoefficient(left, right),
    tokenContainment(left, right),
  );
  return Math.round(score * 100) / 100;
}

function isDuplicate(distanceM: number, similarity: number): boolean {
  if (distanceM > DUPLICATE_LIMITS.MAX_DISTANCE_M) {
    return false;
  }
  if (similarity >= DUPLICATE_LIMITS.MIN_SIMILARITY) {
    return true;
  }
  return (
    distanceM <= DUPLICATE_LIMITS.VERY_CLOSE_M &&
    similarity >= DUPLICATE_LIMITS.VERY_CLOSE_MIN_SIMILARITY
  );
}

/**
 * Existing sites that are probably the same hotel, best match first.
 * `excludedSiteIds` = sites already linked to a provider hotel.
 */
export function findDuplicates(
  hotel: { name: string; latitude: number | null; longitude: number | null },
  candidates: readonly DuplicateCandidate[],
  excludedSiteIds: ReadonlySet<number> = new Set(),
): DuplicateMatch[] {
  const origin = toGeoPoint(hotel.latitude, hotel.longitude);
  if (!origin) {
    return [];
  }
  const matches: DuplicateMatch[] = [];
  for (const candidate of candidates) {
    if (
      excludedSiteIds.has(candidate.siteId) ||
      !isValidPoint(candidate.latitude, candidate.longitude)
    ) {
      continue;
    }
    const distance = haversineMeters(origin, candidate);
    if (distance > DUPLICATE_LIMITS.MAX_DISTANCE_M) {
      continue;
    }
    const similarity = nameSimilarity(hotel.name, candidate.name);
    if (!isDuplicate(distance, similarity)) {
      continue;
    }
    matches.push({
      site_id: candidate.siteId,
      name: candidate.name,
      distance_m: Math.round(distance),
      similarity,
      active: candidate.active,
      profile_mode: candidate.profileMode,
    });
  }
  return matches.sort(
    (a, b) => b.similarity - a.similarity || a.distance_m - b.distance_m,
  );
}

/** jsites1.geolat/geolng are TEXT: "41.38", "41,38", "" ... -> number|null. */
export function parseLegacyCoordinate(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().replace(",", ".");
  if (!/^-?\d{1,3}(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
