import { Buffer } from "node:buffer";

import {
  PROVIDER_PENALTY_SOURCE,
  quoteProviderCancellation,
  readCancellationRecord,
  scaleProviderPenaltyToSell,
  withCancellationRecord,
} from "@/src/contexts/provider-reservations/domain/provider-cancellation";
import {
  checkNuiteeSignature,
  computeNuiteeSignature,
  decodeEmbeddedJson,
  NUITEE_SIGNATURE_FAILURE,
  parseProviderWebhook,
  verifyAuthToken,
} from "@/src/contexts/provider-reservations/domain/provider-webhook.util";

const OFFER = {
  refundable: true,
  cancellation_json: [
    {
      deadline: "2027-06-01T00:00:00.000Z",
      amountCents: 0,
      currency: "EUR",
      timezone: null,
    },
    {
      deadline: "2027-06-05T00:00:00.000Z",
      amountCents: 10_000,
      currency: "EUR",
      timezone: null,
    },
    {
      deadline: "2027-06-09T00:00:00.000Z",
      amountCents: 20_000,
      currency: "EUR",
      timezone: null,
    },
  ],
  net_cents: 20_000,
  markup_rate: 0.15,
  currency: "EUR",
};

describe("scaleProviderPenaltyToSell", () => {
  it("adds the markup to the net penalty (half up)", () => {
    expect(scaleProviderPenaltyToSell(10_000, 0.15, 23_000)).toBe(11_500);
    expect(scaleProviderPenaltyToSell(1005, 0.12, 23_000)).toBe(1126);
  });

  it("never keeps more than what is still paid", () => {
    expect(scaleProviderPenaltyToSell(22_000, 0.15, 23_000)).toBe(23_000);
    expect(scaleProviderPenaltyToSell(10_000, 0.15, 5000)).toBe(5000);
  });

  it("is 0 for no or invalid penalty", () => {
    expect(scaleProviderPenaltyToSell(0, 0.15, 23_000)).toBe(0);
    expect(scaleProviderPenaltyToSell(Number.NaN, 0.15, 23_000)).toBe(0);
  });
});

describe("quoteProviderCancellation", () => {
  const base = {
    offer: OFFER,
    chargedCents: 23_000,
    alreadyRefundedCents: 0,
  };

  it("is free before the first paid deadline (zero nodes ignored)", () => {
    const quote = quoteProviderCancellation({
      ...base,
      now: new Date("2027-06-02T00:00:00Z"),
    });
    expect(quote).toMatchObject({
      paid_cents: 23_000,
      penalty_net_cents: 0,
      penalty_cents: 0,
      refund_cents: 23_000,
      within_free_period: true,
      deadline_iso: "2027-06-05T00:00:00.000Z",
      penalty_source: PROVIDER_PENALTY_SOURCE.COMPUTED,
    });
  });

  it("applies the latest passed deadline scaled to the sell price", () => {
    const quote = quoteProviderCancellation({
      ...base,
      now: new Date("2027-06-06T00:00:00Z"),
    });
    expect(quote).toMatchObject({
      penalty_net_cents: 10_000,
      penalty_cents: 11_500,
      refund_cents: 11_500,
      within_free_period: false,
      deadline_iso: "2027-06-09T00:00:00.000Z",
    });
  });

  it("charges everything on a non refundable rate", () => {
    const quote = quoteProviderCancellation({
      ...base,
      offer: { ...OFFER, refundable: false },
      now: new Date("2027-01-01T00:00:00Z"),
    });
    expect(quote.penalty_cents).toBe(23_000);
    expect(quote.refund_cents).toBe(0);
    expect(quote.deadline_iso).toBeNull();
  });

  it("prefers the real provider penalty in the same currency", () => {
    const quote = quoteProviderCancellation({
      ...base,
      now: new Date("2027-06-06T00:00:00Z"),
      providerPenaltyNetCents: 4000,
      providerPenaltyCurrency: "eur",
    });
    expect(quote.penalty_cents).toBe(4600);
    expect(quote.penalty_source).toBe(PROVIDER_PENALTY_SOURCE.PROVIDER);
  });

  it("ignores a provider penalty in another currency", () => {
    const quote = quoteProviderCancellation({
      ...base,
      now: new Date("2027-06-06T00:00:00Z"),
      providerPenaltyNetCents: 4000,
      providerPenaltyCurrency: "USD",
    });
    expect(quote.penalty_cents).toBe(11_500);
    expect(quote.penalty_source).toBe(PROVIDER_PENALTY_SOURCE.COMPUTED);
  });

  it("waives the penalty (hotel cancellation / admin courtesy)", () => {
    const quote = quoteProviderCancellation({
      ...base,
      alreadyRefundedCents: 1000,
      now: new Date("2027-06-10T00:00:00Z"),
      waivePenalty: true,
    });
    expect(quote).toMatchObject({
      paid_cents: 22_000,
      penalty_cents: 0,
      refund_cents: 22_000,
      penalty_source: PROVIDER_PENALTY_SOURCE.WAIVED,
    });
  });

  it("falls back to the reservation markup when the offer has none", () => {
    const quote = quoteProviderCancellation({
      ...base,
      offer: { ...OFFER, markup_rate: null },
      fallbackMarkupRate: 0.1,
      now: new Date("2027-06-06T00:00:00Z"),
    });
    expect(quote.penalty_cents).toBe(11_000);
  });
});

