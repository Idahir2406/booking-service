import type { EntityManager, Repository } from "typeorm";

import { BadRequestException } from "@nestjs/common";

import { createEconomicsStub } from "@/tests/utils/economics";

import { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";
import { ReservationService } from "@/src/contexts/reservations/services/reservation.service";
import { ReservationLifecycleService } from "@/src/contexts/reservations/services/reservation-lifecycle.service";
import { computeReservationPolicyCapabilities } from "@/src/contexts/reservations/utils/reservation-policy.util";

interface UpdateBuilderMock {
  update: () => UpdateBuilderMock;
  set: (value: unknown) => UpdateBuilderMock;
  where: (sql: string, params: Record<string, unknown>) => UpdateBuilderMock;
  andWhere: (sql: string, params: Record<string, unknown>) => UpdateBuilderMock;
  execute: () => Promise<unknown>;
}

const SITE_ID = 42;
const RESERVATION_ID = 7;
const ROOM_ID = 3;

const createReservation = (
  overrides: Partial<ReservationEntity> = {},
): ReservationEntity =>
  Object.assign(new ReservationEntity(), {
    id: RESERVATION_ID,
    site_id: SITE_ID,
    room_id: ROOM_ID,
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
    refund_seq: 0,
    stripe_payment_intent_id: "pi_test",
    expiration_date: new Date("2026-07-16T00:00:00.000Z"),
    created_at: new Date("2026-07-01T00:00:00.000Z"),
    updated_at: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  });

const createFixture = (initial = createReservation()) => {
  // Persisted state shared by every transaction of the fixture.
  let stored = createReservation(initial);
  const lockedFindOne = vi.fn(
    (options: { lock?: { mode: string } }): Promise<ReservationEntity> => {
      expect(options.lock?.mode).toBe("pessimistic_write");
      return Promise.resolve(createReservation(stored));
    },
  );
  const save = vi.fn((value: ReservationEntity) => {
    stored = createReservation(value);
    return Promise.resolve(value);
  });
  const manager = {
    getRepository: vi.fn(() => ({ findOne: lockedFindOne, save })),
  } as unknown as EntityManager;
  const reservationRepository = {
    manager: {
      transaction: vi.fn((run: (manager: EntityManager) => Promise<unknown>) =>
        run(manager),
      ),
    },
  };
  const reservationService = {
    releaseAvailabilityForReservation: vi.fn(() => Promise.resolve()),
    releaseRemainingAvailabilityForReservation: vi.fn(() => Promise.resolve()),
    getSiteById: vi.fn().mockResolvedValue({ id: SITE_ID }),
  };
  const payoutService = {
    refundInTransaction: vi.fn(
      (_manager: EntityManager, reservation: ReservationEntity) => {
        reservation.payment_status = "refunded";
        reservation.refund_seq += 1;
        return Promise.resolve({ refundId: "re_1", isPartial: false });
      },
    ),
  };
  const feedbackService = {
    createFeedbackToken: vi.fn().mockResolvedValue("feedback-token"),
  };
  const reservationEmailService = {
    sendCancelledEmails: vi.fn(() => Promise.resolve()),
    sendFinalizedEmails: vi.fn(() => Promise.resolve()),
  };
  const reservationEventService = {
    logEventInTransaction: vi.fn(() => Promise.resolve()),
  };

  const service = new ReservationLifecycleService(
    reservationRepository as unknown as Repository<ReservationEntity>,
    reservationService as never,
    payoutService as never,
    feedbackService as never,
    reservationEmailService as never,
    reservationEventService as never,
    createEconomicsStub() as never,
  );

  return {
    service,
    save,
    lockedFindOne,
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

  it("rejects host unilateral cancellation (B10)", async () => {
    vi.setSystemTime(new Date("2026-07-15T00:00:00.000Z"));
    const fixture = createFixture();

    await expect(
      fixture.service.cancelReservation(RESERVATION_ID, {
        site_id: SITE_ID,
        refund: true,
        reason: "Cambio de planes",
      }),
    ).rejects.toThrow(BadRequestException);

    expect(fixture.payoutService.refundInTransaction).not.toHaveBeenCalled();
  });

  it("allows finalization during the stay when refund window has passed", async () => {
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    const reservation = createReservation();
    const policy = computeReservationPolicyCapabilities(reservation);
    const fixture = createFixture(reservation);

    expect(policy).toMatchObject({
      can_cancel: true,
      can_refund: false,
      can_finalize: true,
    });

    await fixture.service.finalizeReservation(RESERVATION_ID, SITE_ID);

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

    expect(fixture.save).not.toHaveBeenCalled();
    expect(
      fixture.reservationService.releaseRemainingAvailabilityForReservation,
    ).not.toHaveBeenCalled();
  });

  it("releases only remaining availability on early finalization and keeps payout held", async () => {
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    const fixture = createFixture(createReservation({ payout_status: "held" }));

    const result = await fixture.service.finalizeReservation(
      RESERVATION_ID,
      SITE_ID,
    );

    expect(fixture.save).toHaveBeenCalledWith(
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
    expect(fixture.payoutService.refundInTransaction).not.toHaveBeenCalled();
    expect(fixture.feedbackService.createFeedbackToken).toHaveBeenCalledOnce();
    expect(result.payout_status).toBe("held");
  });

  it("allows finalization after checkout", async () => {
    vi.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));
    const fixture = createFixture();

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

  it("releases availability from today through the last reserved night (UTC dates)", async () => {
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    const where: Record<string, unknown> = {};
    const setCalls: unknown[] = [];
    const builder: UpdateBuilderMock = {
      update: () => builder,
      set: value => {
        setCalls.push(value);
        return builder;
      },
      where: (_sql, params) => {
        Object.assign(where, params);
        return builder;
      },
      andWhere: (_sql, params) => {
        Object.assign(where, params);
        return builder;
      },
      execute: () => Promise.resolve({ affected: 3 }),
    };
    const manager = {
      getRepository: vi.fn(() => ({ createQueryBuilder: () => builder })),
    };
    const service = new ReservationService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.releaseRemainingAvailabilityForReservation(
      createReservation(),
      manager as unknown as EntityManager,
    );

    expect(setCalls).toEqual([{ is_available: true }]);
    expect(where).toMatchObject({
      siteId: SITE_ID,
      roomId: ROOM_ID,
      firstNight: "2026-07-17",
      lastNight: "2026-07-19",
    });
  });
});
