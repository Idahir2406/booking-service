import type { EntityManager } from "typeorm";

import { createEconomics } from "@/tests/utils/economics";
import { FakeReservationDb } from "@/tests/utils/fake-reservation-db";
import { pricedQuote } from "@/tests/utils/quote";

import { actors } from "@/src/contexts/payments/domain/audit-actor";
import { AuditLogEntity } from "@/src/contexts/payments/entities/audit-log.entity";
import { PaymentEntity } from "@/src/contexts/payments/entities/payment.entity";
import { RefundEntity } from "@/src/contexts/payments/entities/refund.entity";
import { ReservationPriceLineEntity } from "@/src/contexts/payments/entities/reservation-price-line.entity";
import { ReservationSnapshotEntity } from "@/src/contexts/payments/entities/reservation-snapshot.entity";
import { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";
import {
  PAYMENT_ACTIVATION_OUTCOME,
  type QuoteReservationResult,
  ReservationService,
} from "@/src/contexts/reservations/services/reservation.service";
import { ReservationLifecycleService } from "@/src/contexts/reservations/services/reservation-lifecycle.service";
import { ReservationPayoutService } from "@/src/contexts/reservations/services/reservation-payout.service";
import { signTravelerToken } from "@/src/contexts/reservations/utils/traveler-token.util";
import { envs } from "@/src/contexts/shared/configs/envs";
import { ReservationWebhookService } from "@/src/contexts/webhook/services/reservation-webhook.service";

const SITE_ID = 42;
const ROOM_ID = 3;
const CHECKIN = "2027-05-10";
const CHECKOUT = "2027-05-12";
const NIGHTS = ["2027-05-10", "2027-05-11"];

// F2: built by the same pure function the real quote uses (2 nights x 100 €
// + half board 2 x 15 €, 1 dog declared only as a legacy count).
const QUOTE: QuoteReservationResult = pricedQuote();

const TRAVELER_TOKEN = signTravelerToken(
  77,
  Math.floor(Date.now() / 1000) + 3600,
  envs.INTERNAL_API_KEY,
);

const createFixture = () => {
  const db = new FakeReservationDb();
  db.seedNights(SITE_ID, ROOM_ID, NIGHTS, true);
  const { economics, snapshots } = createEconomics(db.store);

  const reservationRepository = {
    manager: {
      transaction: <T>(run: (manager: EntityManager) => Promise<T>) =>
        db.transaction(run),
    },
  };
  let refundSeq = 0;
  const stripeService = {
    createSitePaymentLink: vi.fn(),
    refundPaymentIntent: vi.fn(() => {
      refundSeq += 1;
      return Promise.resolve({ id: `re_${refundSeq}`, status: "pending" });
    }),
  };
  const reservationEventService = {
    logEventInTransaction: vi.fn(() => Promise.resolve()),
  };
  const emailService = {
    sendPaymentConfirmedEmails: vi.fn(() => Promise.resolve()),
    sendCancelledEmails: vi.fn(() => Promise.resolve()),
    sendRefundProcessedEmails: vi.fn(() => Promise.resolve()),
    sendRefundFailedEmails: vi.fn(() => Promise.resolve()),
  };
  const roomsService = {
    findOne: vi.fn().mockResolvedValue({
      id: ROOM_ID,
      name: "Suite Perruna",
      max_guests: 2,
      max_pets: 2,
      price_per_night: "100.00",
      is_active: true,
    }),
  };
  const mysqlService = {
    queryOne: vi.fn().mockResolvedValue({ id: SITE_ID, user_id: 5 }),
  };

  const reservationService = new ReservationService(
    reservationRepository as never,
    mysqlService as never,
    {} as never,
    { find_blocking_overlap: vi.fn().mockResolvedValue(null) } as never,
    roomsService as never,
    {} as never,
    {} as never,
    stripeService as never,
    reservationEventService as never,
    economics,
    {} as never,
    {} as never,
  );
  vi.spyOn(reservationService, "quoteReservation").mockResolvedValue(QUOTE);
  stripeService.createSitePaymentLink.mockImplementation(
    async (body: { reservation_id: number }) => {
      await reservationService.saveStripeCheckoutSessionId(
        body.reservation_id,
        "cs_test_1",
      );
      return {
        url: "https://checkout.stripe.test/cs_test_1",
        expires_at: new Date(),
      };
    },
  );

  const payoutService = new ReservationPayoutService(
    reservationRepository as never,
    {} as never,
    stripeService as never,
    reservationService,
    emailService as never,
    reservationEventService as never,
    economics,
  );
  const lifecycleService = new ReservationLifecycleService(
    reservationRepository as never,
    reservationService,
    payoutService,
    {} as never,
    emailService as never,
    reservationEventService as never,
    economics,
  );
  const webhookService = new ReservationWebhookService(
    reservationService,
    emailService as never,
    reservationEventService as never,
    economics,
  );

  const audit = (action?: string) =>
    db.store
      .rows(AuditLogEntity)
      .filter(row => action === undefined || row.action === action);

  return {
    db,
    reservationService,
    lifecycleService,
    payoutService,
    webhookService,
    stripeService,
    reservationEventService,
    snapshots,
    audit,
  };
};

type Fixture = ReturnType<typeof createFixture>;

const checkout = (fixture: Fixture) =>
  fixture.reservationService.checkout({
    site_id: SITE_ID,
    room_id: ROOM_ID,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    guests: 2,
    pets: 1,
    board_option_id: 5,
    guest_name: "Ana",
    guest_email: "ana@example.com",
    traveler_token: TRAVELER_TOKEN,
  } as never);

const completedEvent = (id: string, reservationId: number) => ({
  id,
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test_1",
      payment_status: "paid",
      metadata: { reservation_id: String(reservationId) },
      payment_intent: "pi_test_1",
      amount_total: 23_000,
    },
  },
});

