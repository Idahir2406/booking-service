import type { EntityManager } from "typeorm";
import type {
  BookResult,
  CancelResult,
} from "@/src/contexts/providers/domain/provider.types";

import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";

import { createEconomics } from "@/tests/utils/economics";
import { FakeReservationDb } from "@/tests/utils/fake-reservation-db";

import { readCancellationRecord } from "@/src/contexts/provider-reservations/domain/provider-cancellation";
import { PROVIDER_CANCELLED_BY_HOTEL_REASON } from "@/src/contexts/provider-reservations/domain/provider-reservation.types";
import { ProviderWebhookEventEntity } from "@/src/contexts/provider-reservations/entities/provider-webhook-event.entity";
import { ProviderCancellationService } from "@/src/contexts/provider-reservations/services/provider-cancellation.service";
import { ProviderWebhookService } from "@/src/contexts/provider-reservations/services/provider-webhook.service";
import {
  ProviderTransientError,
  ProviderUnavailableError,
} from "@/src/contexts/providers/domain/provider.errors";
import { ProviderOfferEntity } from "@/src/contexts/providers/entities/provider-offer.entity";
import { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";
import { ProviderCancellationBridge } from "@/src/contexts/reservations/services/provider-cancellation.bridge";
import { envs } from "@/src/contexts/shared/configs/envs";

const TOTAL = 23_000;
const BEFORE_DEADLINE = new Date("2027-06-02T00:00:00Z");
const AFTER_DEADLINE = new Date("2027-06-06T00:00:00Z");

function bookResult(overrides: Partial<BookResult> = {}): BookResult {
  return {
    bookingId: "BK-1",
    clientReference: "V4P-1",
    status: "CONFIRMED",
    rawStatus: "CONFIRMED",
    hotelConfirmationCode: "HC",
    supplierBookingId: null,
    hotelId: "lp42",
    checkin: "2027-06-10",
    checkout: "2027-06-12",
    totalCents: 20_000,
    currency: "EUR",
    cancellationPolicies: [],
    raw: {},
    ...overrides,
  };
}

function cancelResult(overrides: Partial<CancelResult> = {}): CancelResult {
  return {
    bookingId: "BK-1",
    status: "CANCELLED",
    rawStatus: "CANCELLED",
    penaltyCents: 0,
    refundCents: 20_000,
    currency: "EUR",
    raw: {},
    ...overrides,
  };
}

const createFixture = (
  reservationOverrides: Partial<ReservationEntity> = {},
) => {
  const db = new FakeReservationDb();
  const { economics } = createEconomics(db.store);
  db.seedReservation(
    Object.assign(new ReservationEntity(), {
      id: 1,
      site_id: 42,
      room_id: 0,
      user_id: 7,
      source: "nuitee",
      status: "confirmed",
      payment_status: "paid",
      provider_status: "confirmed",
      external_reservation_id: "BK-1",
      client_reference: "V4P-1",
      stripe_payment_intent_id: "pi_1",
      total_cents: TOTAL,
      currency: "EUR",
      commission_rate: 0.15,
      amount_refunded: null,
      refund_seq: 0,
      checkin: "2027-06-10",
      checkout: "2027-06-12",
      timezone: "Europe/Madrid",
      provider_booking_json: { version: 1, holder: { firstName: "Ana" } },
      ...reservationOverrides,
    }),
  );
  const offerRepository = db.store.repository(ProviderOfferEntity);
  void offerRepository.save({
    reservation_id: 1,
    provider: "nuitee",
    offer_id: "offer-1",
    net_cents: 20_000,
    sell_cents: TOTAL,
    markup_cents: 3000,
    markup_rate: 0.15,
    currency: "EUR",
    refundable: true,
    cancellation_json: [
      {
        deadline: "2027-06-05T00:00:00.000Z",
        amountCents: 10_000,
        currency: "EUR",
        timezone: null,
      },
    ],
    taxes_not_included_json: [],
  });
  const reservationRepo = db.manager().getRepository(ReservationEntity);
  const reservationRepository = {
    findOne: reservationRepo.findOne.bind(reservationRepo),
    manager: {
      transaction: <T>(run: (manager: EntityManager) => Promise<T>) =>
        db.transaction(run),
    },
  };
  const provider = {
    name: "nuitee",
    cancel: vi.fn<[string], Promise<CancelResult>>(() =>
      Promise.resolve(cancelResult()),
    ),
    getBooking: vi.fn<[string], Promise<BookResult>>(() =>
      Promise.resolve(bookResult()),
    ),
  };
  const registry = { get: () => provider };
  const payout = {
    refundInTransaction: vi.fn(
      (_manager: unknown, reservation: ReservationEntity, amount: number) => {
        const refunded =
          Math.round(Number(reservation.amount_refunded ?? 0) * 100) + amount;
        reservation.refund_seq += 1;
        reservation.amount_refunded = refunded / 100;
        reservation.payment_status =
          refunded < TOTAL ? "partially_refunded" : "refunded";
        return Promise.resolve({
          refundId: "re_1",
          isPartial: refunded < TOTAL,
        });
      },
    ),
  };
  const events = {
    logEventInTransaction: vi.fn(() => Promise.resolve()),
    logEvent: vi.fn(() => Promise.resolve()),
  };
  const incidents = { openOnce: vi.fn(() => Promise.resolve({ id: 99 })) };
  const notifier = {
    sendCancelled: vi.fn(() => Promise.resolve()),
    alertAdmin: vi.fn(() => Promise.resolve()),
  };
  const bridge = new ProviderCancellationBridge();
  const service = new ProviderCancellationService(
    reservationRepository as never,
    offerRepository as never,
    registry as never,
    payout as never,
    economics,
    events as never,
    incidents as never,
    notifier as never,
    bridge,
  );
  service.onModuleInit();
  const reservation = () => db.reservations.get(1);
  const row = (): ReservationEntity => {
    const found = db.reservations.get(1);
    if (!found) {
      throw new Error("reservation 1 missing");
    }
    return found;
  };
  const traveler = (now: Date) =>
    service.cancel(
      1,
      {
        initiator: "traveler",
        reason: "change_of_plans",
        notes: null,
        actorId: 7,
        actor: { type: "traveler", id: "7" } as never,
        waivePenalty: false,
      },
      now,
    );
  return {
    db,
    service,
    bridge,
    provider,
    payout,
    incidents,
    notifier,
    reservation,
    row,
    traveler,
    reservationRepo,
  };
};

describe("ProviderCancellationService.cancel", () => {
  it("free period: provider cancels, full refund, reservation closed", async () => {
    const fx = createFixture();

    const result = await fx.traveler(BEFORE_DEADLINE);

    expect(fx.provider.cancel).toHaveBeenCalledWith("BK-1");
    expect(result).toMatchObject({
      outcome: "cancelled",
      penalty_cents: 0,
      refund_cents: TOTAL,
      refund_initiated: true,
    });
    expect(fx.payout.refundInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 1 }),
      TOTAL,
      "provider_cancel:traveler",
      expect.objectContaining({ responsible: "traveler" }),
    );
    expect(fx.reservation()).toMatchObject({
      status: "cancelled",
      provider_status: "cancelled",
      payment_status: "refunded",
      cancel_reason: "change_of_plans",
      refund_on_cancel: true,
    });
    expect(
      readCancellationRecord(fx.reservation()?.provider_booking_json),
    ).toMatchObject({
      status: "cancelled",
      penalty_cents: 0,
      refund_cents: TOTAL,
    });
    expect(fx.notifier.sendCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      true,
    );
  });

  it("CANCELLED_WITH_CHARGES: real provider penalty scaled with the markup", async () => {
    const fx = createFixture();
    fx.provider.cancel.mockResolvedValueOnce(
      cancelResult({ status: "CANCELLED_WITH_CHARGES", penaltyCents: 10_000 }),
    );

    const result = await fx.traveler(AFTER_DEADLINE);

    expect(result).toMatchObject({
      penalty_cents: 11_500,
      refund_cents: 11_500,
    });
    expect(fx.payout.refundInTransaction.mock.calls[0]?.[2]).toBe(11_500);
    expect(fx.reservation()?.payment_status).toBe("partially_refunded");
  });

  it("without a provider penalty uses the frozen policy", async () => {
    const fx = createFixture();
    fx.provider.cancel.mockResolvedValueOnce(
      cancelResult({ penaltyCents: null }),
    );

    const result = await fx.traveler(AFTER_DEADLINE);

    expect(result.penalty_cents).toBe(11_500);
    expect(result.refund_cents).toBe(11_500);
  });

  it("PENDING_UNKNOWN: nothing refunded until getBooking says CANCELLED", async () => {
    const fx = createFixture();
    fx.provider.cancel.mockResolvedValueOnce(
      cancelResult({ status: "PENDING_UNKNOWN", rawStatus: "PENDING" }),
    );

    const pending = await fx.traveler(BEFORE_DEADLINE);

    expect(pending.outcome).toBe("pending");
    expect(fx.payout.refundInTransaction).not.toHaveBeenCalled();
    expect(fx.reservation()?.status).toBe("confirmed");
    expect(
      readCancellationRecord(fx.reservation()?.provider_booking_json)?.status,
    ).toBe("pending");

    // A second click while pending is idempotent (no second provider call).
    const again = await fx.traveler(BEFORE_DEADLINE);
    expect(again.outcome).toBe("pending");
    expect(fx.provider.cancel).toHaveBeenCalledTimes(1);

    // Still confirmed at the provider: keep waiting.
    const later = new Date(BEFORE_DEADLINE.getTime() + 20 * 60_000);
    const waiting = await fx.service.resolvePendingCancellation(1, later);
    expect(waiting.outcome).toBe("pending");

    // Cron after the deadline: penalty evaluated at request time (free).
    fx.provider.getBooking.mockResolvedValueOnce(
      bookResult({ status: "CANCELLED", rawStatus: "CANCELLED" }),
    );
    const done = await fx.service.resolvePendingCancellation(1, AFTER_DEADLINE);
    expect(done).toMatchObject({ outcome: "cancelled", refund_cents: TOTAL });
    expect(fx.reservation()?.status).toBe("cancelled");
  });

  it("provider error: no refund, claim released, error surfaced", async () => {
    const fx = createFixture();
    fx.provider.cancel.mockRejectedValueOnce(
      new ProviderUnavailableError({
        provider: "nuitee",
        message: "cannot cancel",
        code: "4002",
      }),
    );

    await expect(fx.traveler(BEFORE_DEADLINE)).rejects.toMatchObject({
      status: 502,
    });
    expect(fx.payout.refundInTransaction).not.toHaveBeenCalled();
    expect(fx.reservation()).toMatchObject({
      status: "confirmed",
      provider_status: "confirmed",
      payment_status: "paid",
    });
    expect(
      readCancellationRecord(fx.reservation()?.provider_booking_json),
    ).toBeNull();
  });

  it("timeout: may have reached the provider -> pending, no refund", async () => {
    const fx = createFixture();
    fx.provider.cancel.mockRejectedValueOnce(
      new ProviderTransientError({
        provider: "nuitee",
        message: "timeout",
        timedOut: true,
      }),
    );

    const result = await fx.traveler(BEFORE_DEADLINE);

    expect(result.outcome).toBe("pending");
    expect(fx.payout.refundInTransaction).not.toHaveBeenCalled();
  });

  it("refund failure after the provider cancelled: pending + admin alert, retried", async () => {
    const fx = createFixture();
    fx.payout.refundInTransaction.mockRejectedValueOnce(
      new Error("stripe down"),
    );

    const result = await fx.traveler(BEFORE_DEADLINE);

    expect(result).toMatchObject({
      outcome: "pending",
      reason: "refund_failed",
    });
    expect(fx.reservation()?.status).toBe("confirmed");
    expect(fx.notifier.alertAdmin).toHaveBeenCalled();

    fx.provider.getBooking.mockResolvedValueOnce(
      bookResult({ status: "CANCELLED" }),
    );
    const retried = await fx.service.resolvePendingCancellation(
      1,
      AFTER_DEADLINE,
    );
    expect(retried.outcome).toBe("cancelled");
    expect(fx.reservation()?.payment_status).toBe("refunded");
  });

  it("refuses while the stay started or the book is in progress", async () => {
    const started = createFixture({ checkin: "2027-06-02" });
    await expect(
      started.traveler(new Date("2027-06-02T10:00:00Z")),
    ).rejects.toMatchObject({ status: 400 });

    const booking = createFixture({
      status: "pending",
      payment_status: "pending",
      provider_status: "booking",
    });
    await expect(booking.traveler(BEFORE_DEADLINE)).rejects.toMatchObject({
      status: 400,
    });
    expect(booking.provider.cancel).not.toHaveBeenCalled();
  });

  it("unpaid pending reservation is cancelled locally", async () => {
    const fx = createFixture({
      status: "pending",
      payment_status: "pending",
      provider_status: "prebooked",
      stripe_payment_intent_id: undefined,
      external_reservation_id: undefined,
    });

    const result = await fx.traveler(BEFORE_DEADLINE);

    expect(result.outcome).toBe("cancelled");
    expect(fx.provider.cancel).not.toHaveBeenCalled();
    expect(fx.reservation()).toMatchObject({
      status: "cancelled",
      provider_status: "cancelled",
    });
  });

  it("admin waiver refunds everything even with provider charges", async () => {
    const fx = createFixture();
    fx.provider.cancel.mockResolvedValueOnce(
      cancelResult({ status: "CANCELLED_WITH_CHARGES", penaltyCents: 10_000 }),
    );

    const result = await fx.service.cancelByAdmin(1, {
      waivePenalty: true,
      notes: "courtesy",
      adminId: 3,
    });

    expect(result).toMatchObject({ penalty_cents: 0, refund_cents: TOTAL });
    expect(fx.reservation()?.cancel_reason).toBe("admin_cancelled");
  });
});

