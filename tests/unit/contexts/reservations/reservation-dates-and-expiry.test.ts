import {
  calcNightsUtc,
  getNightDatesUtc,
  resolveCheckoutExpiry,
  resolvePendingTtlMs,
  STRIPE_CHECKOUT_MIN_EXPIRY_MS,
} from "@/src/contexts/reservations/utils/reservation-policy.util";

const ORIGINAL_TZ = process.env.TZ;

describe("UTC night math (DST-safe)", () => {
  beforeAll(() => {
    // Europe/Madrid: DST starts 2026-03-29 (23h day), ends 2026-10-25 (25h day).
    process.env.TZ = "Europe/Madrid";
  });

  afterAll(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  it("counts 2 nights across the spring-forward weekend", () => {
    // Old local-time math: (47h / 24h) floored = 1 night. Only observable
    // when the runtime honours a DST timezone (TZ may be fixed per worker).
    const localHasDst =
      new Date("2026-03-28T12:00:00").getTimezoneOffset() !==
      new Date("2026-03-30T12:00:00").getTimezoneOffset();
    if (localHasDst) {
      const localMs =
        new Date("2026-03-30T00:00:00").getTime() -
        new Date("2026-03-28T00:00:00").getTime();
      expect(Math.floor(localMs / 86_400_000)).toBe(1);
    }

    expect(calcNightsUtc("2026-03-28", "2026-03-30")).toBe(2);
  });

  it("counts 2 nights across the fall-back weekend", () => {
    expect(calcNightsUtc("2026-10-24", "2026-10-26")).toBe(2);
  });

  it("lists every night once across DST changes", () => {
    expect(getNightDatesUtc("2026-03-28", "2026-03-31")).toEqual([
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
    ]);
    expect(getNightDatesUtc("2026-10-24", "2026-10-27")).toEqual([
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
    ]);
  });

  it("returns 0 / [] for invalid or inverted ranges", () => {
    expect(calcNightsUtc("2026-05-10", "2026-05-10")).toBe(0);
    expect(calcNightsUtc("2026-05-10", "2026-05-08")).toBe(-2);
    expect(getNightDatesUtc("2026-05-10", "2026-05-08")).toEqual([]);
    expect(calcNightsUtc("nope", "2026-05-08")).toBe(0);
  });
});

describe("pending TTL aligned with Checkout Session expires_at", () => {
  it("clamps the configured TTL to Stripe's 30 min minimum (+margin)", () => {
    expect(resolvePendingTtlMs(15 * 60 * 1000)).toBeGreaterThan(
      STRIPE_CHECKOUT_MIN_EXPIRY_MS,
    );
    expect(resolvePendingTtlMs(45 * 60 * 1000)).toBe(45 * 60 * 1000);
    expect(resolvePendingTtlMs(48 * 60 * 60 * 1000)).toBe(24 * 60 * 60 * 1000);
  });

  it("uses the reservation expiry as session expires_at when valid", () => {
    const now = new Date("2026-06-01T10:00:00.000Z");
    const expiration = new Date(now.getTime() + 31 * 60 * 1000);

    const result = resolveCheckoutExpiry(expiration, now);

    expect(result.expiresAtUnix).toBe(expiration.getTime() / 1000);
    expect(result.expirationDate.getTime()).toBe(expiration.getTime());
  });

  it("pushes both dates when the hold is too close to Stripe's minimum", () => {
    const now = new Date("2026-06-01T10:00:00.000Z");
    const expiration = new Date(now.getTime() + 10 * 60 * 1000);

    const result = resolveCheckoutExpiry(expiration, now);

    expect(result.expiresAtUnix * 1000 - now.getTime()).toBeGreaterThanOrEqual(
      STRIPE_CHECKOUT_MIN_EXPIRY_MS,
    );
    expect(result.expirationDate.getTime()).toBe(result.expiresAtUnix * 1000);
  });
});
