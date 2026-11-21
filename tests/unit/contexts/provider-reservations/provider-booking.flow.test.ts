import type { EntityManager } from "typeorm";
import type {
  BookResult,
  PrebookResult,
  ProviderRateOffer,
} from "@/src/contexts/providers/domain/provider.types";

import { createEconomics } from "@/tests/utils/economics";
import { FakeReservationDb } from "@/tests/utils/fake-reservation-db";

import { PAYMENT_STATUS } from "@/src/contexts/payments/domain/payment-state-machine";
import { PaymentEntity } from "@/src/contexts/payments/entities/payment.entity";
import { ReservationPriceLineEntity } from "@/src/contexts/payments/entities/reservation-price-line.entity";
import {
  PROVIDER_BOOK_OUTCOME,
  PROVIDER_FAILURE_REASON,
  PROVIDER_QUOTE_STATUS,
} from "@/src/contexts/provider-reservations/domain/provider-reservation.types";
import {
  isProviderCheckoutEvent,
  ProviderBookingService,
} from "@/src/contexts/provider-reservations/services/provider-booking.service";
import { ProviderReservationService } from "@/src/contexts/provider-reservations/services/provider-reservation.service";
import {
  ProviderDuplicateReferenceError,
  ProviderInProgressError,
  ProviderTransientError,
  ProviderUnavailableError,
} from "@/src/contexts/providers/domain/provider.errors";
import { ProviderOfferEntity } from "@/src/contexts/providers/entities/provider-offer.entity";
import { ProviderPropertyEntity } from "@/src/contexts/providers/entities/provider-property.entity";
import { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";
import { ReservationPayoutService } from "@/src/contexts/reservations/services/reservation-payout.service";

const SITE_ID = 42;
const HOTEL_ID = "lp42";
const CHECKIN = "2027-06-10";
const CHECKOUT = "2027-06-12";
const NET_CENTS = 20_000;
// platform default provider_markup_rate = 0.15
const SELL_CENTS = 23_000;
const MARKUP_CENTS = 3000;

function offer(overrides: Partial<ProviderRateOffer> = {}): ProviderRateOffer {
  return {
    offerId: "offer-1",
    hotelId: HOTEL_ID,
    roomName: "Doble estándar",
    boardCode: "RO",
    boardName: "Solo alojamiento",
    netCents: NET_CENTS,
    currency: "EUR",
    refundable: true,
    refundableTag: "RFN",
    cancellationPolicies: [
      {
        deadline: "2027-06-08T22:00:00.000Z",
        amountCents: 10_000,
        currency: "EUR",
        timezone: "Europe/Madrid",
      },
    ],
    taxesNotIncluded: [
      {
        description: "Tasa turística",
        amountCents: 400,
        currency: "EUR",
        included: false,
      },
    ],
    taxesIncluded: [],
    maxOccupancy: 2,
    remarks: null,
    ...overrides,
  };
}

function prebookResult(overrides: Partial<PrebookResult> = {}): PrebookResult {
  return {
    prebookId: "pb-1",
    offerId: "offer-1",
    hotelId: HOTEL_ID,
    offer: offer(),
    priceDifferencePercent: 0,
    cancellationChanged: false,
    boardChanged: false,
    termsAndConditions: null,
    raw: { prebook: true },
    ...overrides,
  };
}

function bookResult(overrides: Partial<BookResult> = {}): BookResult {
  return {
    bookingId: "BK-1",
    clientReference: "V4P-1",
    status: "CONFIRMED",
    rawStatus: "CONFIRMED",
    hotelConfirmationCode: "HC-99",
    supplierBookingId: null,
    hotelId: HOTEL_ID,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    totalCents: NET_CENTS,
    currency: "EUR",
    cancellationPolicies: [],
    raw: { booking: true },
    ...overrides,
  };
}

/** The background book is asserted, not run. */
function skipBackgroundBook(): void {
  // intentionally empty
}

const QUOTE_DTO = {
  site_id: SITE_ID,
  offer_id: "offer-1",
  checkin: CHECKIN,
  checkout: CHECKOUT,
  adults: 2,
  dogs: [{ name: "Toby", weight_kg: 12, is_ppp: false }],
  guest_first_name: "Ana",
  guest_last_name: "García",
  guest_email: "ana@example.com",
  guest_phone: "+34600000000",
};

const createFixture = () => {
  const db = new FakeReservationDb();
  const { economics, settings } = createEconomics(db.store);
  const reservationRepo = db.manager().getRepository(ReservationEntity);
  const reservationRepository = {
    findOne: reservationRepo.findOne.bind(reservationRepo),
    update: reservationRepo.update.bind(reservationRepo),
    manager: {
      transaction: <T>(run: (manager: EntityManager) => Promise<T>) =>
        db.transaction(run),
    },
  };
  const propertyRepository = db.store.repository(ProviderPropertyEntity);
  const offerRepository = db.store.repository(ProviderOfferEntity);
  void propertyRepository.save({
    provider: "nuitee",
    provider_hotel_id: HOTEL_ID,
    site_id: SITE_ID,
    status: "active",
    pets_snapshot: {
      petsAllowed: true,
      petPolicy: { allowed: true, text: "<p>Perros hasta 20 kg</p>" },
    },
    content_snapshot: { timezone: "Europe/Madrid" },
  });

  const provider = {
    name: "nuitee",
    searchRates: vi.fn(),
    prebook: vi.fn<[string], Promise<PrebookResult>>(() =>
      Promise.resolve(prebookResult()),
    ),
    book: vi.fn<[unknown], Promise<BookResult>>(() =>
      Promise.resolve(bookResult()),
    ),
    listBookings: vi.fn<[string], Promise<BookResult[]>>(() =>
      Promise.resolve([]),
    ),
  };
  const registry = { get: () => provider, has: () => true };
  const stripe = {
    createManualCaptureCheckoutSession: vi.fn(() =>
      Promise.resolve({
        sessionId: "cs_1",
        url: "https://checkout.stripe.test/cs_1",
        expiresAt: new Date(Date.now() + 40 * 60_000),
      }),
    ),
    retrieveCheckoutSessionState: vi.fn(() => Promise.resolve(null)),
    retrievePaymentIntentState: vi.fn((id: string) =>
      Promise.resolve({
        id,
        status: "requires_capture",
        amount: SELL_CENTS,
        amountCapturable: SELL_CENTS,
        currency: "eur",
        created: Math.floor(Date.now() / 1000),
      }),
    ),
    capturePaymentIntent: vi.fn(() => Promise.resolve({ status: "succeeded" })),
    cancelPaymentIntent: vi.fn(() => Promise.resolve({ status: "canceled" })),
  };
  const events = {
    logEventInTransaction: vi.fn(() => Promise.resolve()),
    logEvent: vi.fn(() => Promise.resolve()),
  };
  const emails = {
    sendProviderReservationConfirmedEmail: vi.fn(() => Promise.resolve()),
    sendProviderReservationFailedEmail: vi.fn(() => Promise.resolve()),
    sendProviderReservationAdminAlert: vi.fn(() => Promise.resolve()),
  };
  const alternatives = {
    find: vi.fn(() =>
      Promise.resolve([{ name: "Hotel B", url: "https://x/b" }]),
    ),
  };
  const mysql = {
    queryOne: vi.fn(() => Promise.resolve({ id: SITE_ID, name: "Hotel A" })),
    query: vi.fn(() => Promise.resolve([])),
  };

  const reservationService = new ProviderReservationService(
    propertyRepository as never,
    offerRepository as never,
    reservationRepository as never,
    registry as never,
    settings,
    economics,
    stripe as never,
    mysql as never,
  );
  const bookingService = new ProviderBookingService(
    reservationRepository as never,
    offerRepository as never,
    propertyRepository as never,
    registry as never,
    stripe as never,
    economics,
    events as never,
    emails as never,
    alternatives as never,
    mysql as never,
  );

  const reservation = (id = 1) => db.reservations.get(id);
  const payment = (id = 1) =>
    db.store.rows(PaymentEntity).findLast(row => row.reservation_id === id);
  const offerRow = (id = 1) =>
    db.store
      .rows(ProviderOfferEntity)
      .findLast(row => row.reservation_id === id);

  /** quote -> checkout -> checkout.session.completed (authorized). */
  const authorize = async () => {
    const quote = await reservationService.quote(QUOTE_DTO);
    const reservationId = Number(quote.reservation_id);
    await reservationService.checkout({ reservation_id: reservationId });
    await db.transaction(manager =>
      bookingService.recordAuthorization(manager, {
        reservationId,
        checkoutSessionId: "cs_1",
        paymentIntentId: "pi_1",
        eventId: "evt_1",
      }),
    );
    return reservationId;
  };

  return {
    db,
    provider,
    stripe,
    emails,
    reservationService,
    bookingService,
    reservation,
    payment,
    offerRow,
    authorize,
  };
};

describe("ProviderReservationService.quote", () => {
  it("asks to reconfirm a changed prebook without creating anything", async () => {
    const fx = createFixture();
    fx.provider.prebook.mockResolvedValueOnce(
      prebookResult({ priceDifferencePercent: 2.5 }),
    );

    const result = await fx.reservationService.quote(QUOTE_DTO);

    expect(result.status).toBe(PROVIDER_QUOTE_STATUS.REQUIRES_RECONFIRMATION);
    expect(result.changes).toEqual(["price"]);
    expect(result.offer.sell_cents).toBe(SELL_CENTS);
    expect(result.reservation_id).toBeNull();
    expect(fx.db.reservations.size).toBe(0);
  });

  it("creates the pending provider reservation once the price is accepted", async () => {
    const fx = createFixture();
    fx.provider.prebook.mockResolvedValueOnce(
      prebookResult({ priceDifferencePercent: 2.5 }),
    );

    const result = await fx.reservationService.quote({
      ...QUOTE_DTO,
      accepted_price_cents: SELL_CENTS,
    });

    expect(result.status).toBe(PROVIDER_QUOTE_STATUS.OK);
    const row = fx.reservation(Number(result.reservation_id));
    expect(row).toMatchObject({
      source: "nuitee",
      room_id: 0,
      status: "pending",
      payment_status: "pending",
      provider_status: "prebooked",
      client_reference: `V4P-${result.reservation_id}`,
      total_cents: SELL_CENTS,
      commission_cents: MARKUP_CENTS,
      pets: 1,
      guests: 2,
    });
    expect(fx.payment()).toMatchObject({
      status: PAYMENT_STATUS.PENDING_CHARGE,
      amount_cents: SELL_CENTS,
    });
    expect(fx.offerRow()).toMatchObject({
      prebook_id: "pb-1",
      net_cents: NET_CENTS,
      sell_cents: SELL_CENTS,
      markup_cents: MARKUP_CENTS,
    });
    const lines = fx.db.store.rows(ReservationPriceLineEntity);
    expect(lines.map(line => line.amount_cents)).toEqual([SELL_CENTS]);
  });

  it("reconfirms when the accepted price is stale", async () => {
    const fx = createFixture();
    const result = await fx.reservationService.quote({
      ...QUOTE_DTO,
      accepted_price_cents: SELL_CENTS - 100,
    });
    expect(result.status).toBe(PROVIDER_QUOTE_STATUS.REQUIRES_RECONFIRMATION);
    expect(fx.db.reservations.size).toBe(0);
  });

  it("opens a manual-capture checkout for the pending reservation", async () => {
    const fx = createFixture();
    const quote = await fx.reservationService.quote(QUOTE_DTO);

    const checkout = await fx.reservationService.checkout({
      reservation_id: Number(quote.reservation_id),
    });

    expect(checkout.checkout_url).toContain("cs_1");
    expect(fx.stripe.createManualCaptureCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: SELL_CENTS,
        replacedSessionId: null,
      }),
    );
    expect(fx.reservation()?.stripe_checkout_session_id).toBe("cs_1");
  });
});