const refundEvent = (
  id: string,
  type: string,
  refund: Record<string, unknown>,
) => ({ id, type, data: { object: refund } });

const payCheckout = async (fixture: Fixture, reservationId: number) =>
  fixture.db.transaction(manager =>
    fixture.webhookService.handleCheckoutCompleted(
      completedEvent("evt_paid_1", reservationId),
      manager,
      [],
    ),
  );

describe("checkout writes the F1 economic record in the reservation transaction", () => {
  it("creates price lines, a pending_charge payment, snapshot v1 and frozen commission", async () => {
    const fixture = createFixture();

    const result = await checkout(fixture);

    const reservation = fixture.db.reservations.get(result.reservation_id);
    expect(reservation).toMatchObject({
      status: "pending",
      payment_status: "pending",
      commission_rate: 0.12,
      commission_cents: 2760, // 12 % of 230,00 €
      total_cents: 23_000,
      currency: "eur",
      timezone: "Europe/Madrid",
      snapshot_version: 1,
      charge_mode: "immediate",
    });
    expect(fixture.db.availability.every(row => row.is_available)).toBe(true);

    const lines = fixture.db.store.rows(ReservationPriceLineEntity);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      type: "accommodation",
      quantity: 2,
      unit_amount_cents: 10_000,
      amount_cents: 20_000,
      is_commissionable: true,
      is_penalizable: true,
      created_by_type: "traveler",
      created_by_id: "77",
    });
    expect(lines[1]).toMatchObject({
      type: "board",
      amount_cents: 3000,
      is_commissionable: true,
      is_penalizable: true,
    });

    const [payment] = fixture.db.store.rows(PaymentEntity);
    expect(payment).toMatchObject({
      reservation_id: result.reservation_id,
      status: "pending_charge",
      amount_cents: 23_000,
      idempotency_key: `payment:checkout:${result.reservation_id}`,
      stripe_checkout_session_id: "cs_test_1",
      attempts: 1,
    });

    const [snapshot] = fixture.db.store.rows(ReservationSnapshotEntity);
    expect(snapshot).toMatchObject({ version: 1, reason: "checkout" });
    expect(snapshot.payload).toMatchObject({
      stay: {
        checkin: CHECKIN,
        checkout: CHECKOUT,
        nights: 2,
        guests: 2,
        pets: 1,
      },
      room: {
        id: ROOM_ID,
        name: "Suite Perruna",
        price_per_night_cents: 10_000,
      },
      board: { code: "HB", amount_cents: 3000 },
      total_cents: 23_000,
      commission: { rate: 0.12, cents: 2760, commissionable_cents: 23_000 },
      refund_policy: { window_hours: 24, timezone: "Europe/Madrid" },
    });

    expect(fixture.audit("reservation.created")).toHaveLength(1);
    expect(fixture.audit("payment.created")).toHaveLength(1);
  });

  it("rolls back lines/payment/snapshot together with the reservation when the transaction fails", async () => {
    const fixture = createFixture();
    vi.spyOn(fixture.snapshots, "createSnapshot").mockRejectedValueOnce(
      new Error("snapshot insert failed"),
    );

    await expect(checkout(fixture)).rejects.toThrow("snapshot insert failed");

    expect(fixture.db.reservations.size).toBe(0);
    expect(fixture.db.store.rows(ReservationPriceLineEntity)).toHaveLength(0);
    expect(fixture.db.store.rows(PaymentEntity)).toHaveLength(0);
    expect(fixture.db.availability.every(row => row.is_available)).toBe(true);
  });
});

