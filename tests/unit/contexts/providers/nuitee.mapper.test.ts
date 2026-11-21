import { describe, expect, it } from "vitest";

import {
  cancelTimeToUtcIso,
  mapBookingListResponse,
  mapBookingResponse,
  mapCancelResponse,
  mapHotelResponse,
  mapHotelSearchResponse,
  mapPrebookResponse,
  mapRatesResponse,
  moneyToCents,
  NuiteeMappingError,
} from "@/contexts/providers/infrastructure/nuitee/nuitee.mapper";

import {
  BOOK_RESPONSE,
  BOOKING_LIST_RESPONSE,
  CANCEL_RESPONSE,
  HOTEL_RESPONSE,
  HOTEL_TEXT_ONLY_PETS,
  HOTELS_SEARCH_RESPONSE,
  PREBOOK_RESPONSE,
  RATES_RESPONSE,
} from "./fixtures/nuitee.fixtures";

describe("nuitee.mapper · helpers", () => {
  it("moneyToCents is tolerant", () => {
    expect(moneyToCents(240.55)).toBe(24_055);
    expect(moneyToCents("4.40")).toBe(440);
    expect(moneyToCents(1.005)).toBe(101);
    expect(moneyToCents(null)).toBeNull();
    expect(moneyToCents("abc")).toBeNull();
    expect(moneyToCents({ amount: 1 })).toBeNull();
  });

  it("cancelTimeToUtcIso handles GMT, IANA (DST) and ISO with offset", () => {
    expect(cancelTimeToUtcIso("2026-12-10 12:00:00", "GMT")).toBe(
      "2026-12-10T12:00:00.000Z",
    );
    expect(cancelTimeToUtcIso("2026-12-10 12:00:00", null)).toBe(
      "2026-12-10T12:00:00.000Z",
    );
    // Madrid winter (UTC+1) and summer (UTC+2)
    expect(cancelTimeToUtcIso("2026-12-10 12:00:00", "Europe/Madrid")).toBe(
      "2026-12-10T11:00:00.000Z",
    );
    expect(cancelTimeToUtcIso("2026-07-10 12:00:00", "Europe/Madrid")).toBe(
      "2026-07-10T10:00:00.000Z",
    );
    expect(cancelTimeToUtcIso("2026-12-10T12:00:00+02:00", "GMT")).toBe(
      "2026-12-10T10:00:00.000Z",
    );
    // Unknown zone -> treated as UTC
    expect(cancelTimeToUtcIso("2026-12-10 12:00", "Mars/Base")).toBe(
      "2026-12-10T12:00:00.000Z",
    );
    expect(cancelTimeToUtcIso("garbage", "GMT")).toBeNull();
    expect(cancelTimeToUtcIso(undefined, "GMT")).toBeNull();
  });
});