describe("cancellation record in provider_booking_json", () => {
  it("round-trips and keeps the other keys", () => {
    const json = withCancellationRecord(
      { version: 1, remarks: "x" },
      {
        status: "pending",
        initiator: "traveler",
        requested_at: "2027-06-01T00:00:00.000Z",
        reason: "change_of_plans",
        notes: null,
        actor_id: 7,
        waive_penalty: false,
        provider_raw_status: null,
        penalty_net_cents: null,
        penalty_cents: null,
        refund_cents: null,
        completed_at: null,
        alerted_at: null,
      },
    );
    expect(json.remarks).toBe("x");
    expect(readCancellationRecord(json)?.status).toBe("pending");
    expect(
      readCancellationRecord(withCancellationRecord(json, null)),
    ).toBeNull();
    expect(readCancellationRecord(null)).toBeNull();
  });
});

describe("Nuitee webhook authentication token", () => {
  it("accepts the raw token and the Bearer form", () => {
    expect(verifyAuthToken("tok_123", "tok_123")).toBe(true);
    expect(verifyAuthToken("Bearer tok_123", "tok_123")).toBe(true);
    expect(verifyAuthToken("bearer   tok_123 ", "tok_123")).toBe(true);
  });

  it("rejects a missing, wrong or prefix token", () => {
    expect(verifyAuthToken(null, "tok_123")).toBe(false);
    expect(verifyAuthToken("", "tok_123")).toBe(false);
    expect(verifyAuthToken("tok_12", "tok_123")).toBe(false);
    expect(verifyAuthToken("Bearer nope", "tok_123")).toBe(false);
    expect(verifyAuthToken("tok_123", "")).toBe(false);
  });
});

function at(seconds: number): Date {
  return new Date(seconds * 1000);
}