describe("checkout.session.completed drives the payment state machine", () => {
  it("marks the payment paid once; a replayed event is a no-op", async () => {
    const fixture = createFixture();
    const { reservation_id: id } = await checkout(fixture);

    await payCheckout(fixture, id);
    const replay = await fixture.db.transaction(manager =>
      fixture.reservationService.activateFromPayment(
        {
          reservationId: id,
          checkoutSessionId: "cs_test_1",
          paymentIntentId: "pi_test_1",
          amountPaidCents: 23_000,
          actor: actors.stripe("evt_paid_2"),
        },
        manager,
      ),
    );

    expect(replay.outcome).toBe(PAYMENT_ACTIVATION_OUTCOME.ALREADY_ACTIVE);
    const payments = fixture.db.store.rows(PaymentEntity);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      status: "paid",
      stripe_payment_intent_id: "pi_test_1",
    });
    expect(fixture.db.reservations.get(id)).toMatchObject({
      status: "confirmed",
      payment_status: "paid", // legacy column kept in sync for PHP
      payout_status: "held",
    });
    expect(fixture.db.availability.every(row => !row.is_available)).toBe(true);
    const changes = fixture.audit("payment.status_changed");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      before: { status: "pending_charge" },
      after: { status: "paid" },
      actor_type: "stripe",
      actor_id: "evt_paid_1",
    });
  });

  it("expired session -> payment failed; a late payment (dates free) -> paid again, kept as history", async () => {
    const fixture = createFixture();
    const { reservation_id: id } = await checkout(fixture);

    await fixture.db.transaction(manager =>
      fixture.webhookService.handleCheckoutExpired(
        {
          id: "evt_exp",
          type: "checkout.session.expired",
          data: {
            object: {
              id: "cs_test_1",
              payment_status: "unpaid",
              metadata: { reservation_id: String(id) },
            },
          },
        },
        manager,
      ),
    );
    expect(fixture.db.store.rows(PaymentEntity)[0]).toMatchObject({
      status: "failed",
      failure_code: "checkout_session_expired",
    });

    const result = await payCheckout(fixture, id);

    expect(result.reservationId).toBe(id);
    expect(fixture.db.store.rows(PaymentEntity)[0]?.status).toBe("paid");
    expect(fixture.db.reservations.get(id)?.status).toBe("confirmed");
    const paidAfterFailure = fixture
      .audit("payment.status_changed")
      .find(row => row.after?.status === "paid");
    expect(paidAfterFailure?.metadata).toMatchObject({
      paid_after_failure: true,
    });
  });

  it("a late failure event after payment is audited and ignored (never downgrades)", async () => {
    const fixture = createFixture();
    const { reservation_id: id } = await checkout(fixture);
    await payCheckout(fixture, id);

    await fixture.db.transaction(manager =>
      fixture.webhookService.handleCheckoutExpired(
        {
          id: "evt_async_failed",
          type: "checkout.session.async_payment_failed",
          data: {
            object: {
              id: "cs_test_1",
              payment_status: "unpaid",
              metadata: { reservation_id: String(id) },
            },
          },
        },
        manager,
      ),
    );

    expect(fixture.db.store.rows(PaymentEntity)[0]?.status).toBe("paid");
    expect(fixture.db.reservations.get(id)?.status).toBe("confirmed");
  });
});

