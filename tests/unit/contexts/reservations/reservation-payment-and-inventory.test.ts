import { ConflictException } from "@nestjs/common";

import { createEconomicsStub } from "@/tests/utils/economics";
import { FakeReservationDb } from "@/tests/utils/fake-reservation-db";

import { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";
import {
  AUTO_REFUND_REASON,
  PAYMENT_ACTIVATION_OUTCOME,
  ReservationService,
} from "@/src/contexts/reservations/services/reservation.service";

const SITE_ID = 42;
const ROOM_ID = 3;
const NIGHTS = ["2026-08-10", "2026-08-11"];
const CHECKIN = "2026-08-10";
const CHECKOUT = "2026-08-12";

const buildReservation = (
  overrides: Partial<ReservationEntity> = {},
): ReservationEntity =>
  Object.assign(new ReservationEntity(), {
    site_id: SITE_ID,
    room_id: ROOM_ID,
    source: "internal",
    user_id: 0,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    guests: 2,
    pets: 1,
    subtotal: 200,
    commission: 0,
    total: 200,
    status: "pending",
    payment_status: "pending",
    refund_seq: 0,
    expiration_date: new Date(Date.now() + 30 * 60 * 1000),
    ...overrides,
  });

const createService = (db: FakeReservationDb) => {
  const stripeService = {
    refundPaymentIntent: vi
      .fn()
      .mockImplementation((input: { sequence: number }) =>
        Promise.resolve({ id: `re_${input.sequence}` }),
      ),
  };
  const reservationEventService = {
    logEventInTransaction: vi.fn(() => Promise.resolve()),
  };
  const blocksService = {
    find_blocking_overlap: vi.fn().mockResolvedValue(null),
  };
  const roomsService = {
    findOneForSite: vi.fn().mockResolvedValue({ id: ROOM_ID, is_active: true }),
  };
  const mysqlService = {
    queryOne: vi.fn().mockResolvedValue({ id: SITE_ID, user_id: 5 }),
  };
  const reservationRepository = {
    manager: {
      transaction: <T>(
        run: (manager: ReturnType<FakeReservationDb["manager"]>) => Promise<T>,
      ) => db.transaction(run),
    },
  };

  const service = new ReservationService(
    reservationRepository as never,
    mysqlService as never,
    {} as never,
    blocksService as never,
    roomsService as never,
    {} as never,
    {} as never,
    stripeService as never,
    reservationEventService as never,
    createEconomicsStub() as never,
    {} as never,
    {} as never,
  );
  return { service, stripeService, reservationEventService };
};

const paymentInput = (reservationId: number, amountPaidCents = 20_000) => ({
  reservationId,
  checkoutSessionId: "cs_test_1",
  paymentIntentId: "pi_test_1",
  amountPaidCents,
});

describe("payment received after the pending hold expired", () => {
  it("reactivates the reservation when the dates are still free", async () => {
    const db = new FakeReservationDb();
    db.seedNights(SITE_ID, ROOM_ID, NIGHTS, true); // released on expiry
    const expired = db.seedReservation(
      buildReservation({
        id: 10,
        status: "cancelled",
        cancel_reason: "expired",
        expiration_date: new Date(Date.now() - 60_000),
      }),
    );
    const { service, stripeService, reservationEventService } =
      createService(db);

    const result = await db.transaction(manager =>
      service.activateFromPayment(paymentInput(expired.id), manager),
    );

    expect(result.outcome).toBe(PAYMENT_ACTIVATION_OUTCOME.REACTIVATED);
    expect(db.reservations.get(10)).toMatchObject({
      status: "confirmed",
      payment_status: "paid",
      payout_status: "held",
      stripe_payment_intent_id: "pi_test_1",
      cancel_reason: null,
    });
    expect(db.availability.every(row => !row.is_available)).toBe(true);
    expect(stripeService.refundPaymentIntent).not.toHaveBeenCalled();
    expect(reservationEventService.logEventInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      10,
      "reactivated_after_expiry",
      expect.any(Object),
    );
  });

  it("refunds in full (idempotency seq 1) when the dates were taken, and a replay does not refund twice", async () => {
    const db = new FakeReservationDb();
    db.seedNights(SITE_ID, ROOM_ID, NIGHTS, false); // taken by someone else
    db.seedReservation(
      buildReservation({
        id: 11,
        status: "confirmed",
        payment_status: "paid",
        stripe_payment_intent_id: "pi_other",
      }),
    );
    const expired = db.seedReservation(
      buildReservation({
        id: 12,
        status: "cancelled",
        cancel_reason: "expired",
        expiration_date: new Date(Date.now() - 60_000),
      }),
    );
    const { service, stripeService, reservationEventService } =
      createService(db);

    const first = await db.transaction(manager =>
      service.activateFromPayment(paymentInput(expired.id), manager),
    );

    expect(first.outcome).toBe(PAYMENT_ACTIVATION_OUTCOME.REFUNDED);
    expect(first.refundReason).toBe(AUTO_REFUND_REASON.DATES_UNAVAILABLE);
    expect(stripeService.refundPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: 12,
        sequence: 1,
        paymentIntentId: "pi_test_1",
      }),
    );
    expect(db.reservations.get(12)).toMatchObject({
      status: "cancelled",
      payment_status: "refunded",
      refund_seq: 1,
      stripe_refund_id: "re_1",
      amount_refunded: 200,
    });
    expect(reservationEventService.logEventInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      12,
      "payment_auto_refunded",
      expect.objectContaining({ reason: AUTO_REFUND_REASON.DATES_UNAVAILABLE }),
    );

    const replay = await db.transaction(manager =>
      service.activateFromPayment(paymentInput(expired.id), manager),
    );
    expect(replay.outcome).toBe(PAYMENT_ACTIVATION_OUTCOME.ALREADY_ACTIVE);
    expect(stripeService.refundPaymentIntent).toHaveBeenCalledOnce();
  });

  it("rolls back the refund bookkeeping if the transaction fails, so the retry reuses the same idempotency key", async () => {
    const db = new FakeReservationDb();
    db.seedNights(SITE_ID, ROOM_ID, NIGHTS, false);
    db.seedReservation(
      buildReservation({
        id: 13,
        status: "cancelled",
        cancel_reason: "expired",
      }),
    );
    const { service, stripeService } = createService(db);

    await expect(
      db.transaction(async manager => {
        await service.activateFromPayment(paymentInput(13), manager);
        throw new Error("commit failed");
      }),
    ).rejects.toThrow("commit failed");
    expect(db.reservations.get(13)?.refund_seq).toBe(0);

    await db.transaction(manager =>
      service.activateFromPayment(paymentInput(13), manager),
    );

    const sequences = stripeService.refundPaymentIntent.mock.calls.map(
      ([input]) => (input as { sequence: number }).sequence,
    );
    expect(sequences).toEqual([1, 1]);
  });

  it("refunds when the paid amount does not match (no inventory was held)", async () => {
    const db = new FakeReservationDb();
    db.seedNights(SITE_ID, ROOM_ID, NIGHTS, true);
    db.seedReservation(buildReservation({ id: 14, charge_mode: "immediate" }));
    const { service } = createService(db);

    const result = await db.transaction(manager =>
      service.activateFromPayment(paymentInput(14, 100), manager),
    );

    expect(result.outcome).toBe(PAYMENT_ACTIVATION_OUTCOME.REFUNDED);
    expect(result.refundReason).toBe(AUTO_REFUND_REASON.AMOUNT_MISMATCH);
    expect(db.reservations.get(14)?.status).toBe("cancelled");
    expect(db.availability.every(row => row.is_available)).toBe(true);
  });

  it("confirms a pending immediate reservation and blocks inventory on payment", async () => {
    const db = new FakeReservationDb();
    db.seedNights(SITE_ID, ROOM_ID, NIGHTS, true);
    db.seedReservation(buildReservation({ id: 15, charge_mode: "immediate" }));
    const { service, stripeService } = createService(db);

    const result = await db.transaction(manager =>
      service.activateFromPayment(paymentInput(15), manager),
    );

    expect(result.outcome).toBe(PAYMENT_ACTIVATION_OUTCOME.ACTIVATED);
    expect(db.reservations.get(15)?.status).toBe("confirmed");
    expect(db.availability.every(row => !row.is_available)).toBe(true);
    expect(stripeService.refundPaymentIntent).not.toHaveBeenCalled();
  });

  it("keeps a legacy pending hold and confirms it when nobody else took the nights", async () => {
    const db = new FakeReservationDb();
    db.seedNights(SITE_ID, ROOM_ID, NIGHTS, false);
    db.seedReservation(buildReservation({ id: 16, charge_mode: "immediate" }));
    const { service, stripeService } = createService(db);

    const result = await db.transaction(manager =>
      service.activateFromPayment(paymentInput(16), manager),
    );

    expect(result.outcome).toBe(PAYMENT_ACTIVATION_OUTCOME.ACTIVATED);
    expect(db.availability.every(row => !row.is_available)).toBe(true);
    expect(stripeService.refundPaymentIntent).not.toHaveBeenCalled();
  });

  it("refunds the second payer when the first confirmation already took the nights", async () => {
    const db = new FakeReservationDb();
    db.seedNights(SITE_ID, ROOM_ID, NIGHTS, true);
    db.seedReservation(buildReservation({ id: 17, charge_mode: "immediate" }));
    db.seedReservation(buildReservation({ id: 18, charge_mode: "immediate" }));
    const { service, stripeService } = createService(db);

    const first = await db.transaction(manager =>
      service.activateFromPayment(paymentInput(17), manager),
    );
    const second = await db.transaction(manager =>
      service.activateFromPayment(
        { ...paymentInput(18), paymentIntentId: "pi_test_2" },
        manager,
      ),
    );

    expect(first.outcome).toBe(PAYMENT_ACTIVATION_OUTCOME.ACTIVATED);
    expect(second.outcome).toBe(PAYMENT_ACTIVATION_OUTCOME.REFUNDED);
    expect(second.refundReason).toBe(AUTO_REFUND_REASON.DATES_UNAVAILABLE);
    expect(db.reservations.get(18)).toMatchObject({
      status: "cancelled",
      payment_status: "refunded",
    });
    expect(db.availability.every(row => !row.is_available)).toBe(true);
    expect(stripeService.refundPaymentIntent).toHaveBeenCalledOnce();
  });

  it("expires an immediate checkout without freeing nights held by another reservation", async () => {
    const db = new FakeReservationDb();
    db.seedNights(SITE_ID, ROOM_ID, NIGHTS, false);
    db.seedReservation(
      buildReservation({
        id: 19,
        status: "confirmed",
        payment_status: "paid",
        charge_mode: "immediate",
      }),
    );
    db.seedReservation(buildReservation({ id: 20, charge_mode: "immediate" }));
    const { service } = createService(db);

    const expired = await service.expirePendingReservation(20, "expired");

    expect(expired).toBe(true);
    expect(db.reservations.get(20)?.status).toBe("cancelled");
    expect(db.availability.every(row => !row.is_available)).toBe(true);
  });

  it("releases nights a legacy pending had blocked when that hold expires", async () => {
    const db = new FakeReservationDb();
    db.seedNights(SITE_ID, ROOM_ID, NIGHTS, false);
    db.seedReservation(buildReservation({ id: 21, charge_mode: "immediate" }));
    const { service } = createService(db);

    await service.expirePendingReservation(21, "checkout_session_expired");

    expect(db.reservations.get(21)).toMatchObject({
      status: "cancelled",
      payment_status: "pending",
    });
    expect(db.availability.every(row => row.is_available)).toBe(true);
  });

  it("does not flip free nights when an immediate checkout expires", async () => {
    const db = new FakeReservationDb();
    db.seedNights(SITE_ID, ROOM_ID, NIGHTS, true);
    db.seedReservation(buildReservation({ id: 22, charge_mode: "immediate" }));
    const { service } = createService(db);

    await service.expirePendingReservation(22, "async_payment_failed");

    expect(db.reservations.get(22)?.status).toBe("cancelled");
    expect(db.availability.every(row => row.is_available)).toBe(true);
  });
});

