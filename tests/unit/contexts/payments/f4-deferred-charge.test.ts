import type { EntityManager } from "typeorm";
import type { AfterCommitTask } from "@/src/contexts/webhook/types/stripe-webhook-event.type";

import { HttpException } from "@nestjs/common";

import { createEconomics } from "@/tests/utils/economics";
import { FakeReservationDb } from "@/tests/utils/fake-reservation-db";
import { pricedQuote } from "@/tests/utils/quote";

import { PAYMENT_STATUS } from "@/src/contexts/payments/domain/payment-state-machine";
import { PaymentEntity } from "@/src/contexts/payments/entities/payment.entity";
import { PlatformSettingEntity } from "@/src/contexts/payments/entities/platform-setting.entity";
import { RefundEntity } from "@/src/contexts/payments/entities/refund.entity";
import { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";
import { ReservationDisputeEntity } from "@/src/contexts/reservations/entities/reservation-dispute.entity";
import { ReservationService } from "@/src/contexts/reservations/services/reservation.service";
import { ReservationChangeApplyService } from "@/src/contexts/reservations/services/reservation-change-apply.service";
import {
  DEFERRED_CHARGE_OUTCOME,
  regularizationDeadline,
  ReservationDeferredChargeService,
} from "@/src/contexts/reservations/services/reservation-deferred-charge.service";
import { ReservationRefundService } from "@/src/contexts/reservations/services/reservation-refund.service";
import { TravelerReservationPayService } from "@/src/contexts/reservations/services/traveler-reservation-pay.service";
import { resolveTravelerCancellationQuote } from "@/src/contexts/reservations/utils/refund-policy.util";
import {
  CHANGE_KIND,
  isChangeEligibleReservation,
} from "@/src/contexts/reservations/utils/reservation-change.util";
import { isReservationBlockingInventory } from "@/src/contexts/reservations/utils/reservation-policy.util";
import {
  mapTravelerFacingStatus,
  resolveTravelerPayability,
} from "@/src/contexts/reservations/utils/traveler-panel-status.util";
import { signTravelerToken } from "@/src/contexts/reservations/utils/traveler-token.util";
import { envs } from "@/src/contexts/shared/configs/envs";
import { SiteSettingsEntity } from "@/src/contexts/site-wizard/entities/site-settings.entity";
import {
  cardExpiryInstant,
  StripeService,
} from "@/src/contexts/stripe/services/stripe.service";
import { ReservationWebhookService } from "@/src/contexts/webhook/services/reservation-webhook.service";

const SITE_ID = 42;
const ROOM_ID = 3;
const TRAVELER = 77;
const CHECKIN = "2099-05-10";
const CHECKOUT = "2099-05-12";
const NIGHTS = ["2099-05-10", "2099-05-11"];
/** 03/05/2099 18:00 Europe/Madrid (CEST) = 16:00Z: 7 days before check-in. */
const CHARGE_AT = "2099-05-03T16:00:00.000Z";
const AFTER_CHARGE_AT = new Date("2099-05-04T00:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

interface SetupSessionParams {
  mode: string;
  currency: string;
  customer: string;
  metadata: Record<string, string>;
  setup_intent_data: { metadata: Record<string, string> };
  success_url: string;
  cancel_url: string;
  expires_at: number;
  line_items?: unknown;
  payment_intent_data?: unknown;
}

const cardError = (code: string, intentId: string) =>
  Object.assign(new Error(`card error ${code}`), {
    type: "StripeCardError",
    code,
    payment_intent: { id: intentId, status: "requires_payment_method" },
  });

const createFixture = () => {
  const db = new FakeReservationDb();
  db.seedNights(SITE_ID, ROOM_ID, NIGHTS, true);
  const { economics, snapshots } = createEconomics(db.store, {
    withSiteSettings: true,
  });
  void db.store.repository(SiteSettingsEntity).insert({
    site_id: SITE_ID,
    cancellation_policy_type: "free_cancellation",
    cancellation_deadline_days: 7,
    cancellation_penalty_type: "percent_50",
    no_show_policy: "same_as_cancellation",
    grace_after_booking_hours: null,
    early_cancellation_weeks: null,
    timezone: "Europe/Madrid",
  });
  void db.store.repository(PlatformSettingEntity).insert({
    key: "deferred_charge_enabled",
    value: "true",
  });

  const reservationRepository = {
    manager: {
      transaction: <T>(run: (manager: EntityManager) => Promise<T>) =>
        db.transaction(run),
    },
    findOne: (options: { where: Record<string, unknown> }) =>
      db.manager().getRepository(ReservationEntity).findOne(options),
    find: (options: { where: Record<string, unknown> }) =>
      db.manager().getRepository(ReservationEntity).find(options),
    update: (criteria: { id: number }, patch: Partial<ReservationEntity>) =>
      db
        .manager()
        .getRepository(ReservationEntity)
        .update(criteria, patch as never),
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
  const stripe = {
    checkout: { sessions },
    customers: {
      list: vi.fn().mockResolvedValue({ data: [{ id: "cus_1" }] }),
    },
    setupIntents: {
      retrieve: vi.fn().mockResolvedValue({
        id: "seti_1",
        customer: "cus_1",
        payment_method: {
          id: "pm_1",
          card: { exp_year: 2100, exp_month: 12 },
        },
      }),
    },
    paymentIntents: { create: vi.fn() },
    paymentMethods: { detach: vi.fn().mockResolvedValue({}) },
    refunds: { create: vi.fn() },
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
  Object.assign(stripeService, { stripe });

  const events = { logEventInTransaction: vi.fn(() => Promise.resolve()) };
  const emails = {
    sendPaymentConfirmedEmails: vi.fn(() => Promise.resolve()),
    sendCancelledEmails: vi.fn(() => Promise.resolve()),
    sendDeferredChargeSucceededEmail: vi.fn(() => Promise.resolve()),
    sendDeferredChargeFailedEmails: vi.fn(() => Promise.resolve()),
    sendRegularizationExpiredEmails: vi.fn(() => Promise.resolve()),
    sendDeferredPenaltyFailedAdminEmail: vi.fn(() => Promise.resolve()),
    sendForceMajeureReviewAdminEmail: vi.fn(() => Promise.resolve()),
  };
  const blocksService = {
    find_blocking_overlap: vi.fn().mockResolvedValue(null),
  };
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
    events as never,
    economics,
    {} as never,
    {} as never,
  );
  Object.assign(stripeService, { reservationService });
  vi.spyOn(reservationService, "quoteReservation").mockResolvedValue(
    pricedQuote(),
  );

  const deferred = new ReservationDeferredChargeService(
    reservationRepository as never,
    reservationService,
    economics,
    stripeService,
    emails as never,
    events as never,
  );
  const webhookService = new ReservationWebhookService(
    reservationService,
    emails as never,
    events as never,
    economics,
    deferred,
  );
  const payService = new TravelerReservationPayService(
    reservationService,
    stripeService,
  );
  const payoutService = { refundInTransaction: vi.fn() };
  const incidentService = {
    openChargeIssueIncidentInTransaction: vi
      .fn()
      .mockResolvedValue({ id: 900 }),
    openForceMajeureIncidentInTransaction: vi.fn(),
  };
  const refundService = new ReservationRefundService(
    reservationRepository as never,
    db.store.repository(RefundEntity) as never,
    db.store.repository(ReservationDisputeEntity) as never,
    reservationService,
    payoutService as never,
    emails as never,
    events as never,
    economics,
    snapshots,
    stripeService,
    incidentService as never,
    deferred,
  );

  /** Pending flexible reservation created by the real checkout (cs_1). */
  const checkout = async () => {
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
    return result.reservation_id;
  };

  const runWebhook = async (
    handler: (
      manager: EntityManager,
      afterCommit: AfterCommitTask[],
    ) => Promise<unknown>,
  ) => {
    const afterCommit: AfterCommitTask[] = [];
    await db.transaction(manager => handler(manager, afterCommit));
    for (const task of afterCommit) {
      await task();
    }
  };

  const setupEvent = (reservationId: number, sessionId = "cs_1") => ({
    id: `evt_setup_${sessionId}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        mode: "setup",
        status: "complete",
        payment_status: "no_payment_required",
        setup_intent: "seti_1",
        customer: "cus_1",
        metadata: { reservation_id: String(reservationId) },
      },
    },
  });

  const completeSetup = (reservationId: number) =>
    runWebhook((manager, afterCommit) =>
      webhookService.handleCheckoutCompleted(
        setupEvent(reservationId) as never,
        manager,
        afterCommit,
      ),
    );

  /** Confirmed flexible reservation with the card saved. */
  const bookFlexible = async () => {
    const id = await checkout();
    await completeSetup(id);
    return id;
  };

  const payments = (id: number) =>
    db.store
      .rows(PaymentEntity)
      .filter(row => row.reservation_id === id)
      .sort((a, b) => a.id - b.id);

  const reservation = (id: number) => {
    const row = db.reservations.get(id);
    if (!row) {
      throw new Error(`reservation ${id} missing`);
    }
    return row;
  };

  return {
    db,
    stripe,
    sessions,
    emails,
    events,
    economics,
    reservationService,
    stripeService,
    deferred,
    webhookService,
    payService,
    refundService,
    payoutService,
    incidentService,
    checkout,
    bookFlexible,
    completeSetup,
    runWebhook,
    payments,
    reservation,
  };
};

describe("Fase 4 · Checkout in setup mode for flexible reservations", () => {
  it("creates a setup session (no line items, no charge) and freezes charge_at", async () => {
    const f = createFixture();
    const id = await f.checkout();

    const row = f.reservation(id);
    expect(row).toMatchObject({
      status: "pending",
      payment_status: "pending",
      charge_mode: "flexible",
    });
    expect(row.charge_at?.toISOString()).toBe(CHARGE_AT);

    const [params, options] = f.sessions.create.mock.calls[0] as unknown as [
      SetupSessionParams,
      { idempotencyKey: string },
    ];
    expect(params).toMatchObject({
      mode: "setup",
      currency: "eur",
      customer: "cus_1",
      metadata: { reservation_id: String(id) },
      setup_intent_data: { metadata: { reservation_id: String(id) } },
    });
    expect(params.line_items).toBeUndefined();
    expect(params.payment_intent_data).toBeUndefined();
    expect(params.success_url).toContain(`reservation_id=${id}`);
    expect(params.cancel_url).toContain(`reservation_id=${id}`);
    expect(params.expires_at).toBeGreaterThan(Date.now() / 1000);
    expect(options.idempotencyKey).toBe(`checkout:${id}`);
    // Inventory is NOT held by the pending setup checkout.
    expect(f.db.availability.every(night => night.is_available)).toBe(true);
  });
});

describe("Fase 4 · activateFromSetup", () => {
  it("confirms, claims the nights, stores the card and leaves the payment method_validated", async () => {
    const f = createFixture();
    const id = await f.bookFlexible();

    expect(f.reservation(id)).toMatchObject({
      status: "confirmed",
      payment_status: "pending",
      stripe_customer_id: "cus_1",
      stripe_payment_method_id: "pm_1",
      stripe_setup_intent_id: "seti_1",
      stripe_checkout_session_id: "cs_1",
    });
    expect(f.reservation(id).charge_at?.toISOString()).toBe(CHARGE_AT);
    expect(f.db.availability.every(night => !night.is_available)).toBe(true);
    expect(f.payments(id).map(row => row.status)).toEqual([
      PAYMENT_STATUS.METHOD_VALIDATED,
    ]);
    expect(f.stripe.setupIntents.retrieve).toHaveBeenCalledWith("seti_1", {
      expand: ["payment_method"],
    });
    expect(f.emails.sendPaymentConfirmedEmails).toHaveBeenCalledTimes(1);
    expect(f.stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it("a replayed setup event is a no-op", async () => {
    const f = createFixture();
    const id = await f.bookFlexible();
    await f.completeSetup(id);
    expect(f.emails.sendPaymentConfirmedEmails).toHaveBeenCalledTimes(1);
    expect(f.stripe.setupIntents.retrieve).toHaveBeenCalledTimes(1);
  });

  it("charges right away when the card expires before charge_at", async () => {
    const f = createFixture();
    f.stripe.setupIntents.retrieve.mockResolvedValue({
      id: "seti_1",
      customer: "cus_1",
      payment_method: { id: "pm_1", card: { exp_year: 2099, exp_month: 1 } },
    });
    f.stripe.paymentIntents.create.mockResolvedValue({
      id: "pi_now",
      status: "succeeded",
    });
    const id = await f.bookFlexible();

    expect(f.stripe.paymentIntents.create).toHaveBeenCalledTimes(1);
    const [params] = f.stripe.paymentIntents.create.mock
      .calls[0] as unknown as [Record<string, unknown>];
    expect(params).toMatchObject({
      customer: "cus_1",
      payment_method: "pm_1",
      off_session: true,
      confirm: true,
      transfer_group: `reservation_${id}`,
      metadata: { reservation_id: String(id), deferred: "1" },
    });
    expect(f.reservation(id)).toMatchObject({
      payment_status: "paid",
      payout_status: "held",
      stripe_payment_intent_id: "pi_now",
    });
    expect(f.payments(id).at(-1)?.status).toBe(PAYMENT_STATUS.PAID);
  });

  it("dates taken meanwhile: cancels without charging anything", async () => {
    const f = createFixture();
    const id = await f.checkout();
    for (const night of f.db.availability) {
      night.is_available = false;
    }
    f.db.seedReservation(
      Object.assign(new ReservationEntity(), {
        id: 500,
        site_id: SITE_ID,
        room_id: ROOM_ID,
        checkin: CHECKIN,
        checkout: CHECKOUT,
        status: "confirmed",
        payment_status: "paid",
      }),
    );
    await f.completeSetup(id);
    expect(f.reservation(id)).toMatchObject({
      status: "cancelled",
      cancel_reason: "dates_unavailable_after_setup",
    });
    expect(f.stripe.paymentMethods.detach).toHaveBeenCalledWith("pm_1");
    expect(f.stripe.paymentIntents.create).not.toHaveBeenCalled();
  });
});

describe("Fase 4 · chargeOffSession result mapping", () => {
  const reservation = {
    id: 7,
    stripe_customer_id: "cus_1",
    stripe_payment_method_id: "pm_1",
    total_cents: 24_250,
    total: 242.5,
    subtotal: 242.5,
    commission: 0,
    currency: "eur",
  };
  const service = (create: ReturnType<typeof vi.fn>) => {
    const stripeService = new StripeService(
      {} as never,
      {} as never,
      {} as never,
    );
    Object.assign(stripeService, { stripe: { paymentIntents: { create } } });
    return stripeService;
  };

  it("succeeded / processing, with the attempt in the idempotency key", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: "pi_ok", status: "succeeded" })
      .mockResolvedValueOnce({ id: "pi_wait", status: "processing" });
    const stripeService = service(create);
    await expect(
      stripeService.chargeOffSession({ reservation, attempt: 3 }),
    ).resolves.toMatchObject({
      status: "succeeded",
      paymentIntentId: "pi_ok",
      amountCents: 24_250,
    });
    await expect(
      stripeService.chargeOffSession({ reservation, attempt: 4 }),
    ).resolves.toMatchObject({
      status: "processing",
      paymentIntentId: "pi_wait",
    });
    expect(create.mock.calls[0][1]).toEqual({
      idempotencyKey: "offsession-charge:7:3",
    });
    expect(create.mock.calls[0][0]).toMatchObject({
      amount: 24_250,
      currency: "eur",
      metadata: { total_cents: "24250", deferred: "1" },
    });
  });

  it("card_declined -> failed and authentication_required -> requires_action (PI from the error)", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(cardError("card_declined", "pi_declined"))
      .mockRejectedValueOnce(cardError("authentication_required", "pi_3ds"));
    const stripeService = service(create);
    await expect(
      stripeService.chargeOffSession({ reservation, attempt: 1 }),
    ).resolves.toMatchObject({
      status: "failed",
      paymentIntentId: "pi_declined",
      failureCode: "card_declined",
    });
    await expect(
      stripeService.chargeOffSession({ reservation, attempt: 2 }),
    ).resolves.toMatchObject({
      status: "requires_action",
      paymentIntentId: "pi_3ds",
      failureCode: "authentication_required",
    });
  });

  it("non-card errors are thrown (the caller rolls back and retries) and a missing card fails without calling Stripe", async () => {
    const create = vi.fn().mockRejectedValue(new Error("network down"));
    const stripeService = service(create);
    await expect(
      stripeService.chargeOffSession({ reservation, attempt: 1 }),
    ).rejects.toThrow("network down");
    await expect(
      stripeService.chargeOffSession({
        reservation: { ...reservation, stripe_payment_method_id: null },
        attempt: 1,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      failureCode: "payment_method_missing",
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("card expiry is the end of the expiry month", () => {
    expect(cardExpiryInstant(2099, 1)?.toISOString()).toBe(
      "2099-02-01T00:00:00.000Z",
    );
    expect(cardExpiryInstant(2099, 12)?.toISOString()).toBe(
      "2100-01-01T00:00:00.000Z",
    );
    expect(cardExpiryInstant(null, 3)).toBeNull();
  });
});

describe("Fase 4 · processDueCharges", () => {
  it("charges a due reservation once: paid, payout held, ledger paid (double run is safe)", async () => {
    const f = createFixture();
    const id = await f.bookFlexible();
    f.stripe.paymentIntents.create.mockResolvedValue({
      id: "pi_cron",
      status: "succeeded",
    });

    // Not due yet: nothing happens.
    await expect(f.deferred.processDueCharges(new Date())).resolves.toEqual([]);
    // attempts already counts the setup Checkout Session (attach).
    const attempt = f.payments(id)[0].attempts + 1;

    const [first, second] = await Promise.all([
      f.deferred.chargeReservation(id, AFTER_CHARGE_AT),
      f.deferred.chargeReservation(id, AFTER_CHARGE_AT),
    ]);
    expect(first.outcome).toBe(DEFERRED_CHARGE_OUTCOME.PAID);
    expect(second).toMatchObject({
      outcome: DEFERRED_CHARGE_OUTCOME.SKIPPED,
      reason: "not_deferred_unpaid",
    });
    await expect(
      f.deferred.processDueCharges(AFTER_CHARGE_AT),
    ).resolves.toEqual([]);

    expect(f.stripe.paymentIntents.create).toHaveBeenCalledTimes(1);
    const [, options] = f.stripe.paymentIntents.create.mock
      .calls[0] as unknown as [unknown, { idempotencyKey: string }];
    expect(options.idempotencyKey).toBe(`offsession-charge:${id}:${attempt}`);
    expect(f.reservation(id)).toMatchObject({
      status: "confirmed",
      payment_status: "paid",
      payout_status: "held",
      stripe_payment_intent_id: "pi_cron",
    });
    expect(f.payments(id)).toHaveLength(1);
    expect(f.payments(id)[0]).toMatchObject({
      status: PAYMENT_STATUS.PAID,
      stripe_payment_intent_id: "pi_cron",
      attempts: attempt,
    });
    expect(f.emails.sendDeferredChargeSucceededEmail).toHaveBeenCalledTimes(1);
  });

  it("a rolled-back run retries with the SAME idempotency key", async () => {
    const f = createFixture();
    const id = await f.bookFlexible();
    f.stripe.paymentIntents.create.mockResolvedValue({
      id: "pi_retry",
      status: "succeeded",
    });
    const attempt = f.payments(id)[0].attempts + 1;
    const apply = vi
      .spyOn(f.reservationService, "applyDeferredPayment")
      .mockRejectedValueOnce(new Error("db write failed"));

    await expect(
      f.deferred.chargeReservation(id, AFTER_CHARGE_AT),
    ).rejects.toThrow("db write failed");
    expect(f.payments(id)[0].status).toBe(PAYMENT_STATUS.METHOD_VALIDATED);
    apply.mockRestore();

    await f.deferred.chargeReservation(id, AFTER_CHARGE_AT);
    const keys = f.stripe.paymentIntents.create.mock.calls.map(
      call => (call as unknown as [unknown, { idempotencyKey: string }])[1],
    );
    expect(keys).toEqual([
      { idempotencyKey: `offsession-charge:${id}:${attempt}` },
      { idempotencyKey: `offsession-charge:${id}:${attempt}` },
    ]);
    expect(f.reservation(id).payment_status).toBe("paid");
  });

  it("declined: failed -> pending_regularization, deadline min(now + 24 h, check-in), emails", async () => {
    const f = createFixture();
    const id = await f.bookFlexible();
    f.stripe.paymentIntents.create.mockRejectedValue(
      cardError("card_declined", "pi_declined"),
    );

    const [result] = await f.deferred.processDueCharges(AFTER_CHARGE_AT);
    expect(result).toMatchObject({
      reservationId: id,
      outcome: DEFERRED_CHARGE_OUTCOME.REGULARIZATION,
      reason: "card_declined",
    });
    expect(f.reservation(id)).toMatchObject({
      status: "confirmed",
      payment_status: "pending",
    });
    expect(f.reservation(id).regularization_deadline_at?.toISOString()).toBe(
      new Date(AFTER_CHARGE_AT.getTime() + 24 * HOUR_MS).toISOString(),
    );
    expect(f.payments(id)[0]).toMatchObject({
      status: PAYMENT_STATUS.PENDING_REGULARIZATION,
      failure_code: "card_declined",
      stripe_payment_intent_id: null,
    });
    expect(f.emails.sendDeferredChargeFailedEmails).toHaveBeenCalledTimes(1);
    // Nights stay blocked during the regularization window.
    expect(f.db.availability.every(night => !night.is_available)).toBe(true);
    // In regularization the cron does not charge again.
    await f.deferred.processDueCharges(AFTER_CHARGE_AT);
    expect(f.stripe.paymentIntents.create).toHaveBeenCalledTimes(1);
  });

  it("authentication_required also opens the regularization window", async () => {
    const f = createFixture();
    const id = await f.bookFlexible();
    f.stripe.paymentIntents.create.mockRejectedValue(
      cardError("authentication_required", "pi_3ds"),
    );
    const [result] = await f.deferred.processDueCharges(AFTER_CHARGE_AT);
    expect(result).toMatchObject({
      outcome: DEFERRED_CHARGE_OUTCOME.REGULARIZATION,
      reason: "authentication_required",
    });
    expect(f.payments(id)[0].status).toBe(
      PAYMENT_STATUS.PENDING_REGULARIZATION,
    );
  });

  it("regularization deadline never goes past the check-in start (site timezone)", () => {
    const deadline = regularizationDeadline(
      { checkin: "2099-05-10", timezone: "Europe/Madrid" },
      new Date("2099-05-09T10:00:00.000Z"),
      24,
    );
    // 10/05/2099 00:00 CEST = 09/05 22:00Z
    expect(deadline.toISOString()).toBe("2099-05-09T22:00:00.000Z");
  });
});

describe("Fase 4 · payment_intent webhooks (async off-session charge)", () => {
  const intentEvent = (
    type: string,
    reservationId: number,
    intentId: string,
    amount: number,
    metadata: Record<string, string> = { deferred: "1" },
  ) => ({
    id: `evt_${type}_${intentId}`,
    type,
    data: {
      object: {
        id: intentId,
        amount,
        amount_received: type === "payment_intent.succeeded" ? amount : 0,
        metadata: { reservation_id: String(reservationId), ...metadata },
        last_payment_error:
          type === "payment_intent.payment_failed"
            ? { code: "card_declined", message: "declined" }
            : null,
      },
    },
  });

  it("processing charge settled by payment_intent.succeeded; replays are no-ops", async () => {
    const f = createFixture();
    const id = await f.bookFlexible();
    f.stripe.paymentIntents.create.mockResolvedValue({
      id: "pi_async",
      status: "processing",
    });
    const run = await f.deferred.chargeReservation(id, AFTER_CHARGE_AT);
    expect(run.outcome).toBe(DEFERRED_CHARGE_OUTCOME.PROCESSING);
    expect(f.payments(id)[0]).toMatchObject({
      status: PAYMENT_STATUS.PROCESSING,
      stripe_payment_intent_id: "pi_async",
    });
    const total = f.reservation(id).total_cents ?? 0;

    const event = intentEvent(
      "payment_intent.succeeded",
      id,
      "pi_async",
      total,
    );
    for (let replay = 0; replay < 2; replay += 1) {
      await f.runWebhook((manager, afterCommit) =>
        f.webhookService.handlePaymentIntentEvent(
          event as never,
          manager,
          afterCommit,
        ),
      );
    }
    expect(f.reservation(id)).toMatchObject({
      payment_status: "paid",
      stripe_payment_intent_id: "pi_async",
    });
    expect(f.payments(id)).toHaveLength(1);
    expect(f.payments(id)[0].status).toBe(PAYMENT_STATUS.PAID);
    expect(f.emails.sendDeferredChargeSucceededEmail).toHaveBeenCalledTimes(1);
  });

  it("payment_intent.payment_failed of the in-flight PI opens regularization once", async () => {
    const f = createFixture();
    const id = await f.bookFlexible();
    f.stripe.paymentIntents.create.mockResolvedValue({
      id: "pi_async",
      status: "processing",
    });
    await f.deferred.chargeReservation(id, AFTER_CHARGE_AT);
    const event = intentEvent(
      "payment_intent.payment_failed",
      id,
      "pi_async",
      1,
    );
    for (let replay = 0; replay < 2; replay += 1) {
      await f.runWebhook((manager, afterCommit) =>
        f.webhookService.handlePaymentIntentEvent(
          event as never,
          manager,
          afterCommit,
        ),
      );
    }
    expect(f.payments(id)[0]).toMatchObject({
      status: PAYMENT_STATUS.PENDING_REGULARIZATION,
      failure_code: "card_declined",
    });
    expect(f.reservation(id).regularization_deadline_at).toBeInstanceOf(Date);
    expect(f.emails.sendDeferredChargeFailedEmails).toHaveBeenCalledTimes(1);
  });

  it("ignores PaymentIntents that are not off-session deferred charges", async () => {
    const f = createFixture();
    const id = await f.bookFlexible();
    const event = intentEvent(
      "payment_intent.succeeded",
      id,
      "pi_checkout",
      100,
      {},
    );
    await f.runWebhook((manager, afterCommit) =>
      f.webhookService.handlePaymentIntentEvent(
        event as never,
        manager,
        afterCommit,
      ),
    );
    expect(f.reservation(id).payment_status).toBe("pending");
  });
});

describe("Fase 4 · regularization: pay from the panel or expire", () => {
  const failCharge = async (
    f: ReturnType<typeof createFixture>,
    id: number,
  ) => {
    f.stripe.paymentIntents.create.mockRejectedValueOnce(
      cardError("card_declined", "pi_declined"),
    );
    await f.deferred.chargeReservation(id, AFTER_CHARGE_AT);
  };

  it("payForTraveler opens a normal payment session; its completion pays without re-claiming nights", async () => {
    const f = createFixture();
    const id = await f.bookFlexible();
    await failCharge(f, id);
    f.sessions.retrieve.mockResolvedValue({
      id: "cs_1",
      status: "complete",
      mode: "setup",
      url: null,
      expires_at: Math.floor(Date.now() / 1000),
    });
    const now = new Date(AFTER_CHARGE_AT.getTime() + HOUR_MS);

    const pay = await f.payService.payForTraveler(TRAVELER, id, now);
    expect(pay).toMatchObject({
      checkout_url: "https://checkout.stripe.com/c/pay/cs_2",
      reused: false,
    });
    const [params, options] = f.sessions.create.mock.calls[1] as unknown as [
      Record<string, unknown>,
      { idempotencyKey: string },
    ];
    expect(params.mode).toBe("payment");
    expect(options.idempotencyKey).toBe(`checkout:${id}:retry:cs_1`);
    expect(params.expires_at).toBe(
      Math.floor(
        (f.reservation(id).regularization_deadline_at?.getTime() ?? 0) / 1000,
      ),
    );
    expect(f.reservation(id).stripe_checkout_session_id).toBe("cs_2");

    const total = f.reservation(id).total_cents ?? 0;
    await f.runWebhook((manager, afterCommit) =>
      f.webhookService.handleCheckoutCompleted(
        {
          id: "evt_reg_paid",
          type: "checkout.session.completed",
          data: {
            object: {
              id: "cs_2",
              mode: "payment",
              payment_status: "paid",
              payment_intent: "pi_reg",
              amount_total: total,
              metadata: { reservation_id: String(id) },
            },
          },
        } as never,
        manager,
        afterCommit,
      ),
    );
    expect(f.reservation(id)).toMatchObject({
      status: "confirmed",
      payment_status: "paid",
      payout_status: "held",
      stripe_payment_intent_id: "pi_reg",
      regularization_deadline_at: null,
    });
    expect(f.payments(id)).toHaveLength(1);
    expect(f.payments(id)[0]).toMatchObject({
      status: PAYMENT_STATUS.PAID,
      stripe_payment_intent_id: "pi_reg",
    });
    expect(f.stripe.refunds.create).not.toHaveBeenCalled();
    expect(f.emails.sendDeferredChargeSucceededEmail).toHaveBeenCalledTimes(1);
  });

  it("payForTraveler refuses after the regularization deadline", async () => {
    const f = createFixture();
    const id = await f.bookFlexible();
    await failCharge(f, id);
    const error: unknown = await f.payService
      .payForTraveler(
        TRAVELER,
        id,
        new Date(AFTER_CHARGE_AT.getTime() + 25 * HOUR_MS),
      )
      .catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(410);
  });

  it("expireRegularizations cancels, releases the nights and marks the payment definitive_unpaid", async () => {
    const f = createFixture();
    const id = await f.bookFlexible();
    await failCharge(f, id);

    await expect(
      f.deferred.expireRegularizations(
        new Date(AFTER_CHARGE_AT.getTime() + HOUR_MS),
      ),
    ).resolves.toEqual([]);
    const later = new Date(AFTER_CHARGE_AT.getTime() + 25 * HOUR_MS);
    await expect(f.deferred.expireRegularizations(later)).resolves.toEqual([
      id,
    ]);
    await expect(f.deferred.expireRegularizations(later)).resolves.toEqual([]);

    expect(f.reservation(id)).toMatchObject({
      status: "cancelled",
      payment_status: "pending",
      cancel_reason: "deferred_charge_unpaid",
    });
    expect(f.payments(id)[0].status).toBe(PAYMENT_STATUS.DEFINITIVE_UNPAID);
    expect(f.db.availability.every(night => night.is_available)).toBe(true);
    expect(f.emails.sendRegularizationExpiredEmails).toHaveBeenCalledTimes(1);
    expect(f.stripe.paymentMethods.detach).toHaveBeenCalledWith("pm_1");
  });
});

describe("Fase 4 · traveler cancellation of an unpaid flexible reservation", () => {
  const cancel = (f: ReturnType<typeof createFixture>, id: number) =>
    f.refundService.cancelByTraveler(id, {
      user_id: TRAVELER,
      cancellation_reason: "change_of_plans",
    } as never);

  afterEach(() => {
    vi.useRealTimers();
  });

  it("free period: cancels without any Stripe refund or charge and detaches the card", async () => {
    const f = createFixture();
    const id = await f.bookFlexible();

    const outcome = await cancel(f, id);

    expect(outcome.refundInitiated).toBe(false);
    expect(f.reservation(id)).toMatchObject({
      status: "cancelled",
      payment_status: "pending",
    });
    expect(f.payoutService.refundInTransaction).not.toHaveBeenCalled();
    expect(f.stripe.refunds.create).not.toHaveBeenCalled();
    expect(f.stripe.paymentIntents.create).not.toHaveBeenCalled();
    expect(f.stripe.paymentMethods.detach).toHaveBeenCalledWith("pm_1");
    expect(f.db.availability.every(night => night.is_available)).toBe(true);
    expect(f.emails.sendCancelledEmails).toHaveBeenCalledTimes(1);
  });

  it("in regularization: charges the penalty off-session (50 %)", async () => {
    const f = createFixture();
    const id = await f.bookFlexible();
    f.stripe.paymentIntents.create.mockRejectedValueOnce(
      cardError("card_declined", "pi_declined"),
    );
    await f.deferred.chargeReservation(id, AFTER_CHARGE_AT);
    const penaltyAttempt = f.payments(id)[0].attempts + 1;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(AFTER_CHARGE_AT.getTime() + HOUR_MS));
    f.stripe.paymentIntents.create.mockResolvedValueOnce({
      id: "pi_penalty",
      status: "succeeded",
    });
    const total = f.reservation(id).total_cents ?? 0;

    await cancel(f, id);

    const [params, options] = f.stripe.paymentIntents.create.mock
      .calls[1] as unknown as [
      { amount: number; metadata: Record<string, string> },
      { idempotencyKey: string },
    ];
    expect(params.amount).toBe(Math.round(total * 0.5));
    expect(params.metadata.purpose).toBe("cancellation_penalty");
    expect(options.idempotencyKey).toBe(
      `offsession-charge:${id}:${penaltyAttempt}`,
    );
    expect(f.reservation(id)).toMatchObject({
      status: "cancelled",
      payment_status: "paid",
      stripe_payment_intent_id: "pi_penalty",
      regularization_deadline_at: null,
    });
    expect(f.payments(id)[0]).toMatchObject({
      status: PAYMENT_STATUS.PAID,
      amount_cents: Math.round(total * 0.5),
    });
    expect(f.payoutService.refundInTransaction).not.toHaveBeenCalled();
    expect(
      f.incidentService.openChargeIssueIncidentInTransaction,
    ).not.toHaveBeenCalled();
    expect(f.db.availability.every(night => night.is_available)).toBe(true);
  });

  it("in regularization: penalty charge fails -> cancelled anyway, incident for V4P, card kept", async () => {
    const f = createFixture();
    const id = await f.bookFlexible();
    f.stripe.paymentIntents.create.mockRejectedValue(
      cardError("card_declined", "pi_declined"),
    );
    await f.deferred.chargeReservation(id, AFTER_CHARGE_AT);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(AFTER_CHARGE_AT.getTime() + HOUR_MS));

    const outcome = await cancel(f, id);

    expect(outcome.incidentId).toBe(900);
    expect(f.reservation(id)).toMatchObject({
      status: "cancelled",
      payment_status: "pending",
    });
    expect(f.payments(id)[0]).toMatchObject({
      status: PAYMENT_STATUS.FAILED,
      failure_code: "card_declined",
    });
    expect(
      f.incidentService.openChargeIssueIncidentInTransaction,
    ).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reservationId: id, userId: TRAVELER }),
    );
    expect(f.emails.sendDeferredPenaltyFailedAdminEmail).toHaveBeenCalledTimes(
      1,
    );
    expect(f.stripe.paymentMethods.detach).not.toHaveBeenCalled();
  });
});

describe("Fase 4 · date change of an unpaid flexible reservation", () => {
  const build = (settings: { deferred_min_lead_hours: number }) => {
    const saved: ReservationEntity[] = [];
    const manager = {
      getRepository: () => ({
        save: (row: ReservationEntity) => {
          saved.push(Object.assign(new ReservationEntity(), row));
          return Promise.resolve(row);
        },
      }),
    };
    const createSnapshot = vi.fn().mockResolvedValue({ version: 2 });
    const refundInTransaction = vi.fn();
    const service = new ReservationChangeApplyService(
      { moveNightsForChange: vi.fn(() => Promise.resolve()) } as never,
      { refundInTransaction } as never,
      {
        getPlatformSettings: vi.fn().mockResolvedValue({
          deadline_local_time: "18:00",
          ...settings,
        }),
        auditReservationChange: vi.fn(() => Promise.resolve()),
      } as never,
      { createSnapshot } as never,
      { addLines: vi.fn(() => Promise.resolve()) } as never,
      { logEventInTransaction: vi.fn(() => Promise.resolve()) } as never,
    );
    return { service, manager, saved, createSnapshot, refundInTransaction };
  };

  const flexibleReservation = () =>
    Object.assign(new ReservationEntity(), {
      id: 9,
      site_id: SITE_ID,
      room_id: ROOM_ID,
      checkin: CHECKIN,
      checkout: CHECKOUT,
      status: "confirmed",
      payment_status: "pending",
      charge_mode: "flexible",
      charge_at: new Date(CHARGE_AT),
      total_cents: 30_000,
      total: 300,
      timezone: "Europe/Madrid",
    });

  const offer = (checkin: string, totalCents: number) => ({
    target: {
      site_id: SITE_ID,
      room_id: ROOM_ID,
      checkin,
      checkout: "2099-06-25",
      guests: 2,
      pets: 1,
      board_option_id: null,
      board_snapshot: null,
      extras_snapshot: { services: [], extras: [] },
    },
    quote: {},
    site_name: null,
    snapshot: {
      total_cents: totalCents,
      currency: "eur",
      timezone: "Europe/Madrid",
      refund_policy: {
        cancellation: {
          policy_type: "free_cancellation",
          deadline_days: 7,
          penalty_type: "percent_50",
          no_show_policy: "same_as_cancellation",
          grace_after_booking_hours: null,
          early_cancellation_weeks: null,
        },
        deadline_local_time: "18:00",
        timezone: "Europe/Madrid",
        charge_mode: "flexible",
        charge_at: CHARGE_AT,
      },
    },
  });

  const apply = (
    f: ReturnType<typeof build>,
    reservation: ReservationEntity,
    checkin: string,
    delta: number,
    now: Date,
  ) =>
    f.service.applyInTransaction(f.manager as never, reservation, {
      kind: CHANGE_KIND.PROPOSAL,
      offerId: 1,
      requestId: 1,
      offer: offer(checkin, 30_000 + delta) as never,
      amountDeltaCents: delta,
      basedOnSnapshotVersion: 1,
      reason: "change_accepted",
      actor: { type: "traveler", id: TRAVELER } as never,
      now,
    });

  it("recomputes charge_at for the new check-in and updates the pending total, no refund", async () => {
    const f = build({ deferred_min_lead_hours: 48 });
    const reservation = flexibleReservation();
    const outcome = await apply(
      f,
      reservation,
      "2099-06-20",
      -5000,
      new Date("2099-04-01T10:00:00.000Z"),
    );
    expect(outcome.refundInitiated).toBe(false);
    expect(f.refundInTransaction).not.toHaveBeenCalled();
    // 13/06/2099 18:00 CEST = 16:00Z
    expect(reservation.charge_at.toISOString()).toBe(
      "2099-06-13T16:00:00.000Z",
    );
    expect(reservation.total_cents).toBe(25_000);
    expect(reservation.total).toBe(250);
    const payload = (
      f.createSnapshot.mock.calls[0] as unknown as [
        unknown,
        unknown,
        { refund_policy: { charge_at: string } },
      ]
    )[2];
    expect(payload.refund_policy.charge_at).toBe("2099-06-13T16:00:00.000Z");
  });

  it("new deadline already passed / under the lead time: charge_at = now (cron charges it)", async () => {
    const f = build({ deferred_min_lead_hours: 48 });
    const reservation = flexibleReservation();
    const now = new Date("2099-06-13T00:00:00.000Z");
    await apply(f, reservation, "2099-06-20", 0, now);
    expect(reservation.charge_at.toISOString()).toBe(now.toISOString());
    expect(f.refundInTransaction).not.toHaveBeenCalled();
  });
});

describe("Fase 4 · pure rules", () => {
  it("a confirmed flexible reservation blocks inventory; a pending one does not", () => {
    expect(
      isReservationBlockingInventory({
        status: "confirmed",
        payment_status: "pending",
        charge_mode: "flexible",
      }),
    ).toBe(true);
    expect(
      isReservationBlockingInventory({
        status: "pending",
        payment_status: "pending",
        charge_mode: "flexible",
      }),
    ).toBe(false);
  });

  it("change eligibility: flexible unpaid yes, in regularization no", () => {
    const now = new Date("2099-01-01T00:00:00.000Z");
    const base = {
      status: "confirmed" as const,
      payment_status: "pending" as const,
      checkin: CHECKIN,
      charge_mode: "flexible" as const,
    };
    expect(isChangeEligibleReservation(base, now)).toBe(true);
    expect(
      isChangeEligibleReservation(
        { ...base, regularization_deadline_at: new Date() },
        now,
      ),
    ).toBe(false);
    expect(
      isChangeEligibleReservation({ ...base, charge_mode: "immediate" }, now),
    ).toBe(false);
  });

  it("panel: confirmed while the charge is pending, payment pending (payable) in regularization", () => {
    const now = new Date("2099-05-04T00:00:00.000Z");
    const reservation = {
      status: "confirmed" as const,
      payment_status: "pending" as const,
      charge_mode: "flexible" as const,
      expiration_date: new Date(0),
      checkin: CHECKIN,
    };
    const flags = {
      has_open_dispute: false,
      has_pending_refund: false,
      has_open_incident: false,
    };
    expect(mapTravelerFacingStatus({ reservation, ...flags }).status).toBe(
      "confirmed",
    );
    expect(resolveTravelerPayability(reservation, now).can_pay).toBe(false);
    const deadline = new Date(now.getTime() + 2 * HOUR_MS);
    const inRegularization = {
      ...reservation,
      regularization_deadline_at: deadline,
    };
    expect(
      mapTravelerFacingStatus({ reservation: inRegularization, ...flags })
        .status,
    ).toBe("payment_pending");
    expect(resolveTravelerPayability(inRegularization, now)).toEqual({
      can_pay: true,
      pay_expires_at: deadline.toISOString(),
    });
  });

  it("cancellation quote of an unpaid flexible reservation: nothing paid, nothing refunded", () => {
    const reservation = Object.assign(new ReservationEntity(), {
      status: "confirmed",
      payment_status: "pending",
      charge_mode: "flexible",
      checkin: CHECKIN,
      checkout: CHECKOUT,
      total_cents: 30_000,
      created_at: new Date("2099-01-01T00:00:00.000Z"),
    });
    const snapshot = {
      stay: { checkin: CHECKIN },
      total_cents: 30_000,
      timezone: "Europe/Madrid",
      price_lines: [],
      refund_policy: {
        cancellation: offerPolicy(),
        deadline_local_time: "18:00",
        timezone: "Europe/Madrid",
      },
    };
    const inside = resolveTravelerCancellationQuote({
      reservation,
      snapshot: snapshot as never,
      reason: "change_of_plans",
      now: new Date("2099-04-01T00:00:00.000Z"),
    });
    expect(inside).toMatchObject({
      can_cancel: true,
      paid_cents: 0,
      penalty_cents: 0,
      refund_cents: 0,
      within_free_period: true,
    });
    const after = resolveTravelerCancellationQuote({
      reservation,
      snapshot: snapshot as never,
      reason: "change_of_plans",
      now: new Date("2099-05-05T00:00:00.000Z"),
    });
    expect(after).toMatchObject({
      paid_cents: 0,
      penalty_cents: 15_000,
      refund_cents: 0,
      within_free_period: false,
    });
  });
});

function offerPolicy() {
  return {
    policy_type: "free_cancellation",
    deadline_days: 7,
    penalty_type: "percent_50",
    no_show_policy: "same_as_cancellation",
    grace_after_booking_hours: null,
    early_cancellation_weeks: null,
  };
}

describe("Fase 5 · success page summary and cancel preview of a flexible reservation", () => {
  it("public summary exposes the frozen policy text and the deferred charge", async () => {
    const f = createFixture();
    const id = await f.bookFlexible();

    const summary = await f.reservationService.getPublicSummary(id, "cs_1");

    expect(summary).toMatchObject({
      id,
      status: "confirmed",
      payment_status: "pending",
      charge_mode: "flexible",
      charge_at_iso: CHARGE_AT,
      timezone: "Europe/Madrid",
    });
    expect(summary.policy_text).toEqual(expect.any(String));
    expect(summary.policy_text).not.toBe("");
  });

  it("public summary drops charge_at once the deferred charge is paid", async () => {
    const f = createFixture();
    const id = await f.bookFlexible();
    f.stripe.paymentIntents.create.mockResolvedValue({
      id: "pi_ok",
      status: "succeeded",
    });
    await f.deferred.chargeReservation(id, AFTER_CHARGE_AT);

    const summary = await f.reservationService.getPublicSummary(id, "cs_1");

    expect(summary.payment_status).toBe("paid");
    expect(summary.charge_mode).toBe("flexible");
    expect(summary.charge_at_iso).toBeNull();
  });

  it("cancel preview inside the free period: charge pending, nothing charged", async () => {
    const f = createFixture();
    const id = await f.bookFlexible();

    const preview = await f.refundService.previewTravelerCancellation(
      TRAVELER,
      id,
      "change_of_plans",
    );

    expect(preview).toMatchObject({
      can_cancel: true,
      charge_pending: true,
      paid_cents: 0,
      penalty_cents: 0,
      refund_cents: 0,
      within_free_period: true,
    });
  });

  it("cancel preview after the deadline: penalty_cents is what will be charged", async () => {
    const f = createFixture();
    const id = await f.bookFlexible();
    const total = f.reservation(id).total_cents ?? 0;

    const preview = await f.refundService.previewTravelerCancellation(
      TRAVELER,
      id,
      "change_of_plans",
      AFTER_CHARGE_AT,
    );

    expect(preview).toMatchObject({
      charge_pending: true,
      paid_cents: 0,
      refund_cents: 0,
      within_free_period: false,
    });
    expect(preview.penalty_cents).toBe(Math.round(total * 0.5));
  });
});