const cancelWithRefund = async (fixture: Fixture, id: number) => {
  await fixture.db.transaction(async manager => {
    const repository = manager.getRepository(ReservationEntity);
    const reservation = await repository.findOne({
      where: { id },
      lock: { mode: "pessimistic_write" },
    });
    if (!reservation) {
      throw new Error(`missing reservation ${id}`);
    }
    await fixture.payoutService.refundInTransaction(
      manager,
      reservation,
      undefined,
      "host_cancelled",
      {
        requestedBy: { type: "host", id: `site:${SITE_ID}` },
        approvedBy: { type: "host", id: `site:${SITE_ID}` },
        responsible: "host",
      },
    );
    reservation.status = "cancelled";
    reservation.cancel_reason = "Cierre por obras";
    await repository.save(reservation);
  });
};

describe("refund lifecycle follows Stripe refund.* webhooks", () => {
  it("host cancel -> refund row processing -> refund.updated succeeded -> total_completed (idempotent)", async () => {
    const fixture = createFixture();
    const { reservation_id: id } = await checkout(fixture);
    await payCheckout(fixture, id);

    await cancelWithRefund(fixture, id);

    const [created] = fixture.db.store.rows(RefundEntity);
    expect(created).toMatchObject({
      reservation_id: id,
      status: "processing",
      amount_cents: 23_000,
      stripe_refund_id: "re_1",
      idempotency_key: `refund:${id}:1`,
      responsible: "host",
      requested_by_type: "host",
      requested_by_id: `site:${SITE_ID}`,
      reason: "host_cancelled",
    });
    expect(fixture.db.reservations.get(id)?.payment_status).toBe("refunded");

    const succeeded = {
      id: "re_1",
      status: "succeeded",
      amount: 23_000,
      payment_intent: "pi_test_1",
      metadata: { reservation_id: String(id), refund_seq: "1" },
    };
    await fixture.db.transaction(manager =>
      fixture.webhookService.handleRefundEvent(
        refundEvent("evt_re_upd", "refund.updated", succeeded),
        manager,
      ),
    );
    await fixture.db.transaction(manager =>
      fixture.webhookService.handleRefundEvent(
        refundEvent("evt_re_upd_2", "refund.updated", succeeded),
        manager,
      ),
    );

    const [completed] = fixture.db.store.rows(RefundEntity);
    expect(completed.status).toBe("total_completed");
    expect(completed.completed_at).toBeInstanceOf(Date);
    expect(
      fixture
        .audit("refund.status_changed")
        .filter(row => row.after?.status === "total_completed"),
    ).toHaveLength(1);

    // charge.refunded afterwards stays consistent (no second refund row, charge id stored).
    await fixture.db.transaction(manager =>
      fixture.webhookService.handleChargeRefunded(
        {
          id: "evt_ch_ref",
          type: "charge.refunded",
          data: {
            object: {
              id: "ch_1",
              payment_intent: "pi_test_1",
              amount: 23_000,
              amount_refunded: 23_000,
              refunded: true,
            },
          },
        },
        manager,
        [],
      ),
    );
    expect(fixture.db.store.rows(RefundEntity)).toHaveLength(1);
    expect(fixture.db.store.rows(PaymentEntity)[0]?.stripe_charge_id).toBe(
      "ch_1",
    );
    expect(fixture.db.reservations.get(id)?.payment_status).toBe("refunded");
  });

  it("refund.failed -> failed, legacy columns reverted, a late 'succeeded' never marks it completed", async () => {
    const fixture = createFixture();
    const { reservation_id: id } = await checkout(fixture);
    await payCheckout(fixture, id);
    await cancelWithRefund(fixture, id);

    await fixture.db.transaction(manager =>
      fixture.webhookService.handleRefundEvent(
        refundEvent("evt_re_failed", "refund.failed", {
          id: "re_1",
          status: "failed",
          failure_reason: "expired_or_canceled_card",
          amount: 23_000,
          payment_intent: "pi_test_1",
          metadata: { reservation_id: String(id) },
        }),
        manager,
      ),
    );

    const [failed] = fixture.db.store.rows(RefundEntity);
    expect(failed).toMatchObject({
      status: "failed",
      failure_reason: "expired_or_canceled_card",
    });
    expect(fixture.db.reservations.get(id)).toMatchObject({
      payment_status: "paid",
      amount_refunded: 0,
    });
    expect(
      fixture.reservationEventService.logEventInTransaction,
    ).toHaveBeenCalledWith(
      expect.anything(),
      id,
      "refund_failed",
      expect.any(Object),
    );

    await fixture.db.transaction(manager =>
      fixture.webhookService.handleRefundEvent(
        refundEvent("evt_re_late", "refund.updated", {
          id: "re_1",
          status: "succeeded",
          amount: 23_000,
          payment_intent: "pi_test_1",
          metadata: { reservation_id: String(id) },
        }),
        manager,
      ),
    );
    expect(fixture.db.store.rows(RefundEntity)[0]?.status).toBe("failed");
    expect(fixture.audit("refund.transition_rejected")).toHaveLength(1);
  });

  it("a refund made in the Stripe Dashboard is recorded from refund.created", async () => {
    const fixture = createFixture();
    const { reservation_id: id } = await checkout(fixture);
    await payCheckout(fixture, id);

    await fixture.db.transaction(manager =>
      fixture.webhookService.handleRefundEvent(
        refundEvent("evt_dash", "refund.created", {
          id: "re_dash",
          status: "succeeded",
          amount: 5000,
          payment_intent: "pi_test_1",
          metadata: {},
        }),
        manager,
      ),
    );

    expect(fixture.db.store.rows(RefundEntity)[0]).toMatchObject({
      reservation_id: id,
      status: "partial_completed",
      amount_cents: 5000,
      idempotency_key: "refund:stripe:re_dash",
      requested_by_type: "stripe",
    });
  });
});