describe("nuitee.mapper · rates", () => {
  const [hotel] = mapRatesResponse(RATES_RESPONSE);

  it("maps one offer per roomType with offerId", () => {
    expect(hotel.hotelId).toBe("lp1897");
    expect(hotel.offers.map(offer => offer.offerId)).toEqual([
      "OFFER-RFN-ABC",
      "OFFER-NRFN-XYZ",
    ]);
  });

  it("refundable offer: net, board, sorted cancellation, split taxes", () => {
    const offer = hotel.offers[0];
    expect(offer).toMatchObject({
      hotelId: "lp1897",
      roomName: "Double Room",
      boardCode: "BB",
      boardName: "Bed & Breakfast",
      netCents: 24_055,
      currency: "EUR",
      refundable: true,
      refundableTag: "RFN",
      maxOccupancy: 2,
      remarks: "Pets on request",
    });
    expect(offer.cancellationPolicies).toEqual([
      {
        deadline: "2026-12-01T00:00:00.000Z",
        amountCents: 0,
        currency: "EUR",
        timezone: "GMT",
      },
      {
        deadline: "2026-12-10T12:00:00.000Z",
        amountCents: 12_027,
        currency: "EUR",
        timezone: "GMT",
      },
      {
        deadline: "2026-12-14T00:00:00.000Z",
        amountCents: 24_055,
        currency: "EUR",
        timezone: "GMT",
      },
    ]);
    expect(offer.taxesIncluded).toEqual([
      {
        description: "VAT",
        amountCents: 2186,
        currency: "EUR",
        included: true,
      },
    ]);
    expect(offer.taxesNotIncluded).toEqual([
      {
        description: "City tax",
        amountCents: 440,
        currency: "EUR",
        included: false,
      },
    ]);
  });

  it("NRFN offer without offerRetailRate falls back to rate totals", () => {
    const offer = hotel.offers[1];
    expect(offer.refundable).toBe(false);
    expect(offer.refundableTag).toBe("NRFN");
    expect(offer.netCents).toBe(19_000);
    expect(offer.cancellationPolicies).toEqual([]);
    expect(offer.taxesNotIncluded).toEqual([]);
  });

  it("empty / malformed payloads", () => {
    expect(mapRatesResponse({ data: [] })).toEqual([]);
    expect(mapRatesResponse(null)).toEqual([]);
    expect(mapRatesResponse({ data: [{ roomTypes: [] }] })).toEqual([]);
  });

  it("multi-room offers sum policies per deadline", () => {
    const [multi] = mapRatesResponse({
      data: [
        {
          hotelId: "h",
          roomTypes: [
            {
              offerId: "O",
              rates: [1, 2].map(n => ({
                name: n === 1 ? "Double" : "Single",
                retailRate: { total: [{ amount: 100, currency: "EUR" }] },
                cancellationPolicies: {
                  cancelPolicyInfos: [
                    {
                      cancelTime: "2026-12-10 00:00:00",
                      amount: 50,
                      currency: "EUR",
                      timezone: "GMT",
                    },
                  ],
                  refundableTag: n === 1 ? "RFN" : "NRFN",
                },
              })),
            },
          ],
        },
      ],
    });
    const offer = multi.offers[0];
    expect(offer.roomName).toBe("Double + Single");
    expect(offer.netCents).toBe(20_000);
    expect(offer.refundable).toBe(false);
    expect(offer.cancellationPolicies).toEqual([
      {
        deadline: "2026-12-10T00:00:00.000Z",
        amountCents: 10_000,
        currency: "EUR",
        timezone: "GMT",
      },
    ]);
  });
});

describe("nuitee.mapper · prebook / book / cancel", () => {
  it("prebook: price change flags, net from price, IANA deadline", () => {
    const result = mapPrebookResponse(PREBOOK_RESPONSE);
    expect(result).toMatchObject({
      prebookId: "PB-123",
      offerId: "OFFER-RFN-ABC",
      hotelId: "lp1897",
      priceDifferencePercent: 1.89,
      cancellationChanged: true,
      boardChanged: false,
      termsAndConditions: "Hotel T&C",
    });
    expect(result.offer.offerId).toBe("OFFER-RFN-ABC");
    expect(result.offer.netCents).toBe(24_510);
    expect(result.offer.currency).toBe("EUR");
    expect(result.offer.refundable).toBe(true);
    expect(result.offer.cancellationPolicies).toEqual([
      {
        deadline: "2026-12-10T11:00:00.000Z",
        amountCents: 12_255,
        currency: "EUR",
        timezone: "Europe/Madrid",
      },
    ]);
    expect(result.offer.taxesNotIncluded[0]?.amountCents).toBe(440);
    expect(result.raw).toBe(PREBOOK_RESPONSE);
  });

  it("prebook without prebookId throws a mapping error", () => {
    expect(() => mapPrebookResponse({ data: {} })).toThrow(NuiteeMappingError);
  });

  it("book: confirmed with hotel confirmation code", () => {
    const result = mapBookingResponse(BOOK_RESPONSE);
    expect(result).toMatchObject({
      bookingId: "BK-999",
      clientReference: "V4P-42",
      status: "CONFIRMED",
      rawStatus: "CONFIRMED",
      hotelConfirmationCode: "HCC-777",
      supplierBookingId: "SUP-1",
      hotelId: "lp1897",
      checkin: "2026-12-15",
      checkout: "2026-12-17",
      totalCents: 24_510,
      currency: "EUR",
    });
    expect(result.cancellationPolicies).toEqual([
      {
        deadline: "2026-12-10T12:00:00.000Z",
        amountCents: 12_255,
        currency: "EUR",
        timezone: "GMT",
      },
    ]);
  });

  it("book: unknown status -> PENDING_UNKNOWN, missing bookingId throws", () => {
    expect(
      mapBookingResponse({ data: { bookingId: "B", status: "ON_REQUEST" } })
        .status,
    ).toBe("PENDING_UNKNOWN");
    expect(() => mapBookingResponse({ data: { status: "CONFIRMED" } })).toThrow(
      NuiteeMappingError,
    );
  });

  it("listBookings skips rows without bookingId", () => {
    const list = mapBookingListResponse(BOOKING_LIST_RESPONSE);
    expect(list.map(row => [row.bookingId, row.status])).toEqual([
      ["BK-1", "CANCELLED"],
      ["BK-2", "PENDING_UNKNOWN"],
    ]);
  });

  it("cancel: penalty and refund in cents", () => {
    expect(mapCancelResponse(CANCEL_RESPONSE)).toMatchObject({
      bookingId: "BK-999",
      status: "CANCELLED_WITH_CHARGES",
      penaltyCents: 12_255,
      refundCents: 12_255,
      currency: "EUR",
    });
    expect(mapCancelResponse({ data: { status: "CANCELLED" } })).toMatchObject({
      status: "CANCELLED",
      penaltyCents: null,
      refundCents: null,
    });
  });
});