describe("ProviderBookingService.book", () => {
  it("confirms: captures, marks paid and sends the voucher", async () => {
    const fx = createFixture();
    const id = await fx.authorize();
    expect(fx.payment(id)?.status).toBe(PAYMENT_STATUS.PROCESSING);

    const result = await fx.bookingService.book(id);

    expect(result.outcome).toBe(PROVIDER_BOOK_OUTCOME.CONFIRMED);
    expect(fx.provider.book).toHaveBeenCalledWith(
      expect.objectContaining({
        prebookId: "pb-1",
        clientReference: `V4P-${id}`,
        guests: [
          expect.objectContaining({
            occupancyNumber: 1,
            remarks: "Viajan 1 perro: Toby (12 kg).",
          }),
        ],
      }),
    );
    expect(fx.stripe.capturePaymentIntent).toHaveBeenCalledWith({
      reservationId: id,
      paymentIntentId: "pi_1",
    });
    expect(fx.reservation(id)).toMatchObject({
      status: "confirmed",
      payment_status: "paid",
      provider_status: "confirmed",
      external_reservation_id: "BK-1",
    });
    expect(fx.reservation(id)?.payout_status ?? null).toBeNull();
    expect(fx.payment(id)?.status).toBe(PAYMENT_STATUS.PAID);
    expect(
      fx.emails.sendProviderReservationConfirmedEmail,
    ).toHaveBeenCalledOnce();
  });

  it("is idempotent on re-entry (webhook replay / cron)", async () => {
    const fx = createFixture();
    const id = await fx.authorize();
    await fx.bookingService.book(id);

    const replay = await fx.db.transaction(manager =>
      fx.bookingService.recordAuthorization(manager, {
        reservationId: id,
        checkoutSessionId: "cs_1",
        paymentIntentId: "pi_1",
        eventId: "evt_1",
      }),
    );
    const again = await fx.bookingService.book(id);

    expect(replay.shouldBook).toBe(true);
    expect(again.outcome).toBe(PROVIDER_BOOK_OUTCOME.NOOP);
    expect(fx.provider.book).toHaveBeenCalledOnce();
    expect(fx.stripe.capturePaymentIntent).toHaveBeenCalledOnce();
  });

  it("unavailable: voids the authorization and cancels", async () => {
    const fx = createFixture();
    const id = await fx.authorize();
    fx.provider.book.mockRejectedValueOnce(
      new ProviderUnavailableError({
        provider: "nuitee",
        message: "sold out",
        code: "2013",
      }),
    );

    const result = await fx.bookingService.book(id);

    expect(result).toMatchObject({
      outcome: PROVIDER_BOOK_OUTCOME.FAILED,
      reason: PROVIDER_FAILURE_REASON.UNAVAILABLE,
    });
    expect(fx.stripe.cancelPaymentIntent).toHaveBeenCalledWith({
      reservationId: id,
      paymentIntentId: "pi_1",
    });
    expect(fx.stripe.capturePaymentIntent).not.toHaveBeenCalled();
    expect(fx.reservation(id)).toMatchObject({
      status: "cancelled",
      payment_status: "pending",
      provider_status: "failed",
      cancel_reason: "provider_unavailable",
    });
    expect(fx.payment(id)?.status).toBe(PAYMENT_STATUS.FAILED);
    expect(fx.emails.sendProviderReservationFailedEmail).toHaveBeenCalledOnce();
  });

  it("in progress: stays booking, then resolvePending confirms", async () => {
    const fx = createFixture();
    const id = await fx.authorize();
    fx.provider.book.mockRejectedValueOnce(
      new ProviderInProgressError({
        provider: "nuitee",
        message: "booking in progress",
        code: "409",
      }),
    );

    const first = await fx.bookingService.book(id);

    expect(first.outcome).toBe(PROVIDER_BOOK_OUTCOME.PENDING);
    expect(fx.provider.listBookings).toHaveBeenCalledWith(`V4P-${id}`);
    expect(fx.reservation(id)?.provider_status).toBe("booking");
    expect(fx.stripe.cancelPaymentIntent).not.toHaveBeenCalled();

    fx.provider.listBookings.mockResolvedValueOnce([bookResult()]);
    const resolved = await fx.bookingService.resolvePending(id);

    expect(resolved.outcome).toBe(PROVIDER_BOOK_OUTCOME.CONFIRMED);
    expect(fx.reservation(id)?.status).toBe("confirmed");
  });

  it("timeout (transient): reconciles immediately by clientReference", async () => {
    const fx = createFixture();
    const id = await fx.authorize();
    fx.provider.book.mockRejectedValueOnce(
      new ProviderTransientError({
        provider: "nuitee",
        message: "timeout",
        timedOut: true,
      }),
    );
    fx.provider.listBookings.mockResolvedValueOnce([bookResult()]);

    const result = await fx.bookingService.book(id);

    expect(result.outcome).toBe(PROVIDER_BOOK_OUTCOME.CONFIRMED);
    expect(fx.stripe.capturePaymentIntent).toHaveBeenCalledOnce();
  });

  it("duplicate clientReference: adopts the existing booking", async () => {
    const fx = createFixture();
    const id = await fx.authorize();
    fx.provider.book.mockRejectedValueOnce(
      new ProviderDuplicateReferenceError({
        provider: "nuitee",
        message: "duplicate",
        code: "4005",
      }),
    );
    fx.provider.listBookings.mockResolvedValueOnce([
      bookResult({ bookingId: "BK-EXISTING" }),
    ]);

    const result = await fx.bookingService.book(id);

    expect(result.outcome).toBe(PROVIDER_BOOK_OUTCOME.CONFIRMED);
    expect(fx.reservation(id)?.external_reservation_id).toBe("BK-EXISTING");
  });

  it("unknown outcome with no booking after the window: fails and voids", async () => {
    const fx = createFixture();
    const id = await fx.authorize();
    fx.provider.book.mockRejectedValueOnce(
      new ProviderInProgressError({ provider: "nuitee", message: "409" }),
    );
    await fx.bookingService.book(id);

    const later = new Date(Date.now() + 31 * 60_000);
    const result = await fx.bookingService.resolvePending(id, later);

    expect(result).toMatchObject({
      outcome: PROVIDER_BOOK_OUTCOME.FAILED,
      reason: PROVIDER_FAILURE_REASON.NO_BOOKING_FOUND,
    });
    expect(fx.stripe.cancelPaymentIntent).toHaveBeenCalledOnce();
  });

  it("expired prebook: prebooks the same offer again before booking", async () => {
    const fx = createFixture();
    const id = await fx.authorize();
    const offerRow = fx.offerRow(id);
    if (offerRow) {
      offerRow.expires_at = new Date(Date.now() - 60_000);
    }
    fx.provider.prebook.mockResolvedValueOnce(
      prebookResult({
        prebookId: "pb-2",
        offer: offer({ netCents: NET_CENTS - 500 }),
      }),
    );

    const result = await fx.bookingService.book(id);

    expect(result.outcome).toBe(PROVIDER_BOOK_OUTCOME.CONFIRMED);
    expect(fx.provider.prebook).toHaveBeenLastCalledWith("offer-1");
    expect(fx.provider.book).toHaveBeenCalledWith(
      expect.objectContaining({ prebookId: "pb-2" }),
    );
    expect(fx.offerRow(id)).toMatchObject({
      prebook_id: "pb-2",
      net_cents: NET_CENTS - 500,
      sell_cents: SELL_CENTS,
    });
  });

  it("price increase on re-prebook: fails without booking", async () => {
    const fx = createFixture();
    const id = await fx.authorize();
    const offerRow = fx.offerRow(id);
    if (offerRow) {
      offerRow.expires_at = new Date(Date.now() - 60_000);
    }
    fx.provider.prebook.mockResolvedValueOnce(
      prebookResult({
        prebookId: "pb-2",
        offer: offer({ netCents: NET_CENTS + 1000 }),
      }),
    );

    const result = await fx.bookingService.book(id);

    expect(result).toMatchObject({
      outcome: PROVIDER_BOOK_OUTCOME.FAILED,
      reason: PROVIDER_FAILURE_REASON.PRICE_INCREASED,
    });
    expect(fx.provider.book).not.toHaveBeenCalled();
    expect(fx.stripe.cancelPaymentIntent).toHaveBeenCalledOnce();
    expect(fx.reservation(id)?.provider_status).toBe("failed");
  });

  it("does nothing before the card is authorized", async () => {
    const fx = createFixture();
    const quote = await fx.reservationService.quote(QUOTE_DTO);

    const result = await fx.bookingService.book(Number(quote.reservation_id));

    expect(result).toMatchObject({
      outcome: PROVIDER_BOOK_OUTCOME.NOOP,
      reason: "not_authorized",
    });
    expect(fx.provider.book).not.toHaveBeenCalled();
  });
});

