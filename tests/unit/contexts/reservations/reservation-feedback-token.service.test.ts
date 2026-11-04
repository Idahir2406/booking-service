import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from "@nestjs/common";

import { FakeEntityStore } from "@/tests/utils/fake-entity-store";

import { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";
import { ReservationDisputeEntity } from "@/src/contexts/reservations/entities/reservation-dispute.entity";
import { ReservationFeedbackTokenEntity } from "@/src/contexts/reservations/entities/reservation-feedback-token.entity";
import { ReservationGuestFeedbackEntity } from "@/src/contexts/reservations/entities/reservation-guest-feedback.entity";
import { ReservationFeedbackService } from "@/src/contexts/reservations/services/reservation-feedback.service";

const OWNER = 10;
const DEADLINE = new Date("2099-12-31T00:00:00.000Z");

const createFixture = () => {
  const store = new FakeEntityStore();
  const service = new ReservationFeedbackService(
    store.repository(ReservationEntity) as never,
    store.repository(ReservationFeedbackTokenEntity) as never,
    store.repository(ReservationGuestFeedbackEntity) as never,
    store.repository(ReservationDisputeEntity) as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const addReservation = async (overrides: Partial<ReservationEntity> = {}) =>
    (await store.repository(ReservationEntity).save({
      site_id: 42,
      room_id: 3,
      user_id: OWNER,
      checkin: "2026-07-16",
      checkout: "2026-07-20",
      status: "finalized",
      payment_status: "paid",
      payout_status: "held",
      feedback_deadline_at: DEADLINE,
      ...overrides,
    })) as unknown as ReservationEntity;
  return { store, service, addReservation };
};

describe("ReservationFeedbackService.issueTravelerFeedbackToken", () => {
  it("issues a fresh hashed token valid until the feedback deadline", async () => {
    const { store, service, addReservation } = createFixture();
    const reservation = await addReservation();

    const result = await service.issueTravelerFeedbackToken(
      OWNER,
      reservation.id,
    );

    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.expires_at).toBe(DEADLINE.toISOString());
    const [stored] = store.rows(ReservationFeedbackTokenEntity);
    expect(stored.reservation_id).toBe(reservation.id);
    expect(stored.token_hash).toBe(service.hashToken(result.token));
    expect(stored.token_hash).not.toBe(result.token);
  });

  it("rejects another owner with 403 and a missing reservation with 404", async () => {
    const { service, addReservation } = createFixture();
    const reservation = await addReservation();

    await expect(
      service.issueTravelerFeedbackToken(99, reservation.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.issueTravelerFeedbackToken(0, reservation.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.issueTravelerFeedbackToken(OWNER, 999),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("requires a finalized reservation", async () => {
    const { service, addReservation } = createFixture();
    const reservation = await addReservation({ status: "confirmed" });

    await expect(
      service.issueTravelerFeedbackToken(OWNER, reservation.id),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("409 when feedback already exists", async () => {
    const { store, service, addReservation } = createFixture();
    const reservation = await addReservation();
    await store.repository(ReservationGuestFeedbackEntity).save({
      reservation_id: reservation.id,
      type: "review",
      rating: 5,
    });

    await expect(
      service.issueTravelerFeedbackToken(OWNER, reservation.id),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("410 when the feedback window expired or never opened", async () => {
    const { store, service, addReservation } = createFixture();
    const expired = await addReservation({
      feedback_deadline_at: new Date("2020-01-01T00:00:00.000Z"),
    });
    const noDeadline = await addReservation({
      feedback_deadline_at: undefined,
    });

    await expect(
      service.issueTravelerFeedbackToken(OWNER, expired.id),
    ).rejects.toBeInstanceOf(GoneException);
    await expect(
      service.issueTravelerFeedbackToken(OWNER, noDeadline.id),
    ).rejects.toBeInstanceOf(GoneException);
    expect(store.rows(ReservationFeedbackTokenEntity)).toHaveLength(0);
  });
});
