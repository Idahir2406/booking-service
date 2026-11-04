import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { createEconomics } from "@/tests/utils/economics";
import { FakeEntityStore } from "@/tests/utils/fake-entity-store";

import {
  CANCELLATION_POLICY_TYPE,
  NO_SHOW_POLICY,
  PENALTY_TYPE,
} from "@/src/contexts/payments/domain/cancellation-policy";
import { ReservationSnapshotEntity } from "@/src/contexts/payments/entities/reservation-snapshot.entity";
import { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";
import { ReservationDisputeEntity } from "@/src/contexts/reservations/entities/reservation-dispute.entity";
import { ReservationEventEntity } from "@/src/contexts/reservations/entities/reservation-event.entity";
import { ReservationIncidentEntity } from "@/src/contexts/reservations/entities/reservation-incident.entity";
import { ReservationEventService } from "@/src/contexts/reservations/services/reservation-event.service";
import { ReservationNoShowService } from "@/src/contexts/reservations/services/reservation-no-show.service";

const SITE = 42;
const NOW = new Date("2026-08-11T10:00:00.000Z");

const createFixture = () => {
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
  const { economics, snapshots } = createEconomics(store);
  const events = new ReservationEventService(
    store.repository(ReservationEventEntity) as never,
  );
  const reservationService = {
    getSiteById: vi.fn().mockResolvedValue({ id: SITE, email: "host@x.com" }),
    releaseRemainingAvailabilityForReservation: vi.fn(() => Promise.resolve()),
  };
  const payoutService = {
    refundInTransaction: vi.fn(
      (_m: unknown, reservation: ReservationEntity, amount: number) => {
        reservation.amount_refunded =
          Number(reservation.amount_refunded ?? 0) + amount / 100;
        reservation.payment_status = "partially_refunded";
        return Promise.resolve({ refundId: "re_1", isPartial: true });
      },
    ),
  };
  const emails = { sendReservationEmail: vi.fn(() => Promise.resolve()) };
  const service = new ReservationNoShowService(
    reservationRepository as never,
    store.repository(ReservationIncidentEntity) as never,
    economics,
    snapshots,
    reservationService as never,
    payoutService as never,
    events,
    emails as never,
  );

  const addReservation = async (overrides: Partial<ReservationEntity> = {}) =>
    (await store.repository(ReservationEntity).save({
      site_id: SITE,
      room_id: 3,
      user_id: 10,
      checkin: "2026-08-10",
      checkout: "2026-08-14",
      status: "confirmed",
      payment_status: "paid",
      payout_status: "held",
      total: 400,
      total_cents: 40_000,
      amount_refunded: null,
      snapshot_version: 1,
      ...overrides,
    })) as unknown as ReservationEntity;

  const addSnapshot = (reservationId: number) =>
    store.repository(ReservationSnapshotEntity).save({
      reservation_id: reservationId,
      version: 1,
      reason: "checkout",
      payload: {
        total_cents: 40_000,
        price_lines: [
          {
            type: "accommodation",
            quantity: 4,
            unit_amount_cents: 9000,
            amount_cents: 36_000,
          },
        ],
        refund_policy: {
          cancellation: {
            policy_type: CANCELLATION_POLICY_TYPE.FREE_CANCELLATION,
            deadline_days: 7,
            penalty_type: PENALTY_TYPE.FIRST_NIGHT,
            no_show_policy: NO_SHOW_POLICY.SAME_AS_CANCELLATION,
            grace_after_booking_hours: null,
            early_cancellation_weeks: null,
          },
        },
      },
    });

  const reservation = async (id: number) =>
    (await store
      .repository(ReservationEntity)
      .findOne({ where: { id } })) as unknown as ReservationEntity;

  return {
    store,
    service,
    emails,
    payoutService,
    reservationService,
    addReservation,
    addSnapshot,
    reservation,
  };
};

describe("ReservationNoShowService.reportByHost", () => {
  it("opens a no_show incident and blocks only that payout", async () => {
    const { store, service, emails, addReservation, reservation } =
      createFixture();
    const target = await addReservation();
    const other = await addReservation();

    const result = await service.reportByHost(target.id, SITE, " No vino ", NOW);

    expect(result.payout_status).toBe("blocked");
    expect((await reservation(target.id)).payout_status).toBe("blocked");
    expect((await reservation(other.id)).payout_status).toBe("held");
    const incident = await store
      .repository(ReservationIncidentEntity)
      .findOne({ where: { id: result.incident_id } });
    expect(incident).toMatchObject({
      type: "no_show",
      status: "in_review",
      blocks_payout: true,
    });
    const dispute = await store
      .repository(ReservationDisputeEntity)
      .findOne({ where: { reservation_id: target.id } });
    expect(dispute).toMatchObject({ status: "open", source: "guest_report" });
    expect(emails.sendReservationEmail).toHaveBeenCalledWith(
      "no_show_reported_guest",
      expect.anything(),
      expect.anything(),
      { note: "No vino" },
    );
  });

  it("rejects before check-in, other sites and duplicates", async () => {
    const { service, addReservation } = createFixture();
    const future = await addReservation({ checkin: "2026-09-01", checkout: "2026-09-03" });
    const target = await addReservation();

    await expect(
      service.reportByHost(future.id, SITE, null, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.reportByHost(target.id, 7, null, NOW),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await service.reportByHost(target.id, SITE, null, NOW);
    await expect(
      service.reportByHost(target.id, SITE, null, NOW),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("ReservationNoShowService.resolveByAdmin", () => {
  it("confirm refunds per policy, unblocks and finalizes for immediate release", async () => {
    const {
      service,
      payoutService,
      reservationService,
      emails,
      addReservation,
      addSnapshot,
      reservation,
    } = createFixture();
    const target = await addReservation();
    await addSnapshot(target.id);
    const { incident_id } = await service.reportByHost(target.id, SITE, null, NOW);

    const result = await service.resolveByAdmin(
      incident_id,
      "confirm",
      "Confirmado con el alojamiento",
      { id: 3, name: "Vero" },
      NOW,
    );

    expect(payoutService.refundInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: target.id }),
      31_000,
      "no_show",
      expect.objectContaining({ responsible: "traveler" }),
    );
    expect(result).toMatchObject({
      decision: "confirm",
      refund_cents: 31_000,
      refund_id: "re_1",
      reservation_status: "finalized",
      payout_status: "held",
    });
    const saved = await reservation(target.id);
    expect(saved.feedback_deadline_at).toEqual(NOW);
    expect(
      reservationService.releaseRemainingAvailabilityForReservation,
    ).toHaveBeenCalledTimes(1);
    expect(emails.sendReservationEmail).toHaveBeenCalledWith(
      "no_show_confirmed_host",
      expect.anything(),
      expect.anything(),
      { note: "Confirmado con el alojamiento", refund_cents: 31_000 },
    );
  });

  it("reject unblocks without refund and keeps the reservation confirmed", async () => {
    const { service, payoutService, addReservation, reservation } =
      createFixture();
    const target = await addReservation();
    const { incident_id } = await service.reportByHost(target.id, SITE, null, NOW);

    const result = await service.resolveByAdmin(
      incident_id,
      "reject",
      null,
      null,
      NOW,
    );

    expect(payoutService.refundInTransaction).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      decision: "reject",
      refund_cents: 0,
      reservation_status: "confirmed",
      payout_status: "held",
    });
    expect((await reservation(target.id)).status).toBe("confirmed");
    await expect(
      service.resolveByAdmin(incident_id, "reject", null, null, NOW),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("keeps the payout blocked while another dispute is open", async () => {
    const { store, service, addReservation, reservation } = createFixture();
    const target = await addReservation();
    const { incident_id } = await service.reportByHost(target.id, SITE, null, NOW);
    await store.repository(ReservationDisputeEntity).save({
      reservation_id: target.id,
      source: "stripe",
      status: "open",
    });

    await service.resolveByAdmin(incident_id, "reject", null, null, NOW);

    expect((await reservation(target.id)).payout_status).toBe("blocked");
  });
});