describe("overbooking protection (locked availability rows)", () => {
  it("lets only one of two parallel reservations for the same nights succeed", async () => {
    const db = new FakeReservationDb();
    db.seedNights(SITE_ID, ROOM_ID, NIGHTS, true);
    const { service } = createService(db);
    const dto = {
      site_id: SITE_ID,
      room_id: ROOM_ID,
      source: "internal" as const,
      user_id: 1,
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guests: 2,
      pets: 0,
      subtotal: 200,
      commission: 0,
    };

    const results = await Promise.allSettled([
      service.create(dto),
      service.create(dto),
    ]);

    const fulfilled = results.filter(result => result.status === "fulfilled");
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(ConflictException);
    expect(db.reservations.size).toBe(1);
    expect(db.availability.every(row => !row.is_available)).toBe(true);
  });

  it("rejects when a night has no availability row", async () => {
    const db = new FakeReservationDb();
    db.seedNights(SITE_ID, ROOM_ID, ["2026-08-10"], true);
    const { service } = createService(db);

    await expect(
      service.create({
        site_id: SITE_ID,
        room_id: ROOM_ID,
        source: "internal",
        user_id: 1,
        checkin: CHECKIN,
        checkout: CHECKOUT,
        guests: 1,
        pets: 0,
        subtotal: 100,
        commission: 0,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.reservations.size).toBe(0);
    expect(db.availability[0]?.is_available).toBe(true);
  });
});
