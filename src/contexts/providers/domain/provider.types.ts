/**
 * Provider-agnostic domain models for external accommodation providers
 * (Nuitee/LiteAPI today, HyperGuest later). Infrastructure mappers translate
 * each provider's payloads into these shapes; the rest of booking only knows
 * these types. Money is always INTEGER CENTS (see payments/utils/money.util)
 * in the currency stated next to it. Missing provider fields map to null.
 */

export const PROVIDER_NAME = {
  NUITEE: "nuitee",
} as const;

export type ProviderName = (typeof PROVIDER_NAME)[keyof typeof PROVIDER_NAME];

export const PROVIDER_BOOKING_STATUS = {
  CONFIRMED: "CONFIRMED",
  CANCELLED: "CANCELLED",
  /** Anything else (pending, on request, unknown): reconcile with getBooking. */
  PENDING_UNKNOWN: "PENDING_UNKNOWN",
} as const;

export type ProviderBookingStatus =
  (typeof PROVIDER_BOOKING_STATUS)[keyof typeof PROVIDER_BOOKING_STATUS];

export const PROVIDER_CANCEL_STATUS = {
  CANCELLED: "CANCELLED",
  CANCELLED_WITH_CHARGES: "CANCELLED_WITH_CHARGES",
  PENDING_UNKNOWN: "PENDING_UNKNOWN",
} as const;

export type ProviderCancelStatus =
  (typeof PROVIDER_CANCEL_STATUS)[keyof typeof PROVIDER_CANCEL_STATUS];

export const PROVIDER_PAYMENT_METHOD = {
  ACC_CREDIT_CARD: "ACC_CREDIT_CARD",
  CREDIT: "CREDIT",
  WALLET: "WALLET",
} as const;

export type ProviderPaymentMethod =
  (typeof PROVIDER_PAYMENT_METHOD)[keyof typeof PROVIDER_PAYMENT_METHOD];

// --- Hotel content ----------------------------------------------------------

export interface ProviderAddress {
  line: string | null;
  city: string | null;
  postalCode: string | null;
  /** ISO 3166-1 alpha-2, upper case. */
  countryCode: string | null;
}

export interface ProviderImage {
  url: string;
  urlHd: string | null;
  caption: string | null;
  order: number | null;
  isDefault: boolean;
}

export interface ProviderPetPolicy {
  /** null = the provider does not say. */
  allowed: boolean | null;
  /** true = pets are charged, false = free, null = unknown. */
  fee: boolean | null;
  feeAmountCents: number | null;
  feeCurrency: string | null;
  /** Free text from the provider ("per_night", "per_stay", "per pet"...). */
  feeBasis: string | null;
  weightLimit: string | null;
  terms: string | null;
  /** Human-readable pet policy text (raw, may contain HTML). */
  text: string | null;
}

export interface ProviderHotel {
  id: string;
  name: string;
  address: ProviderAddress;
  latitude: number | null;
  longitude: number | null;
  starRating: number | null;
  /** Top-level provider flag (Nuitee `petsAllowed`), null when absent. */
  petsAllowed: boolean | null;
  petPolicy: ProviderPetPolicy;
  /** Default image first, then by `order`. */
  images: ProviderImage[];
  /** Raw description (may contain HTML). */
  description: string | null;
  importantInformation: string | null;
  /** Local "HH:MM" as given by the provider. */
  checkinTime: string | null;
  checkoutTime: string | null;
  /** Valid IANA timezone or null. */
  timezone: string | null;
}

export interface ProviderHotelSummary {
  id: string;
  name: string;
  address: ProviderAddress;
  latitude: number | null;
  longitude: number | null;
  starRating: number | null;
  /** Nuitee `petsAllowed` when the list returns it (often absent -> null). */
  petsAllowed: boolean | null;
  mainPhotoUrl: string | null;
}