describe("ProviderBookingService.handleCheckoutCompleted", () => {
  it("records the authorization and books after commit (not in the tx)", async () => {
    const fx = createFixture();
    const quote = await fx.reservationService.quote(QUOTE_DTO);
    const id = Number(quote.reservation_id);
    const event = {
      id: "evt_9",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          payment_intent: "pi_1",
          metadata: { reservation_id: String(id), source: "nuitee" },
        },
      },
    };
    const afterCommit: (() => Promise<void>)[] = [];
    const bookSpy = vi
      .spyOn(fx.bookingService, "bookInBackground")
      .mockImplementation(skipBackgroundBook);

    expect(isProviderCheckoutEvent(event)).toBe(true);
    await fx.db.transaction(manager =>
      fx.bookingService.handleCheckoutCompleted(event, manager, afterCommit),
    );

    expect(fx.reservation(id)?.stripe_payment_intent_id).toBe("pi_1");
    expect(fx.payment(id)?.status).toBe(PAYMENT_STATUS.PROCESSING);
    expect(bookSpy).not.toHaveBeenCalled();
    for (const task of afterCommit) {
      await task();
    }
    expect(bookSpy).toHaveBeenCalledWith(id);
  });

  it("voids a second authorization for the same reservation", async () => {
    const fx = createFixture();
    const id = await fx.authorize();
    const afterCommit: (() => Promise<void>)[] = [];

    await fx.db.transaction(manager =>
      fx.bookingService.handleCheckoutCompleted(
        {
          id: "evt_10",
          type: "checkout.session.completed",
          data: {
            object: {
              id: "cs_2",
              payment_intent: "pi_2",
              metadata: { reservation_id: String(id), source: "nuitee" },
            },
          },
        },
        manager,
        afterCommit,
      ),
    );
    for (const task of afterCommit) {
      await task();
    }

    expect(fx.stripe.cancelPaymentIntent).toHaveBeenCalledWith({
      reservationId: id,
      paymentIntentId: "pi_2",
    });
    expect(fx.reservation(id)?.stripe_payment_intent_id).toBe("pi_1");
  });
});

describe("Host payout exclusion", () => {
  it("never releases a payout for a provider reservation", async () => {
    const db = new FakeReservationDb();
    db.seedReservation(
      Object.assign(new ReservationEntity(), {
        id: 9,
        source: "nuitee",
        status: "finalized",
        payment_status: "paid",
        payout_status: "held",
        stripe_payment_intent_id: "pi_9",
      }),
    );
    const stripe = { transferHostPayout: vi.fn() };
    const service = new ReservationPayoutService(
      {
        manager: {
          transaction: <T>(run: (manager: EntityManager) => Promise<T>) =>
            db.transaction(run),
        },
      } as never,
      {} as never,
      stripe as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.releaseHostPayout(9);

    expect(result).toMatchObject({
      released: false,
      reason: "provider_reservation",
    });
    expect(stripe.transferHostPayout).not.toHaveBeenCalled();
  });
});
