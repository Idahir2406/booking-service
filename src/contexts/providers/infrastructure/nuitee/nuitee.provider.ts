import type { AccommodationProvider } from "../../domain/accommodation-provider.port";

import { Injectable } from "@nestjs/common";

import {
  type BookResult,
  type CancelResult,
  type PrebookResult,
  PROVIDER_NAME,
  type ProviderBookInput,
  type ProviderHotel,
  type ProviderHotelRates,
  type ProviderHotelSearchQuery,
  type ProviderHotelSearchResult,
  type ProviderRateQuery,
} from "../../domain/provider.types";
import { NUITEE_API, NuiteeClient } from "./nuitee.client";
import { toProviderError } from "./nuitee.errors";
import {
  mapBookingListResponse,
  mapBookingResponse,
  mapCancelResponse,
  mapHotelResponse,
  mapHotelSearchResponse,
  mapPrebookResponse,
  mapRatesResponse,
} from "./nuitee.mapper";

/** Provider-side rate search timeout (seconds) sent in the body. */
const DEFAULT_RATES_PROVIDER_TIMEOUT_S = 6;

/** LiteAPI v3.0 adapter of the AccommodationProvider port. */
@Injectable()
export class NuiteeProvider implements AccommodationProvider {
  readonly name = PROVIDER_NAME.NUITEE;

  constructor(private readonly client: NuiteeClient) {}

  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  searchHotels(
    query: ProviderHotelSearchQuery,
  ): Promise<ProviderHotelSearchResult> {
    return this.call("searchHotels", async () =>
      mapHotelSearchResponse(
        await this.client.request({
          api: NUITEE_API.DATA,
          method: "GET",
          path: "/data/hotels",
          query: {
            countryCode: query.countryCode,
            cityName: query.cityName,
            latitude: query.latitude,
            longitude: query.longitude,
            radius: query.radius,
            limit: query.limit,
            offset: query.offset,
          },
        }),
      ),
    );
  }

  getHotel(hotelId: string): Promise<ProviderHotel> {
    return this.call("getHotel", async () =>
      mapHotelResponse(
        await this.client.request({
          api: NUITEE_API.DATA,
          method: "GET",
          path: "/data/hotel",
          query: { hotelId },
        }),
      ),
    );
  }

  searchRates(query: ProviderRateQuery): Promise<ProviderHotelRates[]> {
    const settings = this.client.settings;
    return this.call("searchRates", async () =>
      mapRatesResponse(
        await this.client.request({
          api: NUITEE_API.DATA,
          method: "POST",
          path: "/hotels/rates",
          timeoutMs: settings.ratesTimeoutMs,
          body: {
            hotelIds: query.hotelIds,
            checkin: query.checkin,
            checkout: query.checkout,
            currency: query.currency ?? settings.currency,
            guestNationality:
              query.guestNationality ?? settings.guestNationality,
            occupancies: query.occupancies.map(occupancy => ({
              adults: occupancy.adults,
              children: occupancy.childrenAges,
            })),
            // Always the NET rate: the V4P markup is applied on our side.
            margin: 0,
            timeout: query.timeoutSeconds ?? DEFAULT_RATES_PROVIDER_TIMEOUT_S,
          },
        }),
      ),
    );
  }

  prebook(offerId: string): Promise<PrebookResult> {
    return this.call("prebook", async () =>
      mapPrebookResponse(
        await this.client.request({
          api: NUITEE_API.BOOK,
          method: "POST",
          path: "/rates/prebook",
          body: { offerId, usePaymentSdk: false },
        }),
      ),
    );
  }

  book(input: ProviderBookInput): Promise<BookResult> {
    const settings = this.client.settings;
    return this.call("book", async () =>
      mapBookingResponse(
        await this.client.request({
          api: NUITEE_API.BOOK,
          method: "POST",
          path: "/rates/book",
          body: {
            prebookId: input.prebookId,
            clientReference: input.clientReference,
            holder: {
              firstName: input.holder.firstName,
              lastName: input.holder.lastName,
              email: input.holder.email,
              ...(input.holder.phone ? { phone: input.holder.phone } : {}),
            },
            guests: input.guests.map(guest => ({
              occupancyNumber: guest.occupancyNumber,
              firstName: guest.firstName,
              lastName: guest.lastName,
              email: guest.email,
              ...(guest.remarks ? { remarks: guest.remarks } : {}),
            })),
            payment: { method: input.paymentMethod ?? settings.paymentMethod },
          },
        }),
      ),
    );
  }

  getBooking(bookingId: string): Promise<BookResult> {
    return this.call("getBooking", async () =>
      mapBookingResponse(
        await this.client.request({
          api: NUITEE_API.BOOK,
          method: "GET",
          path: `/bookings/${encodeURIComponent(bookingId)}`,
        }),
      ),
    );
  }

  listBookings(clientReference: string): Promise<BookResult[]> {
    return this.call("listBookings", async () =>
      mapBookingListResponse(
        await this.client.request({
          api: NUITEE_API.BOOK,
          method: "GET",
          path: "/bookings",
          query: { clientReference },
        }),
      ),
    );
  }

  cancel(bookingId: string): Promise<CancelResult> {
    return this.call("cancel", async () =>
      mapCancelResponse(
        await this.client.request({
          api: NUITEE_API.BOOK,
          method: "PUT",
          path: `/bookings/${encodeURIComponent(bookingId)}`,
        }),
      ),
    );
  }

  private async call<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw toProviderError(error, `nuitee.${operation}`);
    }
  }
}
