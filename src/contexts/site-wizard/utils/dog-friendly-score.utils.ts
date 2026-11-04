/**
 * Dog Friendly Score ("SCORE MASCOTAS" functional spec). Pure: the caller
 * maps DB rows to these inputs. Full precision everywhere; paws thresholds
 * are applied on the UNROUNDED score, 1 decimal only for display.
 *
 * Objective part (41 raw points):
 *  - Block 1 policies (16): PPP yes 8 + size (small 0, up to medium 2,
 *    up to large 4, XL / no limit 8). Supplement, max dogs, left alone: 0.
 *  - Block 2 services (20): amenities sum capped 12, facilities capped 4,
 *    additional services capped 4 (paid or free alike).
 *  - Block 3 integration (5): A dining zone >= 1 -> 3; B other common zones
 *    (counts_as_extra_zone, excluding zones also used for dining) 0/1/>=2 ->
 *    0/1/2; C full-use unit "dog may access the whole unit" yes -> 5.
 *    Establishments with dining/common zones: A + B (max 5); full use: C.
 * Multi-unit sites: the MOST FAVORABLE active unit per criterion.
 * Reviews: weight w = 5% per verified review up to 25% (5+), R by average.
 * Score = O(1 - w) + R·w. Paws 2..5; veto (>= 5 reviews, avg < 3.5) -> 2.
 */

export const SCORE_MAX = {
  POLICY: 16,
  SERVICES: 20,
  AMENITIES: 12,
  FACILITIES: 4,
  ADDITIONAL_SERVICES: 4,
  INTEGRATION: 5,
  OBJECTIVE: 41,
} as const;

export const SCORE_POINTS = {
  PPP: 8,
  DINING: 3,
  EXTRA_ZONES_CAP: 2,
  FULL_UNIT_ACCESS: 5,
} as const;

/** dog_sizes.rank -> points (1 small, 2 medium, 3 large, 4 extra large). */
export const SIZE_RANK_POINTS: Readonly<Partial<Record<number, number>>> = {
  1: 0,
  2: 2,
  3: 4,
  4: 8,
};

export const PAWS = {
  MIN: 2,
  MAX: 5,
  VETO_MIN_REVIEWS: 5,
  VETO_AVERAGE: 3.5,
} as const;

/** Percent of weight per verified review (5 %). */
const REVIEW_WEIGHT_STEP_PERCENT = 5;
const REVIEW_WEIGHT_MAX_COUNT = 5;

/** One active unit's dog policy, reduced to what the score reads. */
export interface ScoreUnitInput {
  ppp_allowed: boolean | null;
  /** dog_sizes.rank of max_size_id (null = not answered). */
  max_size_rank: number | null;
  is_full_use: boolean;
  full_unit_access: boolean | null;
  /** Zones of A1.6 "Acceso a zonas comunes". */
  zone_ids: readonly number[];
  /** Zones of A1.6.1 "¿Dónde puede desayunar/comer con su perro?". */
  dining_zone_ids: readonly number[];
}

export interface ScoreInput {
  units: readonly ScoreUnitInput[];
  /** common_zones with counts_as_extra_zone = 1. */
  extraZoneIds: ReadonlySet<number>;
  /** score_points of amenities answered "yes" (is_scoring only). */
  amenityPoints: readonly number[];
  /** score_points of facilities answered "yes" (is_scoring only). */
  facilityPoints: readonly number[];
  /** score_points of additional services answered "yes". */
  servicePoints: readonly number[];
  reviews: ReviewsInput;
}

export interface ReviewsInput {
  count: number;
  /** 1-5 average, null without reviews. */
  average: number | null;
}

export interface ScoreBlockResult {
  points: number;
  max: number;
}

