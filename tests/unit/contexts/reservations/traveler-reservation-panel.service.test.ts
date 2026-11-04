import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

import { createEconomics } from "@/tests/utils/economics";
import { FakeEntityStore } from "@/tests/utils/fake-entity-store";

import { buildReservationSnapshotPayload } from "@/src/contexts/payments/domain/reservation-snapshot";
import { PaymentEntity } from "@/src/contexts/payments/entities/payment.entity";
import { RefundEntity } from "@/src/contexts/payments/entities/refund.entity";
import { ReservationPriceLineEntity } from "@/src/contexts/payments/entities/reservation-price-line.entity";
import { ReservationSnapshotEntity } from "@/src/contexts/payments/entities/reservation-snapshot.entity";
import { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";
import { ReservationDisputeEntity } from "@/src/contexts/reservations/entities/reservation-dispute.entity";
import { ReservationGuestFeedbackEntity } from "@/src/contexts/reservations/entities/reservation-guest-feedback.entity";
import { ReservationIncidentEntity } from "@/src/contexts/reservations/entities/reservation-incident.entity";
import { ReservationIncidentAttachmentEntity } from "@/src/contexts/reservations/entities/reservation-incident-attachment.entity";
import { ReservationIncidentMessageEntity } from "@/src/contexts/reservations/entities/reservation-incident-message.entity";
import { ReservationAlternativeEntity } from "@/src/contexts/reservations/entities/reservation-alternative.entity";
import { ReservationChangeProposalEntity } from "@/src/contexts/reservations/entities/reservation-change-proposal.entity";
import { ReservationChangeRequestEntity } from "@/src/contexts/reservations/entities/reservation-change-request.entity";
import { ReservationChangeQueryService } from "@/src/contexts/reservations/services/reservation-change-query.service";
import { ReservationIncidentService } from "@/src/contexts/reservations/services/reservation-incident.service";
import { TravelerReservationPanelService } from "@/src/contexts/reservations/services/traveler-reservation-panel.service";

const OWNER = 10;
const OTHER = 99;

const reservationRow = (overrides: Partial<ReservationEntity> = {}) => ({
  site_id: 42,
  room_id: 3,
  source: "internal",
  user_id: OWNER,
  checkin: "2099-07-16",
  checkout: "2099-07-20",
  guests: 2,
  pets: 1,
  subtotal: 400,
  commission: 0,
  total: 400,
  total_cents: 40_000,
  currency: "eur",
  status: "confirmed",
  payment_status: "paid",
  payout_status: "held",
  refund_seq: 0,
  snapshot_version: null,
  expiration_date: new Date("2099-07-16T00:00:00.000Z"),
  ...overrides,
});

const snapshotPayload = (totalCents: number) =>
  buildReservationSnapshotPayload({
    stay: {
      site_id: 42,
      checkin: "2099-07-16",
      checkout: "2099-07-20",
      nights: 4,
      guests: 2,
      pets: 1,
    },
    room: {
      id: 3,
      name: "Suite Golden",
      max_guests: 2,
      max_pets: 2,
      price_per_night_cents: totalCents / 4,
    },
    board: null,
    currency: "eur",
    lines: [
      {
        type: "accommodation",
        description: "Alojamiento 4 noches",
        quantity: 4,
        unit_amount_cents: totalCents / 4,
        amount_cents: totalCents,
        is_optional: false,
        is_commissionable: true,
        is_penalizable: true,
      },
    ],
    totals: {
      total_cents: totalCents,
      commissionable_cents: totalCents,
      penalizable_cents: totalCents,
      optional_cents: 0,
      non_commissionable_cents: 0,
    },
    commissionRate: 0.12,
    commissionCents: Math.round(totalCents * 0.12),
    timezone: "Europe/Madrid",
    deadlineLocalTime: null,
    source: "checkout",
  });

const createFixture = () => {
  const store = new FakeEntityStore();
  const { snapshots, lines } = createEconomics(store);
  const mysqlService = { query: vi.fn().mockResolvedValue([]) };
  const travelerDogs = {
    list: vi.fn().mockResolvedValue({ items: [], max: 10 }),
  };
  // F-PV7a: real incident service over the same store (read paths only).
  const incidents = new ReservationIncidentService(
    store.repository(ReservationEntity) as never,
    store.repository(ReservationIncidentEntity) as never,
    store.repository(ReservationIncidentAttachmentEntity) as never,
    store.repository(ReservationIncidentMessageEntity) as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const service = new TravelerReservationPanelService(
    store.repository(ReservationEntity) as never,
    store.repository(ReservationDisputeEntity) as never,
    store.repository(RefundEntity) as never,
    store.repository(PaymentEntity) as never,
    store.repository(ReservationSnapshotEntity) as never,
    store.repository(ReservationGuestFeedbackEntity) as never,
    snapshots,
    lines,
    mysqlService as never,
    travelerDogs as never,
    incidents,
    // F-PV7b: real read side over the same store.
    new ReservationChangeQueryService(
      store.repository(ReservationChangeRequestEntity) as never,
      store.repository(ReservationChangeProposalEntity) as never,
      store.repository(ReservationAlternativeEntity) as never,
    ),
  );
  const addReservation = async (overrides: Partial<ReservationEntity> = {}) =>
    (await store
      .repository(ReservationEntity)
      .save(reservationRow(overrides))) as unknown as ReservationEntity;
  const addSnapshot = async (reservationId: number, payload: object) => {
    await store.repository(ReservationSnapshotEntity).save({
      reservation_id: reservationId,
      version: 1,
      reason: "checkout",
      payload,
    });
    await store
      .repository(ReservationEntity)
      .update({ id: reservationId }, { snapshot_version: 1 });
  };
  return {
    store,
    service,
    mysqlService,
    travelerDogs,
    addReservation,
    addSnapshot,
  };
};

describe("TravelerReservationPanelService", () => {
  it("lists only the traveler's own reservations", async () => {
    const { service, addReservation } = createFixture();
    const mine = await addReservation();
    await addReservation({ user_id: OTHER });
    await addReservation({ user_id: 0 });

    const list = await service.listForTraveler(OWNER, "upcoming");

    expect(list.total).toBe(1);
    expect(list.items.map(item => item.id)).toEqual([mine.id]);
    expect(list.items[0]).toMatchObject({
      code: `#RES-${mine.id}`,
      status: "confirmed",
      tab: "upcoming",
      total_cents: 40_000,
      nights: 4,
    });
  });

  it("rejects user_id 0 with 400", async () => {
    const { service } = createFixture();
    await expect(service.listForTraveler(0, "upcoming")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("hides abandoned pending checkouts and splits tabs", async () => {
    const { service, addReservation } = createFixture();
    await addReservation({
      status: "pending",
      payment_status: "pending",
      expiration_date: new Date("2020-01-01T00:00:00.000Z"),
    });
    const pending = await addReservation({
      status: "pending",
      payment_status: "pending",
    });
    const cancelled = await addReservation({ status: "cancelled" });
    const past = await addReservation({
      checkin: "2020-01-01",
      checkout: "2020-01-03",
    });

    const upcoming = await service.listForTraveler(OWNER, "upcoming");
    expect(upcoming.items.map(item => item.id)).toEqual([pending.id]);
    expect(upcoming.items[0].status).toBe("payment_pending");

    const cancelledTab = await service.listForTraveler(OWNER, "cancelled");
    expect(cancelledTab.items.map(item => item.id)).toEqual([cancelled.id]);

    const pastTab = await service.listForTraveler(OWNER, "past");
    expect(pastTab.items.map(item => item.id)).toEqual([past.id]);
  });

  it("pay-pending: a payable pending checkout shows can_pay + pay_expires_at in list and detail", async () => {
    const { service, addReservation } = createFixture();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const pending = await addReservation({
      status: "pending",
      payment_status: "pending",
      expiration_date: expiresAt,
    });
    const confirmed = await addReservation({
      checkin: "2099-08-01",
      checkout: "2099-08-03",
    });
    await addReservation({
      status: "pending",
      payment_status: "pending",
      expiration_date: new Date(Date.now() - 1000),
    });

    const upcoming = await service.listForTraveler(OWNER, "upcoming");
    expect(upcoming.items.map(item => item.id)).toEqual([
      pending.id,
      confirmed.id,
    ]);
    expect(upcoming.items[0]).toMatchObject({
      status: "payment_pending",
      can_pay: true,
      pay_expires_at: expiresAt.toISOString(),
    });
    expect(upcoming.items[1]).toMatchObject({
      can_pay: false,
      pay_expires_at: null,
    });

    const detail = await service.getDetailForTraveler(OWNER, pending.id);
    expect(detail.card.can_pay).toBe(true);
    expect(detail.capabilities).toMatchObject({
      can_pay: true,
      pay_expires_at: expiresAt.toISOString(),
    });

    const dashboard = await service.getDashboard(OWNER);
    expect(dashboard.next_trip).toMatchObject({ id: pending.id, can_pay: true });
  });

  it("orders upcoming by checkin ASC and paginates", async () => {
    const { service, addReservation } = createFixture();
    const late = await addReservation({
      checkin: "2099-09-01",
      checkout: "2099-09-03",
    });
    const early = await addReservation({
      checkin: "2099-08-01",
      checkout: "2099-08-03",
    });

    const first = await service.listForTraveler(OWNER, "upcoming", 1, 0);
    const second = await service.listForTraveler(OWNER, "upcoming", 1, 1);

    expect(first.total).toBe(2);
    expect(first.items.map(item => item.id)).toEqual([early.id]);
    expect(second.items.map(item => item.id)).toEqual([late.id]);
  });

  it("marks open disputes as incident_review in the list", async () => {
    const { store, service, addReservation } = createFixture();
    const reservation = await addReservation();
    await store.repository(ReservationDisputeEntity).save({
      reservation_id: reservation.id,
      status: "open",
      source: "guest_report",
    });

    const list = await service.listForTraveler(OWNER, "upcoming");
    expect(list.items[0].status).toBe("incident_review");
  });

  it("detail of another user's reservation → 403, missing → 404", async () => {
    const { service, addReservation } = createFixture();
    const reservation = await addReservation({ user_id: OTHER });

    await expect(
      service.getDetailForTraveler(OWNER, reservation.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.getDetailForTraveler(OWNER, 999),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("detail reads snapshot v1 even if the live reservation total changed", async () => {
    const { service, store, addReservation, addSnapshot } = createFixture();
    const reservation = await addReservation();
    await addSnapshot(reservation.id, snapshotPayload(40_000));
    // Live row drifts after booking (host repricing / manual edit).
    await store
      .repository(ReservationEntity)
      .update({ id: reservation.id }, { total: 999, total_cents: 99_900 });

    const detail = await service.getDetailForTraveler(OWNER, reservation.id);

    expect(detail.snapshot_version).toBe(1);
    expect(detail.card.total_cents).toBe(40_000);
    expect(detail.totals.total_cents).toBe(40_000);
    expect(detail.price_lines).toHaveLength(1);
    expect(detail.room?.name).toBe("Suite Golden");
    expect(detail.card.room_name).toBe("Suite Golden");
    expect(detail.policy.rule).toBe(
      "legacy_host_full_refund_until_24h_before_checkin",
    );
    expect(detail.policy.is_structured).toBe(false);
    expect(detail.capabilities).toEqual({
      can_pay: false,
      pay_expires_at: null,
      can_cancel: true,
      can_review: false,
      // F-PV7b: upcoming confirmed + paid, no open change request.
      can_request_change: true,
      // F-PV7a: confirmed + inside the 30-day window -> every traveler type.
      can_report_incident: true,
      reportable_incident_types: [
        "before_arrival",
        "during_stay",
        "dog_issue",
        "conditions_not_respected",
        "charge_issue",
        "refund_issue",
        "other",
      ],
      has_feedback: false,
      review_deadline_passed: false,
    });
    expect(detail.incidents).toEqual([]);
    // No compatibility in the f1 snapshot, no site row, no feedback.
    expect(detail.dogs_compatible).toBeNull();
    expect(detail.site_address).toBeNull();
    expect(detail.my_feedback).toBeNull();
  });

  it("detail dogs expose saved_dog_id (nullable) and never photo data", async () => {
    const { service, addReservation, addSnapshot } = createFixture();
    const reservation = await addReservation();
    const size = { id: 1, name: "Pequeño", slug: "pequeno", rank: 1 };
    await addSnapshot(reservation.id, {
      ...snapshotPayload(40_000),
      dogs: [
        {
          index: 0,
          name: "Luna",
          weight_kg: 8,
          is_ppp: false,
          room_id: 3,
          size,
          saved_dog_id: 7,
        },
        // Older snapshot / typed-in dog: no link.
        { index: 1, name: null, weight_kg: 25, is_ppp: true, room_id: 3, size },
      ],
    });

    const detail = await service.getDetailForTraveler(OWNER, reservation.id);

    expect(detail.dogs.map(dog => [dog.name, dog.saved_dog_id])).toEqual([
      ["Luna", 7],
      [null, null],
    ]);
    expect(JSON.stringify(detail.dogs)).not.toContain("photo");
  });

  it("detail without snapshot falls back to reservation_price_lines", async () => {
    const { service, store, addReservation } = createFixture();
    const reservation = await addReservation();
    await store.repository(ReservationPriceLineEntity).save({
      reservation_id: reservation.id,
      type: "accommodation",
      description: "Legacy",
      quantity: 1,
      unit_amount_cents: 40_000,
      amount_cents: 40_000,
      currency: "eur",
      is_optional: false,
      is_commissionable: true,
      is_penalizable: true,
    });

    const detail = await service.getDetailForTraveler(OWNER, reservation.id);

    expect(detail.snapshot_version).toBeNull();
    expect(detail.price_lines.map(line => line.description)).toEqual([
      "Legacy",
    ]);
    expect(detail.totals.total_cents).toBe(40_000);
    expect(detail.dogs).toEqual([]);
    expect(detail.dog_policy).toBeNull();
    expect(detail.stay.nights).toBe(4);
  });

  it("maps payments/refunds without stripe ids or raw enums", async () => {
    const { service, store, addReservation } = createFixture();
    const reservation = await addReservation();
    await store.repository(PaymentEntity).save({
      reservation_id: reservation.id,
      type: "charge",
      status: "paid",
      amount_cents: 40_000,
      currency: "eur",
      idempotency_key: "k1",
      stripe_payment_intent_id: "pi_secret",
      paid_at: new Date("2099-07-01T10:00:00.000Z"),
    });
    await store.repository(RefundEntity).save({
      reservation_id: reservation.id,
      status: "processing",
      amount_cents: 40_000,
      currency: "eur",
      idempotency_key: "r1",
      stripe_refund_id: "re_secret",
    });

    const detail = await service.getDetailForTraveler(OWNER, reservation.id);

    expect(detail.payments).toEqual([
      {
        id: 1,
        status_label_key: "cv_pay_paid",
        amount_cents: 40_000,
        paid_at: "2099-07-01T10:00:00.000Z",
      },
    ]);
    expect(detail.refunds[0].status_label_key).toBe("cv_ref_processing");
    expect(JSON.stringify(detail)).not.toContain("secret");
  });

  it("can_review only when finalized, no feedback and deadline ahead", async () => {
    const { service, store, addReservation } = createFixture();
    const reservation = await addReservation({
      status: "finalized",
      feedback_deadline_at: new Date("2099-12-31T00:00:00.000Z"),
    });

    const open = await service.getDetailForTraveler(OWNER, reservation.id);
    expect(open.capabilities.can_review).toBe(true);
    expect(open.capabilities.can_cancel).toBe(false);

    await store.repository(ReservationGuestFeedbackEntity).save({
      reservation_id: reservation.id,
      type: "review",
      rating: 5,
    });
    const reviewed = await service.getDetailForTraveler(OWNER, reservation.id);
    expect(reviewed.capabilities.can_review).toBe(false);
  });

  it("has_feedback + my_feedback once submitted (read-only, no report_reason)", async () => {
    const { service, store, addReservation } = createFixture();
    const reservation = await addReservation({
      status: "finalized",
      feedback_deadline_at: new Date("2099-12-31T00:00:00.000Z"),
    });
    await store.repository(ReservationGuestFeedbackEntity).save({
      reservation_id: reservation.id,
      type: "review",
      rating: 4,
      comment: "  Muy bien  ",
      report_reason: "internal",
      created_at: new Date("2099-08-01T10:00:00.000Z"),
    });

    const detail = await service.getDetailForTraveler(OWNER, reservation.id);

    expect(detail.capabilities.has_feedback).toBe(true);
    expect(detail.capabilities.can_review).toBe(false);
    expect(detail.capabilities.review_deadline_passed).toBe(false);
    expect(detail.my_feedback).toEqual({
      type: "review",
      rating: 4,
      comment: "Muy bien",
      submitted_at: "2099-08-01T10:00:00.000Z",
    });
    expect(JSON.stringify(detail.my_feedback)).not.toContain("internal");
  });

  it("review_deadline_passed when finalized without feedback after the deadline", async () => {
    const { service, addReservation } = createFixture();
    const expired = await addReservation({
      status: "finalized",
      checkin: "2020-01-01",
      checkout: "2020-01-03",
      feedback_deadline_at: new Date("2020-01-10T00:00:00.000Z"),
    });
    const noDeadline = await addReservation({
      status: "finalized",
      checkin: "2020-02-01",
      checkout: "2020-02-03",
    });

    const detail = await service.getDetailForTraveler(OWNER, expired.id);
    expect(detail.capabilities).toMatchObject({
      can_review: false,
      has_feedback: false,
      review_deadline_passed: true,
    });

    const other = await service.getDetailForTraveler(OWNER, noDeadline.id);
    expect(other.capabilities.review_deadline_passed).toBe(false);
  });

  it("dogs_compatible comes from the frozen snapshot only (old snapshot -> null)", async () => {
    const { service, addReservation, addSnapshot } = createFixture();
    const size = { id: 1, name: "Pequeño", slug: "pequeno", rank: 1 };
    const dog = {
      index: 0,
      name: "Luna",
      weight_kg: 8,
      is_ppp: false,
      room_id: 3,
      size,
    };
    const compatible = await addReservation();
    await addSnapshot(compatible.id, {
      ...snapshotPayload(40_000),
      dogs: [dog],
      compatibility: { mode: "strict", compatible: true, dogs_declared: true },
    });
    const incompatible = await addReservation({ checkin: "2099-08-01" });
    await addSnapshot(incompatible.id, {
      ...snapshotPayload(40_000),
      dogs: [dog],
      compatibility: { mode: "strict", compatible: false, dogs_declared: true },
    });
    const old = await addReservation({ checkin: "2099-09-01" });
    await addSnapshot(old.id, { ...snapshotPayload(40_000), dogs: [dog] });

    const okDetail = await service.getDetailForTraveler(OWNER, compatible.id);
    const koDetail = await service.getDetailForTraveler(OWNER, incompatible.id);
    const oldDetail = await service.getDetailForTraveler(OWNER, old.id);
    expect(okDetail.dogs_compatible).toBe(true);
    expect(koDetail.dogs_compatible).toBe(false);
    expect(oldDetail.dogs_compatible).toBeNull();
  });

  it("detail site_address composed from legacy town/province; lookup failure -> null", async () => {
    const { service, mysqlService, addReservation } = createFixture();
    const reservation = await addReservation({ site_id: 42 });
    mysqlService.query.mockResolvedValueOnce([
      {
        id: 42,
        name: "Casa Rural",
        alias_l1: "casa-rural",
        poblacio: "Espirdo",
        provincia: "Segovia",
        image1: null,
      },
    ]);
    const detail = await service.getDetailForTraveler(OWNER, reservation.id);
    expect(detail.site_address).toBe("Espirdo (Segovia)");

    mysqlService.query.mockRejectedValueOnce(new Error("db down"));
    const fallback = await service.getDetailForTraveler(OWNER, reservation.id);
    expect(fallback.site_address).toBeNull();
    expect(fallback.card.id).toBe(reservation.id);
  });

  it("uses legacy site data and survives a missing site", async () => {
    const { service, mysqlService, addReservation, addSnapshot } =
      createFixture();
    const known = await addReservation({ site_id: 42 });
    const orphan = await addReservation({
      site_id: 77,
      checkin: "2099-08-01",
      checkout: "2099-08-02",
    });
    await addSnapshot(orphan.id, snapshotPayload(40_000));
    mysqlService.query.mockResolvedValue([
      {
        id: 42,
        name: "Casa Rural",
        alias_l1: "casa-rural",
        poblacio: "Espirdo",
        provincia: "Segovia",
        image1: "42-casa-rural-1.webp",
      },
    ]);

    const list = await service.listForTraveler(OWNER, "upcoming");
    const byId = new Map(list.items.map(item => [item.id, item]));

    expect(byId.get(known.id)).toMatchObject({
      site_name: "Casa Rural",
      site_image_file: "42-casa-rural-1.webp",
      site_town: "Espirdo",
    });
    expect(byId.get(orphan.id)).toMatchObject({
      site_name: "Suite Golden",
      site_image_file: null,
    });
  });

  describe("getDashboard (F-PV6)", () => {
    const HOUR_MS = 60 * 60 * 1000;

    it("returns the first upcoming trip, counts, dogs and the free-cancel alert", async () => {
      const { service, travelerDogs, addReservation, addSnapshot } =
        createFixture();
      const late = await addReservation({
        checkin: "2099-09-01",
        checkout: "2099-09-03",
      });
      const next = await addReservation();
      await addSnapshot(next.id, snapshotPayload(40_000));
      await addReservation({ status: "cancelled" });
      await addReservation({ user_id: OTHER });
      travelerDogs.list.mockResolvedValue({
        items: [
          {
            id: 5,
            name: "Toby",
            weight_kg: 12,
            is_ppp: false,
            photo_path: "0123456789abcdef0123456789abcdef.webp",
            size: { id: 2, name: "Mediano", slug: "medium", rank: 2 },
            created_at: "2099-01-01T00:00:00.000Z",
            updated_at: "2099-01-01T00:00:00.000Z",
          },
        ],
        max: 10,
      });
      const deadline = new Date(
        snapshotPayload(40_000).refund_policy.refund_deadline,
      );
      const now = new Date(deadline.getTime() - 48 * HOUR_MS);

      const dashboard = await service.getDashboard(OWNER, now);

      expect(dashboard.next_trip).toMatchObject({
        id: next.id,
        status: "confirmed",
        site_name: "Suite Golden",
      });
      expect(dashboard.upcoming_count).toBe(2);
      expect(dashboard.dogs_available).toBe(true);
      expect(dashboard.dogs).toEqual([
        {
          id: 5,
          name: "Toby",
          photo_path: "0123456789abcdef0123456789abcdef.webp",
          size: { id: 2, name: "Mediano", slug: "medium", rank: 2 },
        },
      ]);
      expect(travelerDogs.list).toHaveBeenCalledWith(OWNER);
      // `late` is confirmed too but its deadline is weeks away.
      expect(dashboard.alerts).toEqual([
        {
          type: "free_cancel_ending",
          reservation_id: next.id,
          code: `#RES-${next.id}`,
          site_name: "Suite Golden",
          deadline_iso: deadline.toISOString(),
        },
      ]);
      expect(late.id).not.toBe(next.id);
    });

    it("no free-cancel alert 73 h before the deadline", async () => {
      const { service, addReservation, addSnapshot } = createFixture();
      const next = await addReservation();
      await addSnapshot(next.id, snapshotPayload(40_000));
      const deadline = new Date(
        snapshotPayload(40_000).refund_policy.refund_deadline,
      );

      const dashboard = await service.getDashboard(
        OWNER,
        new Date(deadline.getTime() - 73 * HOUR_MS),
      );

      expect(dashboard.alerts).toEqual([]);
    });

    it("incident alerts: open dispute (upcoming) and pending refund (cancelled)", async () => {
      const { store, service, addReservation } = createFixture();
      const disputed = await addReservation();
      await store.repository(ReservationDisputeEntity).save({
        reservation_id: disputed.id,
        status: "open",
        source: "guest_report",
      });
      const cancelled = await addReservation({ status: "cancelled" });
      await store.repository(RefundEntity).save({
        reservation_id: cancelled.id,
        status: "pending",
        amount_cents: 40_000,
      });
      await addReservation({ status: "cancelled" });

      const dashboard = await service.getDashboard(
        OWNER,
        new Date("2099-07-14T00:00:00.000Z"),
      );

      expect(
        dashboard.alerts.map(alert => [alert.type, alert.reservation_id]),
      ).toEqual([
        ["incident_review", disputed.id],
        ["incident_review", cancelled.id],
      ]);
      expect(dashboard.next_trip?.status).toBe("incident_review");
    });

    it("empty traveler and dogs failure never break the home", async () => {
      const { service, travelerDogs } = createFixture();
      travelerDogs.list.mockRejectedValue(new Error("table missing"));

      const dashboard = await service.getDashboard(OWNER);

      expect(dashboard).toEqual({
        next_trip: null,
        upcoming_count: 0,
        dogs: [],
        dogs_available: false,
        alerts: [],
      });
    });

    it("rejects user_id 0 with 400", async () => {
      const { service } = createFixture();
      await expect(service.getDashboard(0)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe("F-PV7a incidents", () => {
    it("an open incident turns the card into incident_review and is listed in the detail", async () => {
      const { service, store, addReservation } = createFixture();
      const reservation = await addReservation();
      await store.repository(ReservationIncidentEntity).save({
        reservation_id: reservation.id,
        user_id: OWNER,
        type: "before_arrival",
        status: "needs_info",
        description: "No nos responden al teléfono del alojamiento",
        dispute_id: null,
        blocks_payout: false,
        resolution_note: null,
        resolved_at: null,
      });

      const list = await service.listForTraveler(OWNER, "upcoming");
      expect(list.items[0].status).toBe("incident_review");

      const detail = await service.getDetailForTraveler(OWNER, reservation.id);
      expect(detail.card.status).toBe("incident_review");
      expect(detail.incidents).toHaveLength(1);
      expect(detail.incidents[0]).toMatchObject({
        type: "before_arrival",
        status: "needs_info",
        can_reply: true,
        can_attach: true,
      });
      expect(detail.incidents[0]).not.toHaveProperty("dispute_id");
      // One open incident per type: before_arrival is no longer reportable.
      expect(detail.capabilities.reportable_incident_types).not.toContain(
        "before_arrival",
      );
      expect(detail.capabilities.can_report_incident).toBe(true);
    });

    it("a resolved incident does not change the card status", async () => {
      const { service, store, addReservation } = createFixture();
      const reservation = await addReservation();
      await store.repository(ReservationIncidentEntity).save({
        reservation_id: reservation.id,
        user_id: OWNER,
        type: "other",
        status: "resolved",
        description: "Todo aclarado con el alojamiento, gracias",
        dispute_id: null,
        blocks_payout: false,
        resolution_note: "Resuelta",
        resolved_at: new Date(),
      });
      const detail = await service.getDetailForTraveler(OWNER, reservation.id);
      expect(detail.card.status).toBe("confirmed");
    });

    it("pending unpaid and cancelled reservations: no incident except refund_issue when money moved", async () => {
      const { service, addReservation } = createFixture();
      const pending = await addReservation({
        status: "pending",
        payment_status: "pending",
      });
      const cancelledPaid = await addReservation({
        status: "cancelled",
        payment_status: "refunded",
      });

      const pendingDetail = await service.getDetailForTraveler(
        OWNER,
        pending.id,
      );
      expect(pendingDetail.capabilities.can_report_incident).toBe(false);

      const cancelledDetail = await service.getDetailForTraveler(
        OWNER,
        cancelledPaid.id,
      );
      expect(cancelledDetail.capabilities.reportable_incident_types).toEqual([
        "refund_issue",
      ]);
    });
  });

  describe("F-PV7b change proposals / alternatives", () => {
    const offerPayload = (snapshot: object) => ({
      before_payload: { snapshot, site_name: null },
      after_payload: { snapshot, site_name: null, target: {}, quote: {} },
    });

    it("live proposal and alternative raise home alerts; expired ones do not", async () => {
      const { store, service, addReservation } = createFixture();
      const withProposal = await addReservation();
      const withAlternative = await addReservation({ checkin: "2099-07-18" });
      const expired = await addReservation({ checkin: "2099-07-19" });
      const now = new Date("2099-07-01T10:00:00.000Z");
      const future = new Date("2099-07-03T10:00:00.000Z");
      const past = new Date("2099-06-30T10:00:00.000Z");
      const payload = offerPayload(snapshotPayload(40_000));
      await store.repository(ReservationChangeProposalEntity).save({
        request_id: 1,
        reservation_id: withProposal.id,
        ...payload,
        amount_delta_cents: 0,
        status: "pending_traveler",
        expires_at: future,
      });
      await store.repository(ReservationAlternativeEntity).save({
        reservation_id: withAlternative.id,
        before_payload: payload.before_payload,
        proposal_payload: payload.after_payload,
        amount_delta_cents: 0,
        status: "pending_traveler",
        expires_at: future,
        compatible_with_dogs: true,
      });
      await store.repository(ReservationChangeProposalEntity).save({
        request_id: 2,
        reservation_id: expired.id,
        ...payload,
        amount_delta_cents: 0,
        status: "pending_traveler",
        expires_at: past,
      });

      const dashboard = await service.getDashboard(OWNER, now);

      expect(
        dashboard.alerts.map(alert => [alert.type, alert.reservation_id]),
      ).toEqual([
        ["change_proposal_pending", withProposal.id],
        ["alternative_pending", withAlternative.id],
      ]);
    });

    it("detail carries change_requests / alternatives / change_types; an open request disables can_request_change", async () => {
      const { store, service, addReservation, addSnapshot } = createFixture();
      const reservation = await addReservation();
      await addSnapshot(reservation.id, snapshotPayload(40_000));
      await store.repository(ReservationChangeRequestEntity).save({
        reservation_id: reservation.id,
        user_id: OWNER,
        type: "add_nights",
        message: null,
        status: "received",
        response_note: null,
        closed_at: null,
      });

      const detail = await service.getDetailForTraveler(OWNER, reservation.id);

      expect(detail.capabilities.can_request_change).toBe(false);
      expect(detail.change_requests).toHaveLength(1);
      expect(detail.change_requests[0]).toMatchObject({
        type: "add_nights",
        status: "received",
        can_cancel: true,
      });
      expect(detail.alternatives).toEqual([]);
      expect(detail.change_types).toContain("dogs");
    });
  });
});

describe("TravelerReservationPanelService — F-PV7b change-only partial refund", () => {
  const addPartiallyRefunded = async (
    fixture: ReturnType<typeof createFixture>,
    reason: string,
  ) => {
    const reservation = await fixture.addReservation({
      payment_status: "partially_refunded",
      amount_refunded: 50,
    });
    await fixture.store.repository(RefundEntity).save({
      reservation_id: reservation.id,
      status: "partial_completed",
      amount_cents: 5000,
      currency: "eur",
      reason,
      idempotency_key: `refund:${reservation.id}:1`,
    });
    return reservation;
  };

  it("shows «Confirmada» with cancel/incident/change like confirmed+paid", async () => {
    const fixture = createFixture();
    const reservation = await addPartiallyRefunded(
      fixture,
      "change_accepted:proposal:9",
    );

    const list = await fixture.service.listForTraveler(OWNER, "upcoming");
    const detail = await fixture.service.getDetailForTraveler(
      OWNER,
      reservation.id,
    );

    expect(list.items[0].status).toBe("confirmed");
    expect(detail.card.status).toBe("confirmed");
    expect(detail.capabilities).toMatchObject({
      can_cancel: true,
      can_report_incident: true,
      can_request_change: true,
    });
  });

  it("other partial refunds keep the fallback and no cancel", async () => {
    const fixture = createFixture();
    const reservation = await addPartiallyRefunded(fixture, "manual_refund");

    const detail = await fixture.service.getDetailForTraveler(
      OWNER,
      reservation.id,
    );

    expect(detail.card.status).toBe("in_progress");
    expect(detail.capabilities.can_cancel).toBe(false);
  });

  it("payout blocked still hides cancel for the change case", async () => {
    const fixture = createFixture();
    const reservation = await addPartiallyRefunded(
      fixture,
      "change_accepted:alternative:2",
    );
    await fixture.store
      .repository(ReservationEntity)
      .update({ id: reservation.id }, { payout_status: "blocked" });

    const detail = await fixture.service.getDetailForTraveler(
      OWNER,
      reservation.id,
    );

    expect(detail.card.status).toBe("confirmed");
    expect(detail.capabilities.can_cancel).toBe(false);
  });
});