describe("reservation snapshots are versioned and append-only", () => {
  it("auto-increments the version and never rewrites previous versions", async () => {
    const fixture = createFixture();
    const reservation = fixture.db.seedReservation(
      Object.assign(new ReservationEntity(), {
        id: 50,
        site_id: SITE_ID,
        room_id: ROOM_ID,
        checkin: CHECKIN,
        checkout: CHECKOUT,
        status: "confirmed",
        payment_status: "paid",
        refund_seq: 0,
      }),
    );

    const first = await fixture.db.transaction(manager =>
      fixture.snapshots.createSnapshot(
        reservation.id,
        "checkout",
        { a: 1 },
        manager,
      ),
    );
    const second = await fixture.db.transaction(manager =>
      fixture.snapshots.createSnapshot(
        reservation.id,
        "modification",
        { a: 2 },
        manager,
      ),
    );

    expect([first.version, second.version]).toEqual([1, 2]);
    const rows = fixture.db.store.rows(ReservationSnapshotEntity);
    expect(rows.map(row => [row.version, row.payload])).toEqual([
      [1, { a: 1 }],
      [2, { a: 2 }],
    ]);
    expect(fixture.db.reservations.get(50)?.snapshot_version).toBe(2);
  });

  it("retries on a concurrent writer (unique reservation_id+version) instead of overwriting", async () => {
    const fixture = createFixture();
    fixture.db.seedReservation(
      Object.assign(new ReservationEntity(), { id: 51, refund_seq: 0 }),
    );
    await fixture.db.transaction(manager =>
      fixture.snapshots.createSnapshot(51, "checkout", { v: 1 }, manager),
    );

    // Simulate a stale MAX(version) read (another writer inserted v1 meanwhile).
    const manager = fixture.db.manager();
    const repository = manager.getRepository(ReservationSnapshotEntity);
    const maximum = vi
      .spyOn(repository, "maximum")
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    const originalGetRepository = manager.getRepository.bind(manager);
    vi.spyOn(manager, "getRepository").mockImplementation(((entity: unknown) =>
      entity === ReservationSnapshotEntity
        ? repository
        : originalGetRepository(entity as never)) as never);

    const snapshot = await fixture.snapshots.createSnapshot(
      51,
      "modification",
      { v: 2 },
      manager,
    );

    expect(maximum).toHaveBeenCalledTimes(2);
    expect(snapshot.version).toBe(2);
    expect(
      fixture.db.store.rows(ReservationSnapshotEntity).map(row => row.payload),
    ).toEqual([{ v: 1 }, { v: 2 }]);
  });
});