export interface ScoreResult {
  objective: number;
  score: number;
  paws: number;
  blocks: {
    policy: ScoreBlockResult;
    services: ScoreBlockResult;
    integration: ScoreBlockResult;
  };
  /** Unrounded values (thresholds / tests). */
  raw: {
    objective: number;
    score: number;
    reviewWeight: number;
    reviewEquivalence: number;
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function capped(values: readonly number[], cap: number): number {
  return Math.min(cap, sum(values.filter(value => Number.isFinite(value))));
}

export function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

export function sizePoints(rank: number | null): number {
  if (rank === null) {
    return 0;
  }
  if (rank >= 4) {
    return SIZE_RANK_POINTS[4] ?? 0;
  }
  return SIZE_RANK_POINTS[rank] ?? 0;
}

export function policyPoints(units: readonly ScoreUnitInput[]): number {
  const ppp = units.some(unit => unit.ppp_allowed === true)
    ? SCORE_POINTS.PPP
    : 0;
  const size = Math.max(
    0,
    ...units.map(unit => sizePoints(unit.max_size_rank)),
  );
  return Math.min(SCORE_MAX.POLICY, ppp + size);
}

export function servicesPoints(
  input: Pick<ScoreInput, "amenityPoints" | "facilityPoints" | "servicePoints">,
): number {
  return (
    capped(input.amenityPoints, SCORE_MAX.AMENITIES) +
    capped(input.facilityPoints, SCORE_MAX.FACILITIES) +
    capped(input.servicePoints, SCORE_MAX.ADDITIONAL_SERVICES)
  );
}

/** A: at least one valid dining zone ("Ninguna" = none -> 0). */
export function diningPoints(unit: ScoreUnitInput): number {
  return unit.dining_zone_ids.length > 0 ? SCORE_POINTS.DINING : 0;
}

/** B: computable extra zones not already selected as dining zones. */
export function extraZonePoints(
  unit: ScoreUnitInput,
  extraZoneIds: ReadonlySet<number>,
): number {
  const dining = new Set(unit.dining_zone_ids);
  const extra = new Set(
    unit.zone_ids.filter(id => extraZoneIds.has(id) && !dining.has(id)),
  );
  return Math.min(SCORE_POINTS.EXTRA_ZONES_CAP, extra.size);
}

/** C: full-use unit where the dog may access the whole unit. */
export function fullAccessPoints(unit: ScoreUnitInput): number {
  return unit.is_full_use && unit.full_unit_access === true
    ? SCORE_POINTS.FULL_UNIT_ACCESS
    : 0;
}

export function integrationPoints(
  units: readonly ScoreUnitInput[],
  extraZoneIds: ReadonlySet<number>,
): number {
  const best = (points: (unit: ScoreUnitInput) => number) =>
    Math.max(0, ...units.map(unit => points(unit)));
  const a = best(diningPoints);
  const b = best(unit => extraZonePoints(unit, extraZoneIds));
  const c = best(fullAccessPoints);
  return Math.min(SCORE_MAX.INTEGRATION, Math.max(a + b, c));
}

/** w: 0, 5, 10, 15, 20, 25 % for 0..5+ verified reviews. */
export function reviewWeight(count: number): number {
  const effective = Math.max(
    0,
    Math.min(REVIEW_WEIGHT_MAX_COUNT, Math.floor(count)),
  );
  return (effective * REVIEW_WEIGHT_STEP_PERCENT) / 100;
}

/** R: average 1-5 -> 0/40/60/80/100. */
export function reviewEquivalence(average: number | null): number {
  if (average === null || !Number.isFinite(average) || average < 3) {
    return 0;
  }
  if (average < 3.5) {
    return 40;
  }
  if (average < 4) {
    return 60;
  }
  if (average < 4.5) {
    return 80;
  }
  return 100;
}

/** Paws on the unrounded score, then veto, never below 2. */
export function pawsFor(score: number, reviews: ReviewsInput): number {
  let paws = 2;
  if (score >= 90) {
    paws = 5;
  } else if (score >= 75) {
    paws = 4;
  } else if (score >= 60) {
    paws = 3;
  }
  const veto =
    reviews.count >= PAWS.VETO_MIN_REVIEWS &&
    reviews.average !== null &&
    reviews.average < PAWS.VETO_AVERAGE;
  if (veto) {
    paws = Math.min(paws, PAWS.MIN);
  }
  return Math.max(PAWS.MIN, Math.min(PAWS.MAX, paws));
}

/** Score from raw objective points (0..41) and reviews. */
export function scoreFromObjectivePoints(
  objectivePoints: number,
  reviews: ReviewsInput,
): Pick<ScoreResult, "objective" | "score" | "paws" | "raw"> {
  const objective = (objectivePoints / SCORE_MAX.OBJECTIVE) * 100;
  const weight = reviews.count > 0 ? reviewWeight(reviews.count) : 0;
  const equivalence = reviewEquivalence(reviews.average);
  const score = objective * (1 - weight) + equivalence * weight;
  return {
    objective: roundOne(objective),
    score: roundOne(score),
    paws: pawsFor(score, reviews),
    raw: {
      objective,
      score,
      reviewWeight: weight,
      reviewEquivalence: equivalence,
    },
  };
}

export function computeDogFriendlyScore(input: ScoreInput): ScoreResult {
  const policy = policyPoints(input.units);
  const services = servicesPoints(input);
  const integration = integrationPoints(input.units, input.extraZoneIds);
  const result = scoreFromObjectivePoints(
    policy + services + integration,
    input.reviews,
  );
  return {
    ...result,
    blocks: {
      policy: { points: policy, max: SCORE_MAX.POLICY },
      services: { points: services, max: SCORE_MAX.SERVICES },
      integration: { points: integration, max: SCORE_MAX.INTEGRATION },
    },
  };
}