describe("nuitee.mapper · hotel content", () => {
  it("hotel details: address, images, structured pets, timezone", () => {
    const hotel = mapHotelResponse(HOTEL_RESPONSE);
    expect(hotel).toMatchObject({
      id: "lp1897",
      name: "Hotel Perruno",
      address: {
        line: "Calle Mayor 1",
        city: "Madrid",
        postalCode: "28013",
        countryCode: "ES",
      },
      latitude: 40.4168,
      longitude: -3.7038,
      starRating: 4,
      petsAllowed: true,
      description: "<p>Dog friendly hotel</p>",
      importantInformation: "Late check-in on request",
      checkinTime: "15:00",
      checkoutTime: "11:00",
      timezone: "Europe/Madrid",
    });
    expect(hotel.images.map(image => image.url)).toEqual([
      "https://img/main.jpg",
      "https://img/1.jpg",
      "https://img/2.jpg",
    ]);
    expect(hotel.images[0]).toEqual({
      url: "https://img/main.jpg",
      urlHd: "https://img/mainhd.jpg",
      caption: null,
      order: 9,
      isDefault: true,
    });
    expect(hotel.petPolicy).toEqual({
      allowed: true,
      fee: true,
      feeAmountCents: 1500,
      feeCurrency: "EUR",
      feeBasis: "per_night",
      weightLimit: "20 kg",
      terms: "Max 1 dog",
      text: "Pets are allowed on request. Charges may apply.",
    });
  });

  it("hotel with only text pets policy and main_photo", () => {
    const hotel = mapHotelResponse(HOTEL_TEXT_ONLY_PETS);
    expect(hotel.petsAllowed).toBeNull();
    expect(hotel.petPolicy).toEqual({
      allowed: false,
      fee: null,
      feeAmountCents: null,
      feeCurrency: null,
      feeBasis: null,
      weightLimit: null,
      terms: null,
      text: "Dogs up to 10 kg allowed",
    });
    expect(hotel.images).toEqual([
      {
        url: "https://img/only.jpg",
        urlHd: null,
        caption: null,
        order: null,
        isDefault: true,
      },
    ]);
    expect(hotel.latitude).toBe(41.38);
    expect(hotel.longitude).toBe(2.17);
    expect(hotel.timezone).toBeNull();
    expect(hotel.description).toBeNull();
  });

  it("hotel without id throws", () => {
    expect(() => mapHotelResponse({ data: { name: "x" } })).toThrow(
      NuiteeMappingError,
    );
  });

  it("hotel search list", () => {
    const result = mapHotelSearchResponse(HOTELS_SEARCH_RESPONSE);
    expect(result.total).toBe(120);
    expect(result.hotels).toEqual([
      {
        id: "lp1",
        name: "Hotel A",
        address: {
          line: "A 1",
          city: "Madrid",
          postalCode: null,
          countryCode: "ES",
        },
        latitude: 40.1,
        longitude: -3.1,
        starRating: 3,
        petsAllowed: null,
        mainPhotoUrl: "https://img/a.jpg",
      },
    ]);
  });
});