export interface ProviderHotelSearchQuery {
  countryCode?: string;
  cityName?: string;
  latitude?: number;
  longitude?: number;
  /** Meters. */
  radius?: number;
  limit?: number;
  offset?: number;
}

export interface ProviderHotelSearchResult {
  hotels: ProviderHotelSummary[];
  total: number | null;
}

// --- Rates --------------------------------------------------------------------

export interface ProviderOccupancy {
  adults: number;
  childrenAges: number[];
}

export interface ProviderRateQuery {
  hotelIds: string[];
  /** YYYY-MM-DD */
  checkin: string;
  /** YYYY-MM-DD */
  checkout: string;
  occupancies: ProviderOccupancy[];
  /** Defaults to NUITEE_CURRENCY. */
  currency?: string;
  /** Defaults to NUITEE_GUEST_NATIONALITY. */
  guestNationality?: string;
  /** Provider-side search timeout (seconds). */
  timeoutSeconds?: number;
}

export interface ProviderCancellationPolicy {
  /** UTC ISO instant from which `amountCents` is charged. */
  deadline: string;
  amountCents: number;
  currency: string | null;
  /** Timezone the provider expressed the deadline in (raw). */
  timezone: string | null;
}

export interface ProviderTax {
  description: string | null;
  amountCents: number | null;
  currency: string | null;
  included: boolean;
}

export interface ProviderRateOffer {
  offerId: string;
  hotelId: string | null;
  roomName: string | null;
  boardCode: string | null;
  boardName: string | null;
  /** Net amount (margin 0) of the whole offer, every room. */
  netCents: number | null;
  currency: string | null;
  refundable: boolean;
  /** Raw refundable tag ("RFN" | "NRFN" | null). */
  refundableTag: string | null;
  /** Sorted by deadline ASC; zero-amount nodes are kept. */
  cancellationPolicies: ProviderCancellationPolicy[];
  /** Paid at the property (city tax, resort fee...). */
  taxesNotIncluded: ProviderTax[];
  taxesIncluded: ProviderTax[];
  maxOccupancy: number | null;
  remarks: string | null;
}

export interface ProviderHotelRates {
  hotelId: string;
  offers: ProviderRateOffer[];
}

// --- Prebook / book / cancel ----------------------------------------------------

export interface PrebookResult {
  prebookId: string;
  offerId: string | null;
  hotelId: string | null;
  offer: ProviderRateOffer;
  /** Price change vs the searched offer (0 = unchanged). */
  priceDifferencePercent: number;
  cancellationChanged: boolean;
  boardChanged: boolean;
  termsAndConditions: string | null;
  raw: unknown;
}

export interface ProviderBookingHolder {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
}

export interface ProviderBookingGuest {
  /** 1-based index of the occupancy (room) this guest belongs to. */
  occupancyNumber: number;
  firstName: string;
  lastName: string;
  email: string;
  /** Free text to the hotel (dogs). Not guaranteed to be honored. */
  remarks?: string | null;
}

export interface ProviderBookInput {
  prebookId: string;
  /** Our idempotency reference (V4P-<reservationId>). */
  clientReference: string;
  holder: ProviderBookingHolder;
  guests: ProviderBookingGuest[];
  /** Defaults to NUITEE_PAYMENT_METHOD. */
  paymentMethod?: ProviderPaymentMethod;
}

export interface BookResult {
  bookingId: string;
  clientReference: string | null;
  status: ProviderBookingStatus;
  /** Provider status verbatim. */
  rawStatus: string | null;
  hotelConfirmationCode: string | null;
  supplierBookingId: string | null;
  hotelId: string | null;
  checkin: string | null;
  checkout: string | null;
  totalCents: number | null;
  currency: string | null;
  cancellationPolicies: ProviderCancellationPolicy[];
  raw: unknown;
}

export interface CancelResult {
  bookingId: string | null;
  status: ProviderCancelStatus;
  rawStatus: string | null;
  penaltyCents: number | null;
  refundCents: number | null;
  currency: string | null;
  raw: unknown;
}