describe("Nuitee webhook request signature (SHA-512)", () => {
  // Test vector from docs.liteapi.travel/docs/using-liteapi-webhooks.
  const body = Buffer.from('{"sample":"payload"}');
  const secret = "testSharedSecret";
  const timestamp = "1602838959";
  const expected =
    "6854adcc0fbd9b4216bcbc5dd0742fb83929a8151cfc8bd37ecb41a4a0ebb9c0abdafee11d7e5e9fc25aedff922c5b124daafc0e30e1e93a98472630d274b016";
  const input = {
    rawBody: body,
    secret,
    timestamp,
    signature: expected,
    maxAgeSeconds: 86_400,
    now: at(1_602_838_959 + 60),
  };

  it("reproduces the documented test vector", () => {
    expect(computeNuiteeSignature(body, secret, timestamp)).toBe(expected);
    expect(checkNuiteeSignature(input)).toBeNull();
    expect(
      checkNuiteeSignature({ ...input, signature: expected.toUpperCase() }),
    ).toBeNull();
  });

  it("rejects a bad signature, body or secret", () => {
    expect(checkNuiteeSignature({ ...input, signature: "0".repeat(128) })).toBe(
      NUITEE_SIGNATURE_FAILURE.BAD_SIGNATURE,
    );
    expect(checkNuiteeSignature({ ...input, signature: "abc" })).toBe(
      NUITEE_SIGNATURE_FAILURE.BAD_SIGNATURE,
    );
    expect(checkNuiteeSignature({ ...input, rawBody: Buffer.from("{}") })).toBe(
      NUITEE_SIGNATURE_FAILURE.BAD_SIGNATURE,
    );
    expect(checkNuiteeSignature({ ...input, secret: "other" })).toBe(
      NUITEE_SIGNATURE_FAILURE.BAD_SIGNATURE,
    );
  });

  it("rejects missing headers, non-numeric and stale timestamps", () => {
    expect(checkNuiteeSignature({ ...input, timestamp: null })).toBe(
      NUITEE_SIGNATURE_FAILURE.MISSING_HEADERS,
    );
    expect(checkNuiteeSignature({ ...input, signature: undefined })).toBe(
      NUITEE_SIGNATURE_FAILURE.MISSING_HEADERS,
    );
    expect(checkNuiteeSignature({ ...input, timestamp: "16028x" })).toBe(
      NUITEE_SIGNATURE_FAILURE.BAD_TIMESTAMP,
    );
    expect(
      checkNuiteeSignature({ ...input, now: at(1_602_838_959 + 86_401) }),
    ).toBe(NUITEE_SIGNATURE_FAILURE.STALE_TIMESTAMP);
    expect(
      checkNuiteeSignature({ ...input, now: at(1_602_838_959 - 3600) }),
    ).toBe(NUITEE_SIGNATURE_FAILURE.STALE_TIMESTAMP);
  });
});

describe("Nuitee webhook envelope parsing", () => {
  it("decodes the double-encoded request/response strings", () => {
    const payload = {
      event_id: "evt_1",
      event_name: "booking.book",
      sandbox: true,
      request: JSON.stringify({ clientReference: "V4P-1" }),
      response: JSON.stringify({
        bookingId: "BK-1",
        status: "CONFIRMED",
        clientReference: "V4P-1",
      }),
    };
    const raw = Buffer.from(JSON.stringify(payload));

    expect(parseProviderWebhook(payload, raw)).toMatchObject({
      eventId: "evt_1",
      eventName: "booking.book",
      sandbox: true,
      bookingId: "BK-1",
      clientReference: "V4P-1",
      prebookId: null,
      request: { clientReference: "V4P-1" },
      response: { status: "CONFIRMED" },
    });
  });

  it("book_error: request 'null', prebookId and the inner error JSON", () => {
    const payload = {
      event_id: "evt_2",
      event_name: "booking.book_error",
      request: "null",
      response: JSON.stringify({
        response: JSON.stringify({
          error: { code: 4002, message: "sold out" },
        }),
        prebookId: "PB-9",
      }),
    };
    const parsed = parseProviderWebhook(
      payload,
      Buffer.from(JSON.stringify(payload)),
    );

    expect(parsed.request).toBeNull();
    expect(parsed.prebookId).toBe("PB-9");
    expect(parsed.errorDetail).toEqual({
      error: { code: 4002, message: "sold out" },
    });
    expect(parsed.sandbox).toBe(false);
  });

  it("tolerates already-decoded objects and falls back to a body hash", () => {
    expect(decodeEmbeddedJson({ a: 1 })).toEqual({ a: 1 });
    expect(decodeEmbeddedJson("not json")).toBe("not json");
    expect(decodeEmbeddedJson(null)).toBeNull();
    expect(decodeEmbeddedJson("null")).toBeNull();
    const anonymous = Buffer.from(
      '{"event_name":"booking.cancel","request":{"bookingId":"BK-2"}}',
    );
    const parsed = parseProviderWebhook(
      JSON.parse(anonymous.toString()),
      anonymous,
    );
    expect(parsed.eventId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(parsed.bookingId).toBe("BK-2");
  });
});
