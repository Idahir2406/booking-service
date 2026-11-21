import type {
  BookResult,
  CancelResult,
  PrebookResult,
  ProviderBookInput,
  ProviderHotel,
  ProviderHotelRates,
  ProviderHotelSearchQuery,
  ProviderHotelSearchResult,
  ProviderName,
  ProviderRateQuery,
} from "./provider.types";

/** Injection token: the default provider (Nuitee in phase 1). */
export const ACCOMMODATION_PROVIDER = Symbol("ACCOMMODATION_PROVIDER");

/**
 * Port for external accommodation providers. Implementations throw the typed
 * errors of ./provider.errors, never raw HTTP errors.
 */
export interface AccommodationProvider {
  readonly name: ProviderName;

  /** Content search (admin import): by city/country or coordinates. */
  searchHotels(
    query: ProviderHotelSearchQuery,
  ): Promise<ProviderHotelSearchResult>;

  /** Full hotel content (description, images, pets). */
  getHotel(hotelId: string): Promise<ProviderHotel>;

  /** Live net rates (margin 0). Hotels without availability are omitted. */
  searchRates(query: ProviderRateQuery): Promise<ProviderHotelRates[]>;

  /** Locks an offer; check priceDifferencePercent / *Changed before booking. */
  prebook(offerId: string): Promise<PrebookResult>;

  book(input: ProviderBookInput): Promise<BookResult>;

  getBooking(bookingId: string): Promise<BookResult>;

  /** Bookings created with our clientReference (reconciliation). */
  listBookings(clientReference: string): Promise<BookResult[]>;

  cancel(bookingId: string): Promise<CancelResult>;
}
