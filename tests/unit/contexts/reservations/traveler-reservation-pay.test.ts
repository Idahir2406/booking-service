import type { EntityManager } from "typeorm";

import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  NotFoundException,
} from "@nestjs/common";

import { createEconomics } from "@/tests/utils/economics";
import { FakeReservationDb } from "@/tests/utils/fake-reservation-db";
import { pricedQuote } from "@/tests/utils/quote";

import { actors } from "@/src/contexts/payments/domain/audit-actor";
import { PaymentEntity } from "@/src/contexts/payments/entities/payment.entity";
import { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";
import { ReservationService } from "@/src/contexts/reservations/services/reservation.service";
import {
  isStripeCheckoutUrl,
  TravelerReservationPayService,
} from "@/src/contexts/reservations/services/traveler-reservation-pay.service";
import { signTravelerToken } from "@/src/contexts/reservations/utils/traveler-token.util";
import { envs } from "@/src/contexts/shared/configs/envs";
import { StripeService } from "@/src/contexts/stripe/services/stripe.service";
import { ReservationWebhookService } from "@/src/contexts/webhook/services/reservation-webhook.service";

const SITE_ID = 42;
const ROOM_ID = 3;
const TRAVELER = 77;
const CHECKIN = "2099-05-10";
const CHECKOUT = "2099-05-12";
const NIGHTS = ["2099-05-10", "2099-05-11"];
const HOUR_MS = 60 * 60 * 1000;

interface SessionCreateParams {
  line_items: unknown[];
  expires_at: number;
  metadata: Record<string, string>;
  payment_intent_data: {
    metadata: Record<string, string>;
    transfer_group: string;
  };
  success_url: string;
  cancel_url: string;
}

type SessionCreateCall = [SessionCreateParams, { idempotencyKey: string }];

const createFixture = () => {
  const db = new FakeReservationDb();
  db.seedNights(SITE_ID, ROOM_ID, NIGHTS, true);
  const { economics } = createEconomics(db.store);

  const reservationRepository = {
    manager: {
      transaction: <T>(run: (manager: EntityManager) => Promise<T>) =>
        db.transaction(run),
    },
    findOne: (options: { where: Record<string, unknown> }) =>
      db.manager().getRepository(ReservationEntity).findOne(options),
    update: (criteria: { id: number }, patch: Partial<ReservationEntity>) =>
      db.manager().getRepository(ReservationEntity).update(criteria, patch as never),
  };

  let sessionSeq = 0;
  const sessions = {
    create: vi.fn(() => {
      sessionSeq += 1;
      return Promise.resolve({
        id: `cs_${sessionSeq}`,
        url: `https://checkout.stripe.com/c/pay/cs_${sessionSeq}`,
      });
    }),
    retrieve: vi.fn(),
    expire: vi.fn().mockResolvedValue({}),
  };
  const mysqlService = {
    queryOne: vi
      .fn()
      .mockResolvedValue({ id: SITE_ID, user_id: 5, name: "Casa Perruna" }),
  };
  const stripeService = new StripeService(
    mysqlService as never,
    {} as never,
    {} as never,
  );
  Object.assign(stripeService, {
    stripe: {
      checkout: { sessions },
      customers: { list: vi.fn().mockResolvedValue({ data: [{ id: "cus_1" }] }) },
    },
  });

  const reservationEventService = {
    logEventInTransaction: vi.fn(() => Promise.resolve()),
  };
  const blocksService = { find_blocking_overlap: vi.fn().mockResolvedValue(null) };
  const reservationService = new ReservationService(
    reservationRepository as never,
    mysqlService as never,
    {} as never,
    blocksService as never,
    {
      findOne: vi.fn().mockResolvedValue({
        id: ROOM_ID,
        name: "Suite Perruna",
        max_guests: 2,
        max_pets: 2,
        price_per_night: "100.00",
        is_active: true,
      }),
    } as never,
    {} as never,
    {} as never,
    stripeService,
    reservationEventService as never,
    economics,
    {} as never,
    {} as never,
  );
  Object.assign(stripeService, { reservationService });
  vi.spyOn(reservationService, "quoteReservation").mockResolvedValue(
    pricedQuote(),
  );

  const payService = new TravelerReservationPayService(
    reservationService,
    stripeService,
  );
  const webhookService = new ReservationWebhookService(
    reservationService,
    {} as never,
    reservationEventService as never,
    economics,
  );

  /** Pending reservation created by the real checkout (session cs_1). */
  const checkout = async (expiresInMs = 2 * HOUR_MS) => {
    const result = await reservationService.checkout({
      site_id: SITE_ID,
      room_id: ROOM_ID,
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guests: 2,
      pets: 1,
      board_option_id: 5,
      guest_name: "Ana",
      guest_email: "ana@example.com",
      traveler_token: signTravelerToken(
        TRAVELER,
        Math.floor(Date.now() / 1000) + 3600,
        envs.INTERNAL_API_KEY,
      ),
    } as never);
    const row = db.reservations.get(result.reservation_id);
    if (!row) {
      throw new Error("checkout did not store the reservation");
    }
    row.expiration_date = new Date(Date.now() + expiresInMs);
    return row;
  };

  const sessionState = (id: string, status: string, expiresInMs = HOUR_MS) => ({
    id,
    status,
    url: `https://checkout.stripe.com/c/pay/${id}`,
    expires_at: Math.floor((Date.now() + expiresInMs) / 1000),
  });

  const expiredEvent = (sessionId: string, reservationId: number) => ({
    id: `evt_${sessionId}`,
    type: "checkout.session.expired",
    data: {
      object: {
        id: sessionId,
        payment_status: "unpaid",
        metadata: { reservation_id: String(reservationId) },
      },
    },
  });

  return {
    db,
    sessions,
    blocksService,
    reservationService,
    payService,
    webhookService,
    checkout,
    sessionState,
    expiredEvent,
  };
};

const expectCode = async (
  promise: Promise<unknown>,
  type: typeof ConflictException | typeof GoneException,
  code: string,
) => {
  const error: unknown = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(type);
  expect((error as HttpException).getResponse()).toMatchObject({ code });
};

describe("isStripeCheckoutUrl", () => {
  it("accepts only https URLs on stripe.com", () => {
    expect(isStripeCheckoutUrl("https://checkout.stripe.com/c/pay/cs_1")).toBe(
      true,
    );
    expect(isStripeCheckoutUrl("http://checkout.stripe.com/c/pay/cs_1")).toBe(
      false,
    );
    expect(isStripeCheckoutUrl("https://stripe.com.evil.test/x")).toBe(false);
    expect(isStripeCheckoutUrl("https://evilstripe.com/x")).toBe(false);
    expect(isStripeCheckoutUrl("javascript:alert(1)")).toBe(false);
    expect(isStripeCheckoutUrl(null)).toBe(false);
  });
});

describe("TravelerReservationPayService (Pagar reserva)", () => {
  it("reuses the Checkout Session while it is still open", async () => {
    const f = createFixture();
    const reservation = await f.checkout();
    f.sessions.retrieve.mockResolvedValue(f.sessionState("cs_1", "open"));

    const result = await f.payService.payForTraveler(TRAVELER, reservation.id);

    expect(result).toMatchObject({
      reservation_id: reservation.id,
      checkout_url: "https://checkout.stripe.com/c/pay/cs_1",
      reused: true,
    });
    expect(f.sessions.retrieve).toHaveBeenCalledWith("cs_1");
    expect(f.sessions.create).toHaveBeenCalledTimes(1); // only the checkout
    expect(f.db.reservations.get(reservation.id)?.stripe_checkout_session_id).toBe(
      "cs_1",
    );
  });

  it("creates a new session for the SAME reservation with the same frozen amounts when the old one expired", async () => {
    const f = createFixture();
    const reservation = await f.checkout();
    const before = { ...f.db.reservations.get(reservation.id) };
    f.sessions.retrieve.mockResolvedValue(f.sessionState("cs_1", "expired", -1));

    const result = await f.payService.payForTraveler(TRAVELER, reservation.id);

    expect(result).toMatchObject({
      checkout_url: "https://checkout.stripe.com/c/pay/cs_2",
      reused: false,
    });
    const calls = f.sessions.create.mock.calls as unknown as SessionCreateCall[];
    expect(calls).toHaveLength(2);
    const [original, originalOptions] = calls[0];
    const [replacement, replacementOptions] = calls[1];
    // Same line items, metadata, transfer group and return URLs: no repricing.
    expect(replacement.line_items).toEqual(original.line_items);
    expect(replacement.payment_intent_data).toEqual(
      original.payment_intent_data,
    );
    expect(replacement.metadata).toEqual(original.metadata);
    expect(replacement.success_url).toBe(original.success_url);
    expect(replacement.cancel_url).toBe(original.cancel_url);
    expect(replacement.payment_intent_data.metadata.total_cents).toBe(
      String(before.total_cents),
    );
    expect(originalOptions.idempotencyKey).toBe(`checkout:${reservation.id}`);
    expect(replacementOptions.idempotencyKey).toBe(
      `checkout:${reservation.id}:retry:cs_1`,
    );
    // Never beyond the reservation expiration (not extended).
    const expirationMs = new Date(before.expiration_date as Date).getTime();
    expect(replacement.expires_at * 1000).toBeLessThanOrEqual(expirationMs);
    expect(new Date(result.expires_at).getTime()).toBeLessThanOrEqual(
      expirationMs,
    );

    const after = f.db.reservations.get(reservation.id);
    expect(after?.stripe_checkout_session_id).toBe("cs_2");
    expect(after?.status).toBe("pending");
    expect(after?.total_cents).toBe(before.total_cents);
    expect(after?.commission_cents).toBe(before.commission_cents);
    expect(new Date(after?.expiration_date as Date).getTime()).toBe(
      expirationMs,
    );
    const payments = f.db.store.rows(PaymentEntity);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      stripe_checkout_session_id: "cs_2",
      amount_cents: before.total_cents,
      status: "pending_charge",
    });
  });

  it("creates a new session when Stripe no longer knows the old one", async () => {
    const f = createFixture();
    const reservation = await f.checkout();
    f.sessions.retrieve.mockRejectedValue(
      Object.assign(new Error("No such checkout.session"), {
        code: "resource_missing",
      }),
    );

    const result = await f.payService.payForTraveler(TRAVELER, reservation.id);

    expect(result.reused).toBe(false);
    expect(f.db.reservations.get(reservation.id)?.stripe_checkout_session_id).toBe(
      "cs_2",
    );
  });

  it("enforces ownership (403) and existence (404)", async () => {
    const f = createFixture();
    const reservation = await f.checkout();

    await expect(
      f.payService.payForTraveler(TRAVELER + 1, reservation.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      f.payService.payForTraveler(TRAVELER, 9999),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(f.sessions.retrieve).not.toHaveBeenCalled();
  });

  it("rejects paid (409 already_paid), expired holds (410 expired) and other states (409)", async () => {
    const f = createFixture();
    const reservation = await f.checkout();
    const row = f.db.reservations.get(reservation.id);
    if (!row) {
      throw new Error("missing row");
    }

    row.expiration_date = new Date(Date.now() - 1000);
    await expectCode(
      f.payService.payForTraveler(TRAVELER, reservation.id),
      GoneException,
      "expired",
    );

    row.status = "cancelled";
    row.cancel_reason = "expired";
    await expectCode(
      f.payService.payForTraveler(TRAVELER, reservation.id),
      GoneException,
      "expired",
    );

    row.cancel_reason = "host_cancelled";
    await expectCode(
      f.payService.payForTraveler(TRAVELER, reservation.id),
      ConflictException,
      "not_payable",
    );

    row.status = "confirmed";
    row.payment_status = "paid";
    await expectCode(
      f.payService.payForTraveler(TRAVELER, reservation.id),
      ConflictException,
      "already_paid",
    );
    expect(f.sessions.create).toHaveBeenCalledTimes(1);
  });

  it("returns 410 instead of a session when less than Stripe's 30 min remain", async () => {
    const f = createFixture();
    const reservation = await f.checkout(20 * 60 * 1000);
    f.sessions.retrieve.mockResolvedValue(f.sessionState("cs_1", "expired", -1));

    await expectCode(
      f.payService.payForTraveler(TRAVELER, reservation.id),
      GoneException,
      "expired",
    );
    expect(f.sessions.create).toHaveBeenCalledTimes(1);
  });

  it("returns 409 unavailable when the dates were taken (no hold in immediate checkout)", async () => {
    const f = createFixture();
    const reservation = await f.checkout();
    f.db.seedReservation(
      Object.assign(new ReservationEntity(), {
        site_id: SITE_ID,
        room_id: ROOM_ID,
        checkin: CHECKIN,
        checkout: CHECKOUT,
        status: "confirmed",
        payment_status: "paid",
      }),
    );

    await expectCode(
      f.payService.payForTraveler(TRAVELER, reservation.id),
      ConflictException,
      "unavailable",
    );
    expect(f.sessions.retrieve).not.toHaveBeenCalled();
  });

  it("returns 409 unavailable when the host blocked the dates", async () => {
    const f = createFixture();
    const reservation = await f.checkout();
    f.blocksService.find_blocking_overlap.mockResolvedValueOnce({
      type: "host",
      start_date: CHECKIN,
      end_date: CHECKOUT,
    });

    await expectCode(
      f.payService.payForTraveler(TRAVELER, reservation.id),
      ConflictException,
      "unavailable",
    );
  });

  it("returns 409 payment_processing when the current session is complete", async () => {
    const f = createFixture();
    const reservation = await f.checkout();
    f.sessions.retrieve.mockResolvedValue(f.sessionState("cs_1", "complete"));

    await expectCode(
      f.payService.payForTraveler(TRAVELER, reservation.id),
      ConflictException,
      "payment_processing",
    );
    expect(f.sessions.create).toHaveBeenCalledTimes(1);
  });

  it("loses the compare-and-set to a concurrent change: 409 and the new session is expired", async () => {
    const f = createFixture();
    const reservation = await f.checkout();
    f.sessions.retrieve.mockResolvedValue(f.sessionState("cs_1", "expired", -1));
    f.sessions.create.mockImplementationOnce(() => {
      const row = f.db.reservations.get(reservation.id);
      if (row) {
        row.stripe_checkout_session_id = "cs_other";
      }
      return Promise.resolve({
        id: "cs_lost",
        url: "https://checkout.stripe.com/c/pay/cs_lost",
      });
    });

    await expectCode(
      f.payService.payForTraveler(TRAVELER, reservation.id),
      ConflictException,
      "session_conflict",
    );
    expect(f.sessions.expire).toHaveBeenCalledWith("cs_lost");
    expect(f.db.reservations.get(reservation.id)?.stripe_checkout_session_id).toBe(
      "cs_other",
    );
  });

  it("never hands out a non-Stripe checkout url", async () => {
    const f = createFixture();
    const reservation = await f.checkout();
    f.sessions.retrieve.mockResolvedValue({
      ...f.sessionState("cs_1", "open"),
      url: "https://evil.test/pay",
    });

    await expect(
      f.payService.payForTraveler(TRAVELER, reservation.id),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(f.sessions.create).toHaveBeenCalledTimes(1);
  });
});

describe("checkout.session.expired with a replaced session", () => {
  it("the old session's expiry does not cancel the reservation; the current one does", async () => {
    const f = createFixture();
    const reservation = await f.checkout();
    f.sessions.retrieve.mockResolvedValue(f.sessionState("cs_1", "expired", -1));
    await f.payService.payForTraveler(TRAVELER, reservation.id);

    await f.db.transaction(manager =>
      f.webhookService.handleCheckoutExpired(
        f.expiredEvent("cs_1", reservation.id),
        manager,
      ),
    );
    expect(f.db.reservations.get(reservation.id)?.status).toBe("pending");

    await f.db.transaction(manager =>
      f.webhookService.handleCheckoutExpired(
        f.expiredEvent("cs_2", reservation.id),
        manager,
      ),
    );
    expect(f.db.reservations.get(reservation.id)).toMatchObject({
      status: "cancelled",
      cancel_reason: "checkout_session_expired",
    });
  });

  it("the guard is re-checked under the row lock (session swapped after the pre-check)", async () => {
    const f = createFixture();
    const reservation = await f.checkout();
    const row = f.db.reservations.get(reservation.id);
    if (row) {
      row.stripe_checkout_session_id = "cs_new";
    }

    const expired = await f.reservationService.expirePendingReservation(
      reservation.id,
      "checkout_session_expired",
      undefined,
      actors.stripe("evt_old"),
      { onlyIfSessionId: "cs_1" },
    );

    expect(expired).toBe(false);
    expect(f.db.reservations.get(reservation.id)?.status).toBe("pending");
  });

  it("the cron (no session filter) still expires it", async () => {
    const f = createFixture();
    const reservation = await f.checkout();

    const expired = await f.reservationService.expirePendingReservation(
      reservation.id,
      "expired",
    );

    expect(expired).toBe(true);
    expect(f.db.reservations.get(reservation.id)?.status).toBe("cancelled");
  });
});
