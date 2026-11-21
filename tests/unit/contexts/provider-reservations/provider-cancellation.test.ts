import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";

import {
  PROVIDER_PENALTY_SOURCE,
  quoteProviderCancellation,
  readCancellationRecord,
  scaleProviderPenaltyToSell,
  withCancellationRecord,
} from "@/src/contexts/provider-reservations/domain/provider-cancellation";
import {
  parseProviderWebhook,
  PROVIDER_WEBHOOK_KIND,
  verifyHmacSignature,
  webhookKind,
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

describe("Nuitee webhook signature and parsing", () => {
  const secret = "whsec_test";
  const body = Buffer.from(
    JSON.stringify({
      event: "booking.cancelled",
      id: "evt_1",
      data: { bookingId: "BK-1", clientReference: "V4P-1" },
    }),
  );
  const hex = createHmac("sha256", secret).update(body).digest("hex");

  it("accepts hex, sha256= prefixed and base64 HMAC-SHA256", () => {
    expect(verifyHmacSignature(body, hex, secret)).toBe(true);
    expect(verifyHmacSignature(body, `sha256=${hex}`, secret)).toBe(true);
    const b64 = createHmac("sha256", secret).update(body).digest("base64");
    expect(verifyHmacSignature(body, b64, secret)).toBe(true);
  });

  it("rejects a wrong or missing signature", () => {
    expect(verifyHmacSignature(body, hex, "other")).toBe(false);
    expect(verifyHmacSignature(Buffer.from("{}"), hex, secret)).toBe(false);
    expect(verifyHmacSignature(body, null, secret)).toBe(false);
    expect(verifyHmacSignature(body, "abc", secret)).toBe(false);
  });

  it("maps event names loosely", () => {
    expect(webhookKind("booking.cancelled")).toBe(
      PROVIDER_WEBHOOK_KIND.CANCELLED,
    );
    expect(webhookKind("BOOKING_FAILED")).toBe(PROVIDER_WEBHOOK_KIND.FAILED);
    expect(webhookKind("booking.confirmed")).toBe(
      PROVIDER_WEBHOOK_KIND.CONFIRMED,
    );
    expect(webhookKind("booking.updated")).toBe(PROVIDER_WEBHOOK_KIND.UPDATED);
    expect(webhookKind("ping")).toBe(PROVIDER_WEBHOOK_KIND.OTHER);
  });

  it("extracts ids, falling back to a body hash", () => {
    expect(parseProviderWebhook(JSON.parse(body.toString()), body)).toEqual({
      eventId: "evt_1",
      eventType: "booking.cancelled",
      kind: PROVIDER_WEBHOOK_KIND.CANCELLED,
      bookingId: "BK-1",
      clientReference: "V4P-1",
    });
    const anonymous = Buffer.from('{"type":"x","booking_id":"BK-2"}');
    const parsed = parseProviderWebhook(
      JSON.parse(anonymous.toString()),
      anonymous,
    );
    expect(parsed.eventId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(parsed.bookingId).toBe("BK-2");
  });
});
