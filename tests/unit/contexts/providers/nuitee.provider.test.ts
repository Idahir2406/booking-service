import { describe, expect, it, vi } from "vitest";

import {
  ProviderDuplicateReferenceError,
  ProviderError,
  ProviderInProgressError,
  ProviderNotConfiguredError,
  ProviderNotFoundError,
  ProviderOfferExpiredError,
  ProviderTransientError,
  ProviderUnavailableError,
} from "@/contexts/providers/domain/provider.errors";
import {
  type FetchLike,
  NuiteeClient,
  type NuiteeConfig,
  NuiteeHttpError,
  NuiteeNetworkError,
  NuiteeNotConfiguredError,
} from "@/contexts/providers/infrastructure/nuitee/nuitee.client";
import { toProviderError } from "@/contexts/providers/infrastructure/nuitee/nuitee.errors";
import { NuiteeProvider } from "@/contexts/providers/infrastructure/nuitee/nuitee.provider";

import { BOOK_RESPONSE, RATES_RESPONSE } from "./fixtures/nuitee.fixtures";

const CONFIG: NuiteeConfig = {
  apiKey: "test-key",
  apiBaseUrl: "https://api.example.test/v3.0",
  bookBaseUrl: "https://book.example.test/v3.0/",
  paymentMethod: "ACC_CREDIT_CARD",
  guestNationality: "ES",
  currency: "EUR",
  ratesTimeoutMs: 8000,
  requestTimeoutMs: 30_000,
  retryBackoffMs: 0,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fakeFetch(...responses: (() => Response | Promise<Response>)[]) {
  const queue = [...responses];
  return vi.fn<FetchLike>(async () => {
    const next = queue.shift();
    if (!next) {
      throw new Error("unexpected fetch");
    }
    return next();
  });
}

describe("NuiteeClient", () => {
  it("sends X-API-Key, JSON body and drops empty query params", async () => {
    const fetchMock = fakeFetch(() => jsonResponse(200, { data: [] }));
    const client = new NuiteeClient(CONFIG, fetchMock);
    await client.request({
      api: "book",
      method: "GET",
      path: "/bookings",
      query: { clientReference: "V4P-1", empty: "", missing: undefined },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://book.example.test/v3.0/bookings?clientReference=V4P-1",
    );
    expect(init?.headers).toMatchObject({
      "X-API-Key": "test-key",
      Accept: "application/json",
    });
  });

  it("retries 503 with the same payload (max 2) then succeeds", async () => {
    const fetchMock = fakeFetch(
      () => jsonResponse(503, { error: { code: 503 } }),
      () => jsonResponse(503, { error: { code: 503 } }),
      () => jsonResponse(200, { data: { ok: true } }),
    );
    const client = new NuiteeClient(CONFIG, fetchMock);
    const body = { offerId: "X", usePaymentSdk: false };
    await expect(
      client.request({
        api: "book",
        method: "POST",
        path: "/rates/prebook",
        body,
      }),
    ).resolves.toEqual({ data: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const payloads = fetchMock.mock.calls.map(
      ([, init]): unknown => init?.body,
    );
    expect(new Set(payloads)).toEqual(new Set([JSON.stringify(body)]));
  });

  it("gives up after 2 retries on 503 and never retries other statuses", async () => {
    const always503 = fakeFetch(
      () => jsonResponse(503, {}),
      () => jsonResponse(503, {}),
      () => jsonResponse(503, {}),
    );
    await expect(
      new NuiteeClient(CONFIG, always503).request({
        api: "data",
        method: "GET",
        path: "/data/hotel",
      }),
    ).rejects.toBeInstanceOf(NuiteeHttpError);
    expect(always503).toHaveBeenCalledTimes(3);

    const once500 = fakeFetch(() => jsonResponse(500, {}));
    await expect(
      new NuiteeClient(CONFIG, once500).request({
        api: "data",
        method: "GET",
        path: "/data/hotel",
      }),
    ).rejects.toMatchObject({ status: 500 });
    expect(once500).toHaveBeenCalledTimes(1);
  });

  it("aborts on timeout -> NuiteeNetworkError(timedOut)", async () => {
    const hanging = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    const client = new NuiteeClient(CONFIG, hanging);
    const error = await client
      .request({
        api: "data",
        method: "POST",
        path: "/hotels/rates",
        body: {},
        timeoutMs: 10,
      })
      .catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(NuiteeNetworkError);
    expect((error as NuiteeNetworkError).timedOut).toBe(true);
    expect(hanging).toHaveBeenCalledTimes(1);
  });

  it("without API key fails before calling fetch", async () => {
    const fetchMock = fakeFetch();
    const client = new NuiteeClient({ ...CONFIG, apiKey: null }, fetchMock);
    expect(client.isConfigured()).toBe(false);
    await expect(
      client.request({ api: "data", method: "GET", path: "/data/hotel" }),
    ).rejects.toBeInstanceOf(NuiteeNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function http(status: number, body: unknown) {
  return toProviderError(new NuiteeHttpError(status, body, "/x"), "op");
}

describe("toProviderError", () => {
  it("maps LiteAPI codes and statuses to typed errors", () => {
    expect(
      http(400, {
        error: { code: 4005, message: "duplicate clientReference" },
      }),
    ).toBeInstanceOf(ProviderDuplicateReferenceError);
    expect(
      http(409, { error: { code: 409, message: "Booking in progress" } }),
    ).toBeInstanceOf(ProviderInProgressError);
    expect(http(409, { error: { message: "Room sold out" } })).toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(http(408, { error: { message: "offer timeout" } })).toBeInstanceOf(
      ProviderOfferExpiredError,
    );
    expect(
      http(400, { error: { code: 4002, message: "Prebook expired" } }),
    ).toBeInstanceOf(ProviderOfferExpiredError);
    expect(http(503, {})).toBeInstanceOf(ProviderTransientError);
    expect(
      http(400, { error: { code: 2013, message: "booking failed" } }),
    ).toBeInstanceOf(ProviderUnavailableError);
    expect(http(400, { error: { code: "2014" } })).toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(http(404, { error: { message: "not found" } })).toBeInstanceOf(
      ProviderNotFoundError,
    );

    const generic = http(401, { error: { code: 401, message: "invalid key" } });
    expect(generic.constructor).toBe(ProviderError);
    expect(generic).toMatchObject({
      code: "401",
      httpStatus: 401,
      provider: "nuitee",
    });
  });

  it("maps network/timeout and not-configured", () => {
    const timeout = toProviderError(
      new NuiteeNetworkError("t", true, "/x"),
      "op",
    );
    expect(timeout).toBeInstanceOf(ProviderTransientError);
    expect((timeout as ProviderTransientError).timedOut).toBe(true);
    expect(
      toProviderError(new NuiteeNotConfiguredError(), "op"),
    ).toBeInstanceOf(ProviderNotConfiguredError);
  });
});

describe("NuiteeProvider", () => {
  it("searchRates always asks for the net rate (margin 0) with defaults", async () => {
    const fetchMock = fakeFetch(() => jsonResponse(200, RATES_RESPONSE));
    const provider = new NuiteeProvider(new NuiteeClient(CONFIG, fetchMock));
    const result = await provider.searchRates({
      hotelIds: ["lp1897"],
      checkin: "2026-12-15",
      checkout: "2026-12-17",
      occupancies: [{ adults: 2, childrenAges: [5] }],
    });
    expect(result[0]?.offers).toHaveLength(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/v3.0/hotels/rates");
    expect(JSON.parse(String(init?.body))).toEqual({
      hotelIds: ["lp1897"],
      checkin: "2026-12-15",
      checkout: "2026-12-17",
      currency: "EUR",
      guestNationality: "ES",
      occupancies: [{ adults: 2, children: [5] }],
      margin: 0,
      timeout: 6,
    });
  });

  it("book sends clientReference and the configured payment method", async () => {
    const fetchMock = fakeFetch(() => jsonResponse(200, BOOK_RESPONSE));
    const provider = new NuiteeProvider(new NuiteeClient(CONFIG, fetchMock));
    const result = await provider.book({
      prebookId: "PB-123",
      clientReference: "V4P-42",
      holder: {
        firstName: "Ana",
        lastName: "Pérez",
        email: "ana@example.test",
      },
      guests: [
        {
          occupancyNumber: 1,
          firstName: "Ana",
          lastName: "Pérez",
          email: "ana@example.test",
          remarks: "1 dog, 12 kg",
        },
      ],
    });
    expect(result.status).toBe("CONFIRMED");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://book.example.test/v3.0/rates/book");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      prebookId: "PB-123",
      clientReference: "V4P-42",
      payment: { method: "ACC_CREDIT_CARD" },
      guests: [{ occupancyNumber: 1, remarks: "1 dog, 12 kg" }],
    });
  });

  it("wraps HTTP failures in typed provider errors", async () => {
    const fetchMock = fakeFetch(() =>
      jsonResponse(400, { error: { code: 4005, message: "duplicate" } }),
    );
    const provider = new NuiteeProvider(new NuiteeClient(CONFIG, fetchMock));
    await expect(
      provider.book({
        prebookId: "P",
        clientReference: "V4P-1",
        holder: { firstName: "a", lastName: "b", email: "c@d.test" },
        guests: [],
      }),
    ).rejects.toBeInstanceOf(ProviderDuplicateReferenceError);
  });

  it("cancel uses PUT /bookings/{id}", async () => {
    const fetchMock = fakeFetch(() =>
      jsonResponse(200, {
        data: { bookingId: "B/1", status: "CANCELLED", refund_amount: 10 },
      }),
    );
    const provider = new NuiteeProvider(new NuiteeClient(CONFIG, fetchMock));
    const result = await provider.cancel("B/1");
    expect(result.refundCents).toBe(1000);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://book.example.test/v3.0/bookings/B%2F1");
    expect(init?.method).toBe("PUT");
  });
});
