import {
  PROVIDER_FAILURE_REASON,
  PROVIDER_QUOTE_CHANGE,
} from "@/src/contexts/provider-reservations/domain/provider-reservation.types";
import {
  buildDogRemarks,
  decideQuoteReconfirmation,
  isPrebookStale,
  parseChildrenAges,
  pendingTimeoutReason,
} from "@/src/contexts/provider-reservations/domain/provider-reservation.util";

describe("decideQuoteReconfirmation", () => {
  const base = {
    priceDifferencePercent: 0,
    cancellationChanged: false,
    boardChanged: false,
    sellCents: 11_500,
  };

  it("proceeds when nothing changed and no price was accepted yet", () => {
    expect(decideQuoteReconfirmation(base)).toEqual({
      requiresReconfirmation: false,
      changes: [],
    });
  });

  it("asks to reconfirm a price / cancellation / board change", () => {
    const decision = decideQuoteReconfirmation({
      ...base,
      priceDifferencePercent: 3.2,
      cancellationChanged: true,
      boardChanged: true,
    });
    expect(decision.requiresReconfirmation).toBe(true);
    expect(decision.changes).toEqual([
      PROVIDER_QUOTE_CHANGE.PRICE,
      PROVIDER_QUOTE_CHANGE.CANCELLATION,
      PROVIDER_QUOTE_CHANGE.BOARD,
    ]);
  });

  it("accepts the change once the traveler accepted exactly that price", () => {
    const decision = decideQuoteReconfirmation({
      ...base,
      priceDifferencePercent: 3.2,
      acceptedPriceCents: 11_500,
    });
    expect(decision.requiresReconfirmation).toBe(false);
  });

  it("reconfirms when the accepted price differs from the sell price", () => {
    const decision = decideQuoteReconfirmation({
      ...base,
      acceptedPriceCents: 11_000,
    });
    expect(decision).toEqual({
      requiresReconfirmation: true,
      changes: [PROVIDER_QUOTE_CHANGE.PRICE],
    });
  });
});

describe("buildDogRemarks", () => {
  it("is null without dogs", () => {
    expect(buildDogRemarks([], 0)).toBeNull();
  });

  it("describes each dog briefly", () => {
    expect(
      buildDogRemarks(
        [
          { name: "Toby", weight_kg: 12, is_ppp: false },
          { name: null, weight_kg: 31.5, is_ppp: true },
        ],
        2,
      ),
    ).toBe("Viajan 2 perros: Toby (12 kg); 31.5 kg, PPP.");
  });

  it("falls back to the legacy count and respects the length cap", () => {
    expect(buildDogRemarks([], 1)).toBe("Viajan 1 perro.");
    const long = buildDogRemarks(
      Array.from({ length: 10 }, (_, index) => ({
        name: `Perro con un nombre muy largo ${index}`,
        weight_kg: 20,
        is_ppp: false,
      })),
      10,
      80,
    );
    expect(long?.length).toBeLessThanOrEqual(80);
    expect(long?.endsWith("…")).toBe(true);
  });
});

describe("parseChildrenAges", () => {
  it("parses a comma list and drops invalid ages", () => {
    expect(parseChildrenAges("5, 8,,x,18")).toEqual([5, 8]);
    expect(parseChildrenAges()).toEqual([]);
  });
});

describe("isPrebookStale", () => {
  const now = new Date("2027-01-01T10:00:00Z");
  it("is stale without prebook id or past expiry", () => {
    expect(isPrebookStale({ prebook_id: null }, now)).toBe(true);
    expect(
      isPrebookStale(
        { prebook_id: "pb", expires_at: new Date("2027-01-01T09:59:00Z") },
        now,
      ),
    ).toBe(true);
    expect(
      isPrebookStale(
        { prebook_id: "pb", expires_at: new Date("2027-01-01T10:10:00Z") },
        now,
      ),
    ).toBe(false);
  });
});

describe("pendingTimeoutReason", () => {
  const now = new Date("2027-01-10T12:00:00Z");
  const options = { now, failAfterMinutes: 30, authMaxAgeHours: 144 };

  it("keeps waiting inside the window", () => {
    expect(
      pendingTimeoutReason({
        ...options,
        record: {
          authorized_at: "2027-01-10T11:40:00Z",
          booking_started_at: "2027-01-10T11:45:00Z",
        },
        reservationCreatedAt: null,
      }),
    ).toBeNull();
  });

  it("fails when nothing was found after the window", () => {
    expect(
      pendingTimeoutReason({
        ...options,
        record: {
          authorized_at: "2027-01-10T11:00:00Z",
          booking_started_at: "2027-01-10T11:20:00Z",
        },
        reservationCreatedAt: null,
      }),
    ).toBe(PROVIDER_FAILURE_REASON.NO_BOOKING_FOUND);
  });

  it("fails when the authorization is about to lapse", () => {
    expect(
      pendingTimeoutReason({
        ...options,
        record: {
          authorized_at: "2027-01-04T11:00:00Z",
          booking_started_at: "2027-01-10T11:55:00Z",
        },
        reservationCreatedAt: null,
      }),
    ).toBe(PROVIDER_FAILURE_REASON.AUTHORIZATION_EXPIRING);
  });
});