describe("ProviderCancellationService traveler bridge", () => {
  it("registers itself and previews with the provider policy", async () => {
    const fx = createFixture();
    expect(fx.bridge.get()).toBe(fx.service);
    const reservation = fx.row();

    const preview = await fx.service.previewTravelerCancellation(
      reservation,
      "change_of_plans",
      AFTER_DEADLINE,
    );

    expect(preview).toMatchObject({
      can_cancel: true,
      source: "provider",
      paid_cents: TOTAL,
      penalty_cents: 11_500,
      refund_cents: 11_500,
      releases_inventory: false,
      requires_review: false,
      currency: "EUR",
    });
    expect(preview.policy_text).toContain("Cancelación gratuita hasta");
    expect(fx.provider.cancel).not.toHaveBeenCalled();
  });
});

describe("hotel cancellation (provider initiated)", () => {
  it("refunds 100 %, opens an incident and alerts V4P", async () => {
    const fx = createFixture();

    const result = await fx.service.handleProviderCancelled(
      1,
      "CANCELLED",
      "webhook:booking.cancelled",
    );

    expect(result).toMatchObject({ outcome: "cancelled", refund_cents: TOTAL });
    expect(fx.reservation()).toMatchObject({
      status: "cancelled",
      cancel_reason: PROVIDER_CANCELLED_BY_HOTEL_REASON,
      payment_status: "refunded",
    });
    expect(fx.payout.refundInTransaction.mock.calls[0]?.[4]).toMatchObject({
      responsible: "platform",
    });
    expect(fx.incidents.openOnce).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: 1, key: "hotel_cancelled" }),
      expect.anything(),
    );
    expect(fx.notifier.alertAdmin).toHaveBeenCalled();
    expect(fx.notifier.sendCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      true,
    );

    // Replays are no-ops.
    const again = await fx.service.handleProviderCancelled(1, "CANCELLED", "x");
    expect(again.outcome).toBe("noop");
    expect(fx.payout.refundInTransaction).toHaveBeenCalledTimes(1);
  });
});

