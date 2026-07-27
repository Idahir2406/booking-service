import type { Repository } from "typeorm";

import { BadRequestException } from "@nestjs/common";

import { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";
import { ReservationService } from "@/src/contexts/reservations/services/reservation.service";
import { ReservationLifecycleService } from "@/src/contexts/reservations/services/reservation-lifecycle.service";
import { computeReservationPolicyCapabilities } from "@/src/contexts/reservations/utils/reservation-policy.util";

const SITE_ID = 42;
const RESERVATION_ID = 7;

const createReservation = (
  overrides: Partial<ReservationEntity> = {},
): ReservationEntity =>
  Object.assign(new ReservationEntity(), {
    id: RESERVATION_ID,
    site_id: SITE_ID,
    room_id: "00000000-0000-4000-8000-000000000001",
    source: "internal",
    user_id: 10,
    checkin: "2026-07-16",
    checkout: "2026-07-20",
    guests: 2,
    pets: 1,
    subtotal: 400,
    commission: 0,
    total: 400,
    status: "confirmed",
    payment_status: "paid",
    payout_status: "held",
    expiration_date: new Date("2026-07-16T00:00:00.000Z"),
    created_at: new Date("2026-07-01T00:00:00.000Z"),
    updated_at: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  });

const createFixture = (reservation = createReservation()) => {
  const reservationRepository = {
    findOne: vi.fn().mockResolvedValue(reservation),
    preload: vi
      .fn()
      .mockImplementation((changes: Partial<ReservationEntity>) =>
        Promise.resolve(createReservation({ ...reservation, ...changes })),
      ),
    save: vi
      .fn()
      .mockImplementation((value: ReservationEntity) => Promise.resolve(value)),
  };
  const reservationService = {
    releaseAvailabilityForReservation: vi.fn().mockResolvedValue(),
    releaseRemainingAvailabilityForReservation: vi.fn().mockResolvedValue(),
    getSiteById: vi.fn().mockResolvedValue({ id: SITE_ID }),
  };
  const payoutService = {
    refundReservation: vi.fn().mockResolvedValue(),
  };
  const feedbackService = {
    createFeedbackToken: vi.fn().mockResolvedValue("feedback-token"),
  };
  const reservationEmailService = {
    sendCancelledEmails: vi.fn().mockResolvedValue(),
    sendFinalizedEmails: vi.fn().mockResolvedValue(),
  };
  const reservationEventService = {
    logEvent: vi.fn().mockResolvedValue(),
  };

  const service = new ReservationLifecycleService(
    reservationRepository as unknown as Repository<ReservationEntity>,
    reservationService as never,
    payoutService as never,
    feedbackService as never,
    reservationEmailService as never,
    reservationEventService as never,
  );

  return {
    service,
    reservationRepository,
    reservationService,
    payoutService,
    feedbackService,
    reservationEmailService,
    reservationEventService,
  };
};

describe("ReservationLifecycleService policy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows a refund exactly 24 hours before check-in", async () => {
    vi.setSystemTime(new Date("2026-07-15T00:00:00.000Z"));
    const fixture = createFixture();

    const result = await fixture.service.cancelReservation(RESERVATION_ID, {
      site_id: SITE_ID,
      refund: true,
      reason: "Cambio de planes",
    });

    expect(fixture.payoutService.refundReservation).toHaveBeenCalledWith(
      RESERVATION_ID,
    );
    expect(fixture.reservationRepository.preload).toHaveBeenCalledWith(
      expect.objectContaining({
        id: RESERVATION_ID,
        status: "cancelled",
        payment_status: "refunded",
        refund_on_cancel: true,
      }),
    );
    expect(result.payment_status).toBe("refunded");
  });

  it("rejects a late refund but allows cancellation without refund", async () => {
    vi.setSystemTime(new Date("2026-07-15T00:00:00.001Z"));
    const fixture = createFixture();

    await expect(
      fixture.service.cancelReservation(RESERVATION_ID, {
        site_id: SITE_ID,
        refund: true,
      }),
    ).rejects.toThrow(
      "Refund is not allowed: less than 24 hours before check-in or payout already released",
    );

    const result = await fixture.service.cancelReservation(RESERVATION_ID, {
      site_id: SITE_ID,
      refund: false,
    });

    expect(fixture.payoutService.refundReservation).not.toHaveBeenCalled();
    expect(result.status).toBe("cancelled");
    expect(result.refund_on_cancel).toBe(false);
    expect(
      fixture.reservationService.releaseAvailabilityForReservation,
    ).toHaveBeenCalledOnce();
  });

  it("allows cancellation without refund and finalization during the stay", async () => {
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    const reservation = createReservation();
    const policy = computeReservationPolicyCapabilities(reservation);
    const fixture = createFixture(reservation);

    expect(policy).toMatchObject({
      can_cancel: true,
      can_refund: false,
      can_finalize: true,
    });

    await fixture.service.cancelReservation(RESERVATION_ID, {
      site_id: SITE_ID,
      refund: false,
    });
    await fixture.service.finalizeReservation(RESERVATION_ID, SITE_ID);

    expect(
      fixture.reservationService.releaseAvailabilityForReservation,
    ).toHaveBeenCalledOnce();
    expect(
      fixture.reservationService.releaseRemainingAvailabilityForReservation,
    ).toHaveBeenCalledOnce();
  });

  it("rejects finalization before check-in", async () => {
    vi.setSystemTime(new Date("2026-07-15T23:59:59.999Z"));
    const fixture = createFixture();

    await expect(
      fixture.service.finalizeReservation(RESERVATION_ID, SITE_ID),
    ).rejects.toThrow(
      new BadRequestException("Cannot finalize before check-in date"),
    );

    expect(fixture.reservationRepository.preload).not.toHaveBeenCalled();
    expect(
      fixture.reservationService.releaseRemainingAvailabilityForReservation,
    ).not.toHaveBeenCalled();
  });

  it("releases only remaining availability on early finalization and keeps payout held", async () => {
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    const reservation = createReservation({ payout_status: "held" });
    const fixture = createFixture(reservation);

    const result = await fixture.service.finalizeReservation(
      RESERVATION_ID,
      SITE_ID,
    );

    expect(fixture.reservationRepository.preload).toHaveBeenCalledWith(
      expect.objectContaining({
        id: RESERVATION_ID,
        status: "finalized",
        payout_status: "held",
      }),
    );
    expect(
      fixture.reservationService.releaseRemainingAvailabilityForReservation,
    ).toHaveBeenCalledOnce();
    expect(
      fixture.reservationService.releaseAvailabilityForReservation,
    ).not.toHaveBeenCalled();
    expect(fixture.payoutService.refundReservation).not.toHaveBeenCalled();
    expect(fixture.feedbackService.createFeedbackToken).toHaveBeenCalledOnce();
    expect(result.payout_status).toBe("held");
  });

  it("rejects cancellation after checkout and still allows finalization", async () => {
    vi.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));
    const fixture = createFixture();

    await expect(
      fixture.service.cancelReservation(RESERVATION_ID, {
        site_id: SITE_ID,
        refund: false,
      }),
    ).rejects.toThrow("Cannot cancel after checkout; please finalize the stay");

    const result = await fixture.service.finalizeReservation(
      RESERVATION_ID,
      SITE_ID,
    );

    expect(result.status).toBe("finalized");
    expect(
      fixture.reservationService.releaseRemainingAvailabilityForReservation,
    ).toHaveBeenCalledOnce();
  });
});

describe("ReservationService remaining availability policy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("releases availability from today through the last reserved night", async () => {
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    const availabilityRows = [
      { id: "availability-17" },
      { id: "availability-18" },
      { id: "availability-19" },
    ];
    const availabilityService = {
      findByRoomAndIsoRange: vi.fn().mockResolvedValue(availabilityRows),
      update: vi.fn().mockResolvedValue(),
    };
    const service = new ReservationService(
      {} as never,
      {} as never,
      availabilityService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.releaseRemainingAvailabilityForReservation(
      createReservation(),
    );

    expect(availabilityService.findByRoomAndIsoRange).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      "2026-07-17",
      "2026-07-19",
    );
    expect(availabilityService.update).toHaveBeenCalledTimes(3);
    expect(availabilityService.update).toHaveBeenNthCalledWith(
      1,
      "availability-17",
      { is_available: true },
    );
    expect(availabilityService.update).toHaveBeenNthCalledWith(
      3,
      "availability-19",
      { is_available: true },
    );
  });
});
