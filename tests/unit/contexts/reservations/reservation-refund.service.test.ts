import type { ReservationSnapshotPayload } from "@/src/contexts/payments/domain/reservation-snapshot";

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { vi } from "vitest";

import { FakeEntityStore } from "@/tests/utils/fake-entity-store";

import { RefundEntity } from "@/src/contexts/payments/entities/refund.entity";
import { TravelerCancelReservationDto } from "@/src/contexts/reservations/dto/traveler-cancel-reservation.dto";
import { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";
import { ReservationDisputeEntity } from "@/src/contexts/reservations/entities/reservation-dispute.entity";
import { ReservationIncidentEntity } from "@/src/contexts/reservations/entities/reservation-incident.entity";
import { ReservationIncidentAttachmentEntity } from "@/src/contexts/reservations/entities/reservation-incident-attachment.entity";
import { ReservationIncidentMessageEntity } from "@/src/contexts/reservations/entities/reservation-incident-message.entity";
import { ReservationIncidentService } from "@/src/contexts/reservations/services/reservation-incident.service";
import { ReservationRefundService } from "@/src/contexts/reservations/services/reservation-refund.service";

const OWNER = 10;
const FUTURE_CHECKIN = "2099-08-10";
const FUTURE_CHECKOUT = "2099-08-14";

interface FixtureOptions {
  snapshot?: ReservationSnapshotPayload | null;
}

const createFixture = (options: FixtureOptions = {}) => {
  const store = new FakeEntityStore();
  const manager = {
    getRepository: (entity: abstract new () => object) =>
      store.repository(entity),
  };
  const reservationRepository = {
    ...store.repository(ReservationEntity),
    manager: {
      transaction: <T>(work: (m: typeof manager) => Promise<T>) =>
        work(manager),
    },
  };
  const reservationService = {
    releaseAvailabilityForReservation: vi.fn(() => Promise.resolve()),
    getSiteById: vi.fn().mockResolvedValue({ id: 42 }),
  };
  const payoutService = {
    refundInTransaction: vi.fn().mockResolvedValue({ refundId: 5 }),
  };
  const emails = {
    sendCancelledEmails: vi.fn(() => Promise.resolve()),
    sendForceMajeureReviewAdminEmail: vi.fn(() => Promise.resolve()),
  };
  const events = {
    logEventInTransaction: vi.fn<
      [unknown, number, string, unknown],
      Promise<void>
    >(() => Promise.resolve()),
  };
  const economics = {
    recordPaymentFailed: vi.fn(() => Promise.resolve()),
    recordRefundPending: vi.fn().mockResolvedValue({ id: 77 }),
  };
  const snapshotPayload = options.snapshot ?? null;
  const snapshots = {
    findVersion: vi
      .fn()
      .mockResolvedValue(snapshotPayload ? { payload: snapshotPayload } : null),
    findLatest: vi
      .fn()
      .mockResolvedValue(snapshotPayload ? { payload: snapshotPayload } : null),
  };
  const stripe = { refundPaymentIntent: vi.fn() };
  // Real incident service over the same store (F-PV7a force_majeure link).
  const incidentService = new ReservationIncidentService(
    reservationRepository as never,
    store.repository(ReservationIncidentEntity) as never,
    store.repository(ReservationIncidentAttachmentEntity) as never,
    store.repository(ReservationIncidentMessageEntity) as never,
    economics as never,
    events as never,
    emails as never,
    reservationService as never,
    { notifyMessage: vi.fn(() => Promise.resolve()) } as never,
  );

  const service = new ReservationRefundService(
    reservationRepository as never,
    store.repository(RefundEntity) as never,
    store.repository(ReservationDisputeEntity) as never,
    reservationService as never,
    payoutService as never,
    emails as never,
    events as never,
    economics as never,
    snapshots as never,
    stripe as never,
    incidentService,
  );

  const addReservation = async (overrides: Partial<ReservationEntity> = {}) =>
    (await store.repository(ReservationEntity).save({
      site_id: 42,
      room_id: 3,
      user_id: OWNER,
      checkin: FUTURE_CHECKIN,
      checkout: FUTURE_CHECKOUT,
      status: "confirmed",
      payment_status: "paid",
      payout_status: "held",
      total_cents: 32_450,
      subtotal: 300,
      commission: 24.5,
      amount_refunded: null,
      refund_seq: 0,
      stripe_payment_intent_id: "pi_test",
      snapshot_version: 1,
      created_at: new Date("2099-01-01T10:00:00.000Z"),
      ...overrides,
    })) as unknown as ReservationEntity;

  const stored = (id: number) =>
    store.rows(ReservationEntity).find(row => row.id === id);

  return {
    store,
    service,
    addReservation,
    stored,
    reservationService,
    payoutService,
    emails,
    events,
    economics,
    stripe,
  };
};

const snapshotWithDeadline = (
  refundDeadline: string,
  extra: Partial<ReservationSnapshotPayload["refund_policy"]> = {},
): ReservationSnapshotPayload =>
  ({
    schema: 1,
    stay: {
      site_id: 42,
      checkin: FUTURE_CHECKIN,
      checkout: FUTURE_CHECKOUT,
      nights: 4,
      guests: 2,
      pets: 1,
    },
    room: null,
    board: null,
    currency: "EUR",
    total_cents: 32_450,
    price_lines: [
      {
        type: "accommodation",
        description: "Alojamiento",
        quantity: 4,
        unit_amount_cents: 7500,
        amount_cents: 30_000,
        is_optional: false,
        is_commissionable: true,
        is_penalizable: true,
      },
    ],
    totals: {
      total_cents: 32_450,
      commissionable_cents: 30_000,
      penalizable_cents: 30_000,
      optional_cents: 0,
      non_commissionable_cents: 2450,
    },
    commission: {
      rate: null,
      cents: null,
      base: "total",
      commissionable_cents: 30_000,
      penalizable_cents: 30_000,
    },
    refund_policy: {
      rule: "legacy_host_full_refund_until_24h_before_checkin",
      window_hours: 24,
      refund_deadline: refundDeadline,
      deadline_local_time: null,
      timezone: null,
      ...extra,
    },
    timezone: "Europe/Madrid",
    source: "checkout",
  }) as ReservationSnapshotPayload;

/**
 * Characterization of cancelByTraveler (legacy 24 h branch). Written against
 * the pre-F-PV4 implementation and kept green after the refactor that makes
 * it share the quote resolver with the preview: the amounts MUST NOT change.
 */
describe("ReservationRefundService.cancelByTraveler (legacy characterization)", () => {
  it("pending unpaid reservation: cancels without refund and records payment failed", async () => {
    const f = createFixture();
    const reservation = await f.addReservation({
      status: "pending",
      payment_status: "pending",
    });

    const outcome = await f.service.cancelByTraveler(reservation.id, {
      user_id: OWNER,
      cancellation_reason: "voluntary",
    });

    expect(outcome.refundInitiated).toBe(false);
    expect(outcome.refundPendingReview).toBe(false);
    expect(f.stored(reservation.id)?.status).toBe("cancelled");
    expect(f.stored(reservation.id)?.cancel_reason).toBe("voluntary");
    expect(f.stored(reservation.id)?.refund_on_cancel).toBe(false);
    expect(f.economics.recordPaymentFailed).toHaveBeenCalledWith(
      expect.anything(),
      reservation.id,
      "cancelled_by_traveler",
      expect.anything(),
    );
    expect(f.payoutService.refundInTransaction).not.toHaveBeenCalled();
    expect(
      f.reservationService.releaseAvailabilityForReservation,
    ).toHaveBeenCalledTimes(1);
  });

  it("paid reservation inside the 24 h window refunds the full charge (total_cents)", async () => {
    const f = createFixture();
    const reservation = await f.addReservation();

    const outcome = await f.service.cancelByTraveler(reservation.id, {
      user_id: OWNER,
      cancellation_reason: "voluntary",
    });

    expect(outcome.refundInitiated).toBe(true);
    expect(f.payoutService.refundInTransaction).toHaveBeenCalledTimes(1);
    const call = f.payoutService.refundInTransaction.mock.calls[0];
    const amount: unknown = call[2];
    const reason: unknown = call[3];
    expect(amount).toBe(32_450);
    expect(reason).toBe("traveler_cancel:voluntary");
    expect(f.stored(reservation.id)?.status).toBe("cancelled");
    expect(f.stored(reservation.id)?.refund_on_cancel).toBe(true);
    expect(f.emails.sendCancelledEmails).toHaveBeenCalledTimes(1);
  });

  it("legacy row without total_cents refunds round((subtotal + commission) x 100)", async () => {
    const f = createFixture();
    const reservation = await f.addReservation({
      total_cents: null,
      subtotal: 199.99,
      commission: 15.01,
    });

    await f.service.cancelByTraveler(reservation.id, {
      user_id: OWNER,
      cancellation_reason: "illness_pet",
    });

    expect(f.payoutService.refundInTransaction.mock.calls[0][2]).toBe(21_500);
    expect(f.payoutService.refundInTransaction.mock.calls[0][3]).toBe(
      "traveler_cancel:illness_pet",
    );
  });

  it("uses the frozen snapshot deadline: past it, cancels with no refund", async () => {
    const f = createFixture({
      snapshot: snapshotWithDeadline("2020-01-01T00:00:00.000Z"),
    });
    const reservation = await f.addReservation();

    const outcome = await f.service.cancelByTraveler(reservation.id, {
      user_id: OWNER,
      cancellation_reason: "voluntary",
    });

    expect(outcome.refundInitiated).toBe(false);
    expect(outcome.refundPendingReview).toBe(false);
    expect(f.payoutService.refundInTransaction).not.toHaveBeenCalled();
    expect(f.stored(reservation.id)?.status).toBe("cancelled");
    expect(f.stored(reservation.id)?.refund_on_cancel).toBe(false);
    expect(
      f.reservationService.releaseAvailabilityForReservation,
    ).toHaveBeenCalledTimes(1);
  });

  it("snapshot deadline still open refunds the full charge", async () => {
    const f = createFixture({
      snapshot: snapshotWithDeadline("2099-08-09T00:00:00.000Z"),
    });
    const reservation = await f.addReservation();

    await f.service.cancelByTraveler(reservation.id, {
      user_id: OWNER,
      cancellation_reason: "death_person",
    });

    expect(f.payoutService.refundInTransaction.mock.calls[0][2]).toBe(32_450);
  });

  it("force_majeure: pending refund for the full charge + open dispute, no Stripe call", async () => {
    const f = createFixture({
      snapshot: snapshotWithDeadline("2020-01-01T00:00:00.000Z"),
    });
    const reservation = await f.addReservation();

    const outcome = await f.service.cancelByTraveler(reservation.id, {
      user_id: OWNER,
      cancellation_reason: "force_majeure",
      notes: "Inundación en la carretera de acceso",
    });

    expect(outcome.refundPendingReview).toBe(true);
    expect(outcome.refundInitiated).toBe(false);
    expect(outcome.refundId).toBe(77);
    expect(f.economics.recordRefundPending).toHaveBeenCalledTimes(1);
    const [, pending] = f.economics.recordRefundPending.mock.calls[0];
    expect(pending.amountCents).toBe(32_450);
    expect(pending.reason).toBe("traveler_force_majeure:force_majeure");
    expect(f.payoutService.refundInTransaction).not.toHaveBeenCalled();
    expect(f.stripe.refundPaymentIntent).not.toHaveBeenCalled();
    const disputes = f.store.rows(ReservationDisputeEntity);
    expect(disputes).toHaveLength(1);
    expect(disputes[0].status).toBe("open");
    expect(disputes[0].source).toBe("guest_report");
    expect(f.emails.sendForceMajeureReviewAdminEmail).toHaveBeenCalledTimes(1);
    expect(f.stored(reservation.id)?.refund_on_cancel).toBe(false);
  });

  it("F-PV7a: force_majeure links an in_review incident to its dispute (no payout change)", async () => {
    const f = createFixture({
      snapshot: snapshotWithDeadline("2099-08-09T00:00:00.000Z"),
    });
    const reservation = await f.addReservation();

    const outcome = await f.service.cancelByTraveler(reservation.id, {
      user_id: OWNER,
      cancellation_reason: "force_majeure",
      notes: "Hospitalización urgente del titular",
    });

    const [dispute] = f.store.rows(ReservationDisputeEntity);
    const incidents = f.store.rows(ReservationIncidentEntity);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      reservation_id: reservation.id,
      user_id: OWNER,
      type: "force_majeure_cancellation",
      status: "in_review",
      dispute_id: dispute.id,
      blocks_payout: false,
      description: "Hospitalización urgente del titular",
    });
    expect(outcome.incidentId).toBe(incidents[0].id);
    expect(f.stored(reservation.id)?.payout_status).toBe("held");
    expect(
      f.events.logEventInTransaction.mock.calls.some(
        call => call[2] === "incident_opened",
      ),
    ).toBe(true);
  });

  it("F-PV7a: a non force_majeure cancellation creates no incident", async () => {
    const f = createFixture({
      snapshot: snapshotWithDeadline("2099-08-09T00:00:00.000Z"),
    });
    const reservation = await f.addReservation();
    const outcome = await f.service.cancelByTraveler(reservation.id, {
      user_id: OWNER,
      cancellation_reason: "illness_pet",
    });
    expect(outcome.incidentId).toBeUndefined();
    expect(f.store.rows(ReservationIncidentEntity)).toHaveLength(0);
  });

  it("rejects another traveler with 403", async () => {
    const f = createFixture();
    const reservation = await f.addReservation();

    await expect(
      f.service.cancelByTraveler(reservation.id, {
        user_id: 99,
        cancellation_reason: "voluntary",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.payoutService.refundInTransaction).not.toHaveBeenCalled();
  });

  it("rejects when payout is blocked (incident) or already released", async () => {
    const f = createFixture();
    const blocked = await f.addReservation({ payout_status: "blocked" });
    const released = await f.addReservation({ payout_status: "released" });

    await expect(
      f.service.cancelByTraveler(blocked.id, {
        user_id: OWNER,
        cancellation_reason: "voluntary",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      f.service.cancelByTraveler(released.id, {
        user_id: OWNER,
        cancellation_reason: "voluntary",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(f.payoutService.refundInTransaction).not.toHaveBeenCalled();
  });

  it("already cancelled reservation is a no-op", async () => {
    const f = createFixture();
    const reservation = await f.addReservation({ status: "cancelled" });

    const outcome = await f.service.cancelByTraveler(reservation.id, {
      user_id: OWNER,
      cancellation_reason: "voluntary",
    });

    expect(outcome.refundInitiated).toBe(false);
    expect(f.payoutService.refundInTransaction).not.toHaveBeenCalled();
    expect(
      f.reservationService.releaseAvailabilityForReservation,
    ).not.toHaveBeenCalled();
  });
});

const structuredSnapshot = (): ReservationSnapshotPayload =>
  snapshotWithDeadline("2020-01-01T00:00:00.000Z", {
    cancellation: {
      policy_type: "partial_from_booking",
      deadline_days: null,
      penalty_type: "percent_50",
      no_show_policy: "same_as_cancellation",
      grace_after_booking_hours: null,
      early_cancellation_weeks: null,
    },
    generated_text: "Parcialmente reembolsable.",
  });

describe("ReservationRefundService.previewTravelerCancellation", () => {
  it("returns the legacy quote without any side effect", async () => {
    const f = createFixture();
    const reservation = await f.addReservation();
    const before = { ...f.stored(reservation.id) };

    const preview = await f.service.previewTravelerCancellation(
      OWNER,
      reservation.id,
      "change_of_plans",
    );

    expect(preview).toMatchObject({
      reservation_id: reservation.id,
      cancellation_reason: "change_of_plans",
      can_cancel: true,
      paid_cents: 32_450,
      penalty_cents: 0,
      refund_cents: 32_450,
      source: "legacy_24h",
      currency: "EUR",
      requires_review: false,
    });
    expect(f.stored(reservation.id)).toEqual(before);
    expect(f.payoutService.refundInTransaction).not.toHaveBeenCalled();
    expect(f.economics.recordRefundPending).not.toHaveBeenCalled();
    expect(f.stripe.refundPaymentIntent).not.toHaveBeenCalled();
    expect(f.events.logEventInTransaction).not.toHaveBeenCalled();
    expect(
      f.reservationService.releaseAvailabilityForReservation,
    ).not.toHaveBeenCalled();
    expect(f.store.rows(ReservationDisputeEntity)).toHaveLength(0);
  });

  it("preview and cancel agree to the cent (legacy, structured)", async () => {
    for (const snap of [
      snapshotWithDeadline("2099-08-09T00:00:00.000Z"),
      structuredSnapshot(),
    ]) {
      const f = createFixture({ snapshot: snap });
      const reservation = await f.addReservation();

      const preview = await f.service.previewTravelerCancellation(
        OWNER,
        reservation.id,
        "transport",
      );
      await f.service.cancelByTraveler(reservation.id, {
        user_id: OWNER,
        cancellation_reason: "transport",
      });

      expect(f.payoutService.refundInTransaction.mock.calls[0][2]).toBe(
        preview.refund_cents,
      );
    }
  });

  it("structured policy outside the free period refunds paid - penalty", async () => {
    const f = createFixture({ snapshot: structuredSnapshot() });
    const reservation = await f.addReservation();

    const preview = await f.service.previewTravelerCancellation(
      OWNER,
      reservation.id,
      "other",
    );
    const outcome = await f.service.cancelByTraveler(reservation.id, {
      user_id: OWNER,
      cancellation_reason: "other",
      notes: "Motivo personal detallado",
    });

    expect(preview.source).toBe("structured");
    expect(preview.penalty_cents).toBe(16_225);
    expect(preview.refund_cents).toBe(16_225);
    expect(preview.policy_text).toBe("Parcialmente reembolsable.");
    expect(outcome.refundInitiated).toBe(true);
    expect(f.payoutService.refundInTransaction.mock.calls[0][2]).toBe(16_225);
    const cancelledEvent = f.events.logEventInTransaction.mock.calls.find(
      call => call[2] === "cancelled",
    );
    expect(cancelledEvent?.[3]).toMatchObject({
      penalty_cents: 16_225,
      refund_cents: 16_225,
      quote_source: "structured",
    });
  });

  it("force_majeure preview flags review; cancel creates pending refund + dispute", async () => {
    const f = createFixture({ snapshot: structuredSnapshot() });
    const reservation = await f.addReservation();

    const preview = await f.service.previewTravelerCancellation(
      OWNER,
      reservation.id,
      "force_majeure",
    );
    expect(preview.requires_review).toBe(true);
    expect(preview.refund_cents).toBe(32_450);
    expect(f.economics.recordRefundPending).not.toHaveBeenCalled();

    await f.service.cancelByTraveler(reservation.id, {
      user_id: OWNER,
      cancellation_reason: "force_majeure",
      notes: "Hospitalización urgente",
    });
    expect(f.economics.recordRefundPending.mock.calls[0][1].amountCents).toBe(
      preview.refund_cents,
    );
    expect(f.store.rows(ReservationDisputeEntity)).toHaveLength(1);
  });

  it("another traveler gets 403; missing reservation 404", async () => {
    const f = createFixture();
    const reservation = await f.addReservation();

    await expect(
      f.service.previewTravelerCancellation(99, reservation.id, "other"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      f.service.previewTravelerCancellation(OWNER, 999, "other"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("can_cancel is false when payout is blocked or released", async () => {
    const f = createFixture();
    const blocked = await f.addReservation({ payout_status: "blocked" });
    const released = await f.addReservation({ payout_status: "released" });

    for (const id of [blocked.id, released.id]) {
      const preview = await f.service.previewTravelerCancellation(
        OWNER,
        id,
        "change_of_plans",
      );
      expect(preview.can_cancel).toBe(false);
    }
  });
});

const errorsFor = async (body: Record<string, unknown>) =>
  validate(plainToInstance(TravelerCancelReservationDto, body));

describe("TravelerCancelReservationDto", () => {
  it("requires notes (>= 10 chars) for other and force_majeure", async () => {
    expect(
      await errorsFor({ user_id: 1, cancellation_reason: "other" }),
    ).not.toHaveLength(0);
    expect(
      await errorsFor({
        user_id: 1,
        cancellation_reason: "force_majeure",
        notes: "corto",
      }),
    ).not.toHaveLength(0);
    expect(
      await errorsFor({
        user_id: 1,
        cancellation_reason: "other",
        notes: "Motivo explicado con detalle",
      }),
    ).toHaveLength(0);
  });

  it("keeps notes optional for the rest, legacy voluntary included", async () => {
    expect(
      await errorsFor({ user_id: 1, cancellation_reason: "change_of_plans" }),
    ).toHaveLength(0);
    expect(
      await errorsFor({
        user_id: 1,
        cancellation_reason: "voluntary",
        notes: "x",
      }),
    ).toHaveLength(0);
    expect(
      await errorsFor({ user_id: 1, cancellation_reason: "refund_me" }),
    ).not.toHaveLength(0);
  });
});

/**
 * F-PV7b: an accepted change with a lower price refunded the difference
 * (reason change_accepted:*), so the row is partially_refunded. The traveler
 * can still cancel; preview and execution share the quote on the REMAINING
 * refundable amount (charged 32 450 − change refund 4 450 = 28 000).
 */
describe("ReservationRefundService — partially refunded by an accepted change", () => {
  const CHANGE_REFUND_CENTS = 4450;
  const REMAINING_CENTS = 28_000;

  const addChangedReservation = async (
    f: ReturnType<typeof createFixture>,
    refundReasons: string[] = ["change_accepted:proposal:7"],
  ) => {
    const reservation = await f.addReservation({
      payment_status: "partially_refunded",
      amount_refunded: (CHANGE_REFUND_CENTS * refundReasons.length) / 100,
      refund_seq: refundReasons.length,
      snapshot_version: 2,
    });
    for (const [index, reason] of refundReasons.entries()) {
      await f.store.repository(RefundEntity).save({
        reservation_id: reservation.id,
        status: "partial_completed",
        amount_cents: CHANGE_REFUND_CENTS,
        currency: "eur",
        reason,
        idempotency_key: `refund:${reservation.id}:${index + 1}`,
      });
    }
    return reservation;
  };

  /** v2 snapshot: the post-change price is the remaining amount. */
  const changedSnapshot = (
    base: ReservationSnapshotPayload,
    totalCents = REMAINING_CENTS,
  ): ReservationSnapshotPayload => ({ ...base, total_cents: totalCents });

  const previewThenCancel = async (
    f: ReturnType<typeof createFixture>,
    reservationId: number,
    reason: TravelerCancelReservationDto["cancellation_reason"] = "transport",
  ) => {
    const preview = await f.service.previewTravelerCancellation(
      OWNER,
      reservationId,
      reason,
    );
    const outcome = await f.service.cancelByTraveler(reservationId, {
      user_id: OWNER,
      cancellation_reason: reason,
      ...(reason === "force_majeure" ? { notes: "Hospitalización urgente" } : {}),
    });
    return { preview, outcome };
  };

  it("legacy, inside the window: refunds the full remaining amount (preview == executed)", async () => {
    const f = createFixture({
      snapshot: changedSnapshot(snapshotWithDeadline("2099-08-09T00:00:00.000Z")),
    });
    const reservation = await addChangedReservation(f);

    const { preview, outcome } = await previewThenCancel(f, reservation.id);

    expect(preview).toMatchObject({
      can_cancel: true,
      paid_cents: REMAINING_CENTS,
      penalty_cents: 0,
      refund_cents: REMAINING_CENTS,
      source: "legacy_24h",
    });
    expect(outcome.refundInitiated).toBe(true);
    expect(f.payoutService.refundInTransaction.mock.calls[0][2]).toBe(
      preview.refund_cents,
    );
    expect(f.stored(reservation.id)?.status).toBe("cancelled");
  });

  it("legacy, outside the window: cancels with no refund (preview == executed)", async () => {
    const f = createFixture({
      snapshot: changedSnapshot(snapshotWithDeadline("2020-01-01T00:00:00.000Z")),
    });
    const reservation = await addChangedReservation(f);

    const { preview, outcome } = await previewThenCancel(f, reservation.id);

    expect(preview).toMatchObject({
      can_cancel: true,
      paid_cents: REMAINING_CENTS,
      penalty_cents: REMAINING_CENTS,
      refund_cents: 0,
    });
    expect(outcome.refundInitiated).toBe(false);
    expect(f.payoutService.refundInTransaction).not.toHaveBeenCalled();
    expect(f.stored(reservation.id)?.status).toBe("cancelled");
  });

  it("structured percent_50: penalty on the current (v2) price, preview == executed", async () => {
    const f = createFixture({ snapshot: changedSnapshot(structuredSnapshot()) });
    const reservation = await addChangedReservation(f);

    const { preview } = await previewThenCancel(f, reservation.id);

    expect(preview).toMatchObject({
      source: "structured",
      paid_cents: REMAINING_CENTS,
      penalty_cents: 14_000,
      refund_cents: 14_000,
    });
    expect(f.payoutService.refundInTransaction.mock.calls[0][2]).toBe(14_000);
  });

  it("never refunds more than what remains on the PaymentIntent", async () => {
    // Free period + a snapshot total above the remaining amount.
    const f = createFixture({
      snapshot: changedSnapshot(
        snapshotWithDeadline("2099-08-09T00:00:00.000Z", {
          cancellation: {
            policy_type: "free_cancellation",
            deadline_days: 7,
            penalty_type: "percent_100",
            no_show_policy: "same_as_cancellation",
            grace_after_booking_hours: null,
            early_cancellation_weeks: null,
          },
        }),
        32_450,
      ),
    });
    const reservation = await addChangedReservation(f);

    const { preview } = await previewThenCancel(f, reservation.id);

    expect(preview.refund_cents).toBe(REMAINING_CENTS);
    expect(preview.penalty_cents).toBe(0);
    expect(f.payoutService.refundInTransaction.mock.calls[0][2]).toBe(
      REMAINING_CENTS,
    );
  });

  it("force_majeure requests the remaining refundable amount", async () => {
    const f = createFixture({ snapshot: changedSnapshot(structuredSnapshot()) });
    const reservation = await addChangedReservation(f);

    const { preview } = await previewThenCancel(
      f,
      reservation.id,
      "force_majeure",
    );

    expect(preview.refund_cents).toBe(REMAINING_CENTS);
    expect(f.economics.recordRefundPending.mock.calls[0][1].amountCents).toBe(
      REMAINING_CENTS,
    );
  });

  it("other partial refunds keep blocking the traveler cancel", async () => {
    for (const reasons of [
      ["manual_refund"],
      ["change_accepted:proposal:7", "exceptional_refund"],
    ]) {
      const f = createFixture({
        snapshot: changedSnapshot(
          snapshotWithDeadline("2099-08-09T00:00:00.000Z"),
        ),
      });
      const reservation = await addChangedReservation(f, reasons);

      const preview = await f.service.previewTravelerCancellation(
        OWNER,
        reservation.id,
        "transport",
      );
      expect(preview.can_cancel).toBe(false);
      await expect(
        f.service.cancelByTraveler(reservation.id, {
          user_id: OWNER,
          cancellation_reason: "transport",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(f.payoutService.refundInTransaction).not.toHaveBeenCalled();
    }
  });
});