const createWebhook = () => {
  const fx = createFixture();
  const bookingService = {
    resolvePending: vi.fn(() => Promise.resolve({ outcome: "confirmed" })),
  };
  const eventRepository = fx.db.store.repository(ProviderWebhookEventEntity);
  const webhook = new ProviderWebhookService(
    eventRepository as never,
    fx.reservationRepo as never,
    { get: () => fx.provider } as never,
    bookingService as never,
    fx.service,
  );
  const events = () => fx.db.store.rows(ProviderWebhookEventEntity);
  return { fx, webhook, bookingService, events };
};

describe("ProviderWebhookService", () => {
  const SECRET = "whsec_nuitee";
  const originalSecret = envs.NUITEE_WEBHOOK_SECRET;

  afterEach(() => {
    Object.assign(envs, { NUITEE_WEBHOOK_SECRET: originalSecret });
  });

  const body = Buffer.from(
    JSON.stringify({
      event: "booking.cancelled",
      id: "evt_1",
      data: { bookingId: "BK-1", price: 1 },
    }),
  );
  const signature = createHmac("sha256", SECRET).update(body).digest("hex");

  it("rejects a bad signature without recording anything", async () => {
    Object.assign(envs, { NUITEE_WEBHOOK_SECRET: SECRET });
    const { webhook, events } = createWebhook();

    await expect(
      webhook.handle({
        rawBody: body,
        headers: { "x-liteapi-signature": "deadbeef" },
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(events()).toHaveLength(0);
  });

  it("hotel cancellation: re-reads the booking, refunds once, dedupes replays", async () => {
    Object.assign(envs, { NUITEE_WEBHOOK_SECRET: SECRET });
    const { fx, webhook, events } = createWebhook();
    fx.provider.getBooking.mockResolvedValue(
      bookResult({ status: "CANCELLED", rawStatus: "CANCELLED" }),
    );

    const first = await webhook.handle({
      rawBody: body,
      headers: { "x-signature": signature },
    });
    const second = await webhook.handle({
      rawBody: body,
      headers: { "x-signature": signature },
    });

    expect(first).toMatchObject({ duplicate: false, status: "processed" });
    expect(second.duplicate).toBe(true);
    expect(fx.provider.getBooking).toHaveBeenCalledWith("BK-1");
    expect(fx.payout.refundInTransaction).toHaveBeenCalledTimes(1);
    expect(fx.payout.refundInTransaction.mock.calls[0]?.[2]).toBe(TOTAL);
    expect(fx.reservation()?.cancel_reason).toBe(
      PROVIDER_CANCELLED_BY_HOTEL_REASON,
    );
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({
      status: "processed",
      reservation_id: 1,
      signature_verified: true,
    });
  });

  it("unsigned (no secret): never trusts the payload, acts on getBooking", async () => {
    Object.assign(envs, { NUITEE_WEBHOOK_SECRET: undefined });
    const { fx, webhook } = createWebhook();
    // Payload says cancelled, the provider says confirmed.
    fx.provider.getBooking.mockResolvedValue(bookResult());

    const result = await webhook.handle({ rawBody: body, headers: {} });

    expect(result.action).toBe("no_change:CONFIRMED");
    expect(fx.payout.refundInTransaction).not.toHaveBeenCalled();
    expect(fx.reservation()?.status).toBe("confirmed");
  });

  it("booking still in progress: delegates to resolvePending", async () => {
    Object.assign(envs, { NUITEE_WEBHOOK_SECRET: undefined });
    const { fx, webhook, bookingService } = createWebhook();
    await fx.reservationRepo.save(
      Object.assign(fx.row(), {
        status: "pending",
        provider_status: "booking",
        external_reservation_id: undefined,
      }),
    );
    const confirmBody = Buffer.from(
      JSON.stringify({ type: "booking.confirmed", clientReference: "V4P-1" }),
    );

    const result = await webhook.handle({ rawBody: confirmBody, headers: {} });

    expect(bookingService.resolvePending).toHaveBeenCalledWith(1);
    expect(result.action).toBe("resolve_pending:confirmed");
  });

  it("marks the event failed and rethrows when the provider is down", async () => {
    Object.assign(envs, { NUITEE_WEBHOOK_SECRET: undefined });
    const { fx, webhook, events } = createWebhook();
    fx.provider.getBooking.mockRejectedValueOnce(new Error("503"));

    await expect(
      webhook.handle({ rawBody: body, headers: {} }),
    ).rejects.toThrow("503");
    expect(events()[0]).toMatchObject({ status: "failed", attempts: 1 });

    // The provider retries: the failed row is processed again.
    const retry = await webhook.handle({ rawBody: body, headers: {} });
    expect(retry.duplicate).toBe(false);
    expect(events()[0]?.attempts).toBe(2);
  });
});
