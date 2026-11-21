/**
 * Payloads shaped like LiteAPI v3.0 responses (trimmed). Kept as TS modules
 * (not .json) so they type-check and need no JSON module resolution.
 */

export const RATES_RESPONSE = {
  data: [
    {
      hotelId: "lp1897",
      roomTypes: [
        {
          roomTypeId: "rt-1",
          offerId: "OFFER-RFN-ABC",
          supplier: "nuitee",
          supplierId: 2,
          rates: [
            {
              rateId: "rate-1",
              occupancyNumber: 1,
              name: "Double Room",
              maxOccupancy: 2,
              adultCount: 2,
              childCount: 0,
              boardType: "BB",
              boardName: "Bed & Breakfast",
              remarks: "Pets on request",
              priceType: "commission",
              retailRate: {
                total: [{ amount: 240.555, currency: "EUR" }],
                taxesAndFees: [
                  {
                    included: true,
                    description: "VAT",
                    amount: 21.86,
                    currency: "EUR",
                  },
                  {
                    included: false,
                    description: "City tax",
                    amount: "4.40",
                    currency: "eur",
                  },
                ],
              },
              cancellationPolicies: {
                cancelPolicyInfos: [
                  {
                    cancelTime: "2026-12-10 12:00:00",
                    amount: 120.27,
                    currency: "EUR",
                    type: "amount",
                    timezone: "GMT",
                  },
                  {
                    cancelTime: "2026-12-01 00:00:00",
                    amount: 0,
                    currency: "EUR",
                    type: "amount",
                    timezone: "GMT",
                  },
                  {
                    cancelTime: "2026-12-14 00:00:00",
                    amount: 240.55,
                    currency: "EUR",
                    type: "amount",
                    timezone: "GMT",
                  },
                ],
                hotelRemarks: [],
                refundableTag: "RFN",
              },
            },
          ],
          offerRetailRate: { amount: 240.55, currency: "EUR" },
          suggestedSellingPrice: { amount: 280, currency: "EUR" },
        },
        {
          roomTypeId: "rt-2",
          offerId: "OFFER-NRFN-XYZ",
          rates: [
            {
              rateId: "rate-2",
              name: "Twin Room",
              boardType: "RO",
              boardName: "Room Only",
              retailRate: {
                total: [{ amount: 190, currency: "EUR" }],
              },
              cancellationPolicies: {
                cancelPolicyInfos: [],
                refundableTag: "NRFN",
              },
            },
          ],
          // offerRetailRate missing: falls back to rates[].retailRate.total
        },
        {
          // No offerId: skipped
          roomTypeId: "rt-3",
          rates: [],
        },
      ],
    },
  ],
};

export const PREBOOK_RESPONSE = {
  data: {
    prebookId: "PB-123",
    offerId: "OFFER-RFN-ABC",
    hotelId: "lp1897",
    currency: "EUR",
    termsAndConditions: "Hotel T&C",
    roomTypes: [
      {
        rates: [
          {
            rateId: "rate-1",
            name: "Double Room",
            boardType: "BB",
            boardName: "Bed & Breakfast",
            retailRate: {
              total: [{ amount: 245.1, currency: "EUR" }],
              taxesAndFees: [
                {
                  included: false,
                  description: "City tax",
                  amount: 4.4,
                  currency: "EUR",
                },
              ],
            },
            cancellationPolicies: {
              cancelPolicyInfos: [
                {
                  cancelTime: "2026-12-10 12:00:00",
                  amount: 122.55,
                  currency: "EUR",
                  timezone: "Europe/Madrid",
                },
              ],
              refundableTag: "RFN",
            },
          },
        ],
      },
    ],
    price: 245.1,
    suggestedSellingPrice: 290,
    priceDifferencePercent: 1.89,
    cancellationChanged: true,
    boardChanged: false,
    supplier: "nuitee",
  },
};

export const BOOK_RESPONSE = {
  data: {
    bookingId: "BK-999",
    clientReference: "V4P-42",
    supplierBookingId: "SUP-1",
    status: "CONFIRMED",
    hotelConfirmationCode: "HCC-777",
    checkin: "2026-12-15",
    checkout: "2026-12-17",
    hotel: { hotelId: "lp1897", name: "Hotel Perruno" },
    bookedRooms: [
      {
        roomType: { name: "Double Room" },
        boardType: "BB",
        rate: {
          retailRate: { total: { amount: 245.1, currency: "EUR" } },
          cancellationPolicies: {
            cancelPolicyInfos: [
              {
                cancelTime: "2026-12-10 12:00:00",
                amount: 122.55,
                currency: "EUR",
                timezone: "GMT",
              },
            ],
            refundableTag: "RFN",
          },
        },
      },
    ],
    price: 245.1,
    currency: "EUR",
  },
};

export const BOOKING_LIST_RESPONSE = {
  data: [
    { bookingId: "BK-1", clientReference: "V4P-42", status: "CANCELLED" },
    { bookingId: "BK-2", clientReference: "V4P-42", status: "PENDING" },
    { clientReference: "V4P-42", status: "CONFIRMED" },
  ],
};

export const CANCEL_RESPONSE = {
  data: {
    bookingId: "BK-999",
    status: "CANCELLED_WITH_CHARGES",
    cancellation_fee: 122.55,
    refund_amount: 122.55,
    currency: "EUR",
  },
};

export const HOTEL_RESPONSE = {
  data: {
    id: "lp1897",
    name: "Hotel Perruno",
    hotelDescription: "<p>Dog friendly hotel</p>",
    hotelImportantInformation: "Late check-in on request",
    checkinCheckoutTimes: { checkin: "15:00", checkout: "11:00" },
    hotelImages: [
      { url: "https://img/2.jpg", urlHd: "https://img/2hd.jpg", order: 2 },
      { url: "https://img/1.jpg", caption: "Lobby", order: 1 },
      {
        url: "https://img/main.jpg",
        urlHd: "https://img/mainhd.jpg",
        order: 9,
        defaultImage: true,
      },
      { caption: "no url" },
    ],
    country: "es",
    city: "Madrid",
    address: "Calle Mayor 1",
    zip: "28013",
    starRating: 4,
    location: { latitude: 40.4168, longitude: -3.7038 },
    petsAllowed: true,
    policyAttributes: {
      pets: {
        allowed: true,
        fee: true,
        feeAmount: 15,
        feeCurrency: "eur",
        feeBasis: "per_night",
        weightLimit: "20 kg",
        terms: "Max 1 dog",
      },
    },
    policies: [
      {
        policy_type: "general",
        name: "Pets",
        description: "Pets are allowed on request. Charges may apply.",
        pets_allowed: "Y",
      },
    ],
    timezone: "Europe/Madrid",
  },
};

/** Text-only pets info, no structured attributes, no flag. */
export const HOTEL_TEXT_ONLY_PETS = {
  data: {
    id: "lp2000",
    name: "Hostal Texto",
    main_photo: "https://img/only.jpg",
    latitude: "41.38",
    longitude: "2.17",
    policies: [
      { name: "Children", description: "Children welcome", pets_allowed: "" },
      {
        name: "Pets",
        description: "Dogs up to 10 kg allowed",
        pets_allowed: "N",
      },
    ],
  },
};

export const HOTELS_SEARCH_RESPONSE = {
  data: [
    {
      id: "lp1",
      name: "Hotel A",
      country: "es",
      city: "Madrid",
      address: "A 1",
      latitude: 40.1,
      longitude: -3.1,
      stars: 3,
      main_photo: "https://img/a.jpg",
    },
    { name: "No id" },
  ],
  total: 120,
};
