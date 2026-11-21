import type { BookResult } from "@/src/contexts/providers/domain/provider.types";

import { FindOperator } from "typeorm";

import { ProviderCronsService } from "@/src/contexts/provider-reservations/services/provider-crons.service";
import { ProviderHotelSyncService } from "@/src/contexts/provider-reservations/services/provider-hotel-sync.service";
import {
  ProviderIncidentService,
  providerIncidentTag,
} from "@/src/contexts/provider-reservations/services/provider-incident.service";
import { ProviderReconciliationService } from "@/src/contexts/provider-reservations/services/provider-reconciliation.service";
import { ProviderNotFoundError } from "@/src/contexts/providers/domain/provider.errors";
import { envs } from "@/src/contexts/shared/configs/envs";

function bookResult(overrides: Partial<BookResult> = {}): BookResult {
  return {
    bookingId: "BK-1",
    clientReference: "V4P-1",
    status: "CONFIRMED",
    rawStatus: "CONFIRMED",
    hotelConfirmationCode: null,
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

function operatorValue(value: unknown): unknown {
  return value instanceof FindOperator ? value.value : value;
}

const queryBuilder = () => {
  const calls: { where: string[]; params: Record<string, unknown> } = {
    where: [],
    params: {},
  };
  const builder = {
    select: () => builder,
    where: (sql: string, params: Record<string, unknown>) => {
      calls.where.push(sql);
      Object.assign(calls.params, params);
      return builder;
    },
    andWhere: (sql: string, params: Record<string, unknown>) => {
      calls.where.push(sql);
      Object.assign(calls.params, params);
      return builder;
    },
    orderBy: () => builder,
    take: () => builder,
    getMany: vi.fn(() => Promise.resolve([{ id: 3 }])),
  };
  return { builder, calls };
};

const createCrons = () => {
  const qb = queryBuilder();
  const repository = {
    find: vi.fn(() => Promise.resolve([{ id: 1 }, { id: 2 }])),
    createQueryBuilder: vi.fn(() => qb.builder),
  };
  const booking = {
    resolvePending: vi.fn(() => Promise.resolve({ outcome: "pending" })),
  };
  const cancellation = {
    resolvePendingCancellation: vi.fn(() =>
      Promise.resolve({ outcome: "pending" }),
    ),
  };
  const reconciliation = {
    run: vi.fn(() => Promise.resolve({ checked: 0 })),
  };
  const hotelSync = { run: vi.fn(() => Promise.resolve({ synced: 0 })) };
  const crons = new ProviderCronsService(
    repository as never,
    booking as never,
    cancellation as never,
    reconciliation as never,
    hotelSync as never,
  );
  return { crons, repository, booking, cancellation, qb, reconciliation };
};

describe("ProviderCronsService", () => {
  afterEach(() => {
    Object.assign(envs, { PROVIDER_CRONS_ENABLED: true });
  });

  it("selects booking + prebooked-authorized rows and pending cancellations", async () => {
    const { crons, repository, booking, cancellation, qb } = createCrons();
    const now = new Date("2027-06-01T00:00:00Z");

    const summary = await crons.processPending(now);

    const options = (
      repository.find.mock.calls[0] as unknown as [
        { where: Record<string, unknown>[] },
      ]
    )[0];
    expect(options.where).toHaveLength(2);
    expect(options.where[0]).toEqual({
      source: "nuitee",
      provider_status: "booking",
    });
    expect(options.where[1]).toMatchObject({
      source: "nuitee",
      provider_status: "prebooked",
    });
    expect(
      String(
        (options.where[1]?.stripe_payment_intent_id as FindOperator<unknown>)
          .type,
      ),
    ).toBe("not");
    expect(booking.resolvePending.mock.calls).toEqual([
      [1, now],
      [2, now],
    ]);
    expect(qb.calls.params).toMatchObject({
      source: "nuitee",
      providerStatus: "confirmed",
      cancellationStatuses: ["requested", "pending"],
    });
    expect(qb.calls.where.join(" ")).toContain("$.cancellation.status");
    expect(cancellation.resolvePendingCancellation).toHaveBeenCalledWith(
      3,
      now,
    );
    expect(summary).toEqual({ bookings: 2, cancellations: 1, errors: 0 });
  });

  it("keeps going when one reservation fails", async () => {
    const { crons, booking } = createCrons();
    booking.resolvePending.mockRejectedValueOnce(new Error("boom"));

    const summary = await crons.processPending();

    expect(summary).toEqual({ bookings: 1, cancellations: 1, errors: 1 });
  });

  it("never overlaps the same job and honours PROVIDER_CRONS_ENABLED", async () => {
    const { crons, reconciliation } = createCrons();
    const gate: { release?: () => void } = {};
    reconciliation.run.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          gate.release = () => {
            resolve({ checked: 1 });
          };
        }),
    );

    const first = crons.reconcileCron();
    const second = await crons.reconcileCron();
    gate.release?.();

    expect(second).toBeNull();
    expect(await first).toEqual({ checked: 1 });
    expect(reconciliation.run).toHaveBeenCalledTimes(1);

    Object.assign(envs, { PROVIDER_CRONS_ENABLED: false });
    expect(await crons.reconcileCron()).toBeNull();
    expect(reconciliation.run).toHaveBeenCalledTimes(1);
  });
});

const reservation = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  site_id: 42,
  user_id: 7,
  source: "nuitee",
  status: "confirmed",
  provider_status: "confirmed",
  external_reservation_id: "BK-1",
  checkin: "2027-06-10",
  provider_booking_json: {},
  ...overrides,
});

const createReconcile = (rows: Record<string, unknown>[]) => {
  const repository = { find: vi.fn(() => Promise.resolve(rows)) };
  const offerRepository = {
    findOne: vi.fn(() =>
      Promise.resolve({ net_cents: 20_000, currency: "EUR" }),
    ),
  };
  const provider = {
    getBooking: vi.fn<[string], Promise<BookResult>>(() =>
      Promise.resolve(bookResult()),
    ),
  };
  const cancellation = {
    handleProviderCancelled: vi.fn(() =>
      Promise.resolve({ outcome: "cancelled" }),
    ),
  };
  const created = new Set<string>();
  const incidents = {
    openOnce: vi.fn((input: { reservationId: number; key: string }) => {
      const key = `${input.reservationId}:${input.key}`;
      if (created.has(key)) {
        return Promise.resolve(null);
      }
      created.add(key);
      return Promise.resolve({ id: created.size });
    }),
  };
  const notifier = { alertAdmin: vi.fn(() => Promise.resolve()) };
  const service = new ProviderReconciliationService(
    repository as never,
    offerRepository as never,
    { get: () => provider } as never,
    cancellation as never,
    incidents as never,
    notifier as never,
  );
  return {
    service,
    repository,
    provider,
    cancellation,
    incidents,
    notifier,
    offerRepository,
  };
};

describe("ProviderReconciliationService", () => {
  const NOW = new Date("2027-06-01T04:30:00Z");

  it("queries nuitee confirmed/cancelled rows with checkin >= yesterday or recently updated", async () => {
    const { service, repository } = createReconcile([]);

    await service.run(NOW);

    const options = (
      repository.find.mock.calls[0] as unknown as [
        { where: Record<string, unknown>[] },
      ]
    )[0];
    expect(options.where).toHaveLength(2);
    expect(options.where[0]?.source).toBe("nuitee");
    expect(operatorValue(options.where[0]?.provider_status)).toEqual([
      "confirmed",
      "cancelled",
    ]);
    expect(operatorValue(options.where[0]?.checkin)).toBe("2027-05-31");
    expect(operatorValue(options.where[1]?.updated_at)).toEqual(
      new Date("2027-05-02T04:30:00Z"),
    );
  });

  it("hotel cancellation missed by the webhook goes through the refund path", async () => {
    const fx = createReconcile([reservation()]);
    fx.provider.getBooking.mockResolvedValueOnce(
      bookResult({ status: "CANCELLED", rawStatus: "CANCELLED" }),
    );

    const summary = await fx.service.run(NOW);

    expect(fx.cancellation.handleProviderCancelled).toHaveBeenCalledWith(
      1,
      "CANCELLED",
      "reconciliation",
    );
    expect(summary.autoCancelled).toBe(1);
    expect(fx.incidents.openOnce).not.toHaveBeenCalled();
  });

  it("status and amount mismatches open one incident (deduped) + one alert", async () => {
    const rows = [
      reservation({ id: 2, status: "cancelled", provider_status: "cancelled" }),
      reservation({ id: 3 }),
    ];
    const fx = createReconcile(rows);
    fx.provider.getBooking.mockImplementation(id =>
      Promise.resolve(
        id === "BK-1" ? bookResult({ totalCents: 21_000 }) : bookResult(),
      ),
    );

    const first = await fx.service.run(NOW);
    const second = await fx.service.run(NOW);

    expect(first).toMatchObject({ mismatches: 2, incidentsOpened: 2 });
    expect(second).toMatchObject({ mismatches: 2, incidentsOpened: 0 });
    expect(fx.notifier.alertAdmin).toHaveBeenCalledTimes(2);
    const keys = fx.incidents.openOnce.mock.calls.map(
      call => (call as unknown as [{ key: string }])[0].key,
    );
    expect(keys).toContain("reconcile:confirmed_at_provider");
    expect(keys).toContain("reconcile:amount:21000EUR");
  });

  it("skips rows with a V4P cancellation in flight and unknown statuses", async () => {
    const fx = createReconcile([
      reservation({
        provider_booking_json: {
          cancellation: { status: "pending", requested_at: "2027-05-31" },
        },
      }),
      reservation({ id: 4 }),
    ]);
    fx.provider.getBooking.mockResolvedValueOnce(
      bookResult({ status: "PENDING_UNKNOWN" }),
    );

    const summary = await fx.service.run(NOW);

    expect(fx.provider.getBooking).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ checked: 1, mismatches: 0 });
  });

  it("booking missing at the provider is reported", async () => {
    const fx = createReconcile([reservation()]);
    fx.provider.getBooking.mockRejectedValueOnce(
      new ProviderNotFoundError({ provider: "nuitee", message: "404" }),
    );

    const summary = await fx.service.run(NOW);

    expect(summary.incidentsOpened).toBe(1);
    expect(fx.incidents.openOnce).toHaveBeenCalledWith(
      expect.objectContaining({ key: "reconcile:not_found_at_provider" }),
    );
  });
});

describe("ProviderIncidentService.openOnce", () => {
  it("creates an `other` in_review incident tagged with the key, once", async () => {
    const rows: Record<string, unknown>[] = [];
    const repository = {
      findOne: vi.fn((options: { where: { description: unknown } }) => {
        const like = String(operatorValue(options.where.description)).replace(
          "%",
          "",
        );
        return Promise.resolve(
          rows.find(row => String(row.description).startsWith(like)) ?? null,
        );
      }),
      create: (value: Record<string, unknown>) => value,
      save: vi.fn((value: Record<string, unknown>) => {
        const saved = { ...value, id: rows.length + 1 };
        rows.push(saved);
        return Promise.resolve(saved);
      }),
    };
    const events = { logEvent: vi.fn(() => Promise.resolve()) };
    const service = new ProviderIncidentService(
      repository as never,
      events as never,
    );
    const input = {
      reservationId: 5,
      userId: 7,
      key: "hotel_cancelled",
      description: "x",
    };

    const first = await service.openOnce(input);
    const second = await service.openOnce(input);

    expect(first).toMatchObject({
      type: "other",
      status: "in_review",
      reservation_id: 5,
      blocks_payout: false,
    });
    expect(String(first?.description)).toMatch(
      new RegExp(`^\\${providerIncidentTag(5, "hotel_cancelled")}`),
    );
    expect(second).toBeNull();
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(events.logEvent).toHaveBeenCalledTimes(1);
  });
});

const hotel = (overrides: Record<string, unknown> = {}) => ({
  id: "lp1",
  name: "Hotel Uno",
  petsAllowed: true,
  petPolicy: { allowed: true, text: "Perros sí" },
  images: [],
  ...overrides,
});

describe("ProviderHotelSyncService", () => {
  it("refreshes snapshots, pauses no-pets / delisted hotels and mails a digest", async () => {
    const properties = [
      {
        id: 1,
        provider: "nuitee",
        provider_hotel_id: "lp1",
        site_id: 11,
        status: "active",
      },
      {
        id: 2,
        provider: "nuitee",
        provider_hotel_id: "lp2",
        site_id: 12,
        status: "active",
      },
      {
        id: 3,
        provider: "nuitee",
        provider_hotel_id: "lp3",
        site_id: 13,
        status: "active",
      },
      {
        id: 4,
        provider: "nuitee",
        provider_hotel_id: "lp4",
        site_id: 14,
        status: "paused",
      },
    ];
    const repository = {
      find: vi.fn(() => Promise.resolve(properties)),
      update: vi.fn(() => Promise.resolve({ affected: 1 })),
    };
    const provider = {
      getHotel: vi.fn((id: string) => {
        if (id === "lp2") {
          return Promise.resolve(hotel({ id, petsAllowed: false }));
        }
        if (id === "lp3") {
          return Promise.reject(
            new ProviderNotFoundError({ provider: "nuitee", message: "404" }),
          );
        }
        if (id === "lp4") {
          return Promise.reject(new Error("timeout"));
        }
        return Promise.resolve(hotel({ id }));
      }),
    };
    const notifier = { sendAdminDigest: vi.fn(() => Promise.resolve()) };
    const service = new ProviderHotelSyncService(
      repository as never,
      { get: () => provider } as never,
      notifier as never,
    );
    const now = new Date("2027-06-07T05:00:00Z");

    const summary = await service.run(now);

    const where = (
      repository.find.mock.calls[0] as unknown as [
        { where: { status: unknown } },
      ]
    )[0].where;
    expect(operatorValue(where.status)).toEqual(["active", "paused"]);
    expect(summary).toMatchObject({ synced: 2, paused: 2, errors: 1 });
    expect(repository.update).toHaveBeenCalledWith(1, {
      pets_snapshot: { petsAllowed: true, petPolicy: hotel().petPolicy },
      content_snapshot: hotel(),
      last_synced_at: now,
    });
    expect(repository.update).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ status: "paused", last_synced_at: now }),
    );
    expect(repository.update).toHaveBeenCalledWith(3, {
      status: "paused",
      last_synced_at: now,
    });
    expect(repository.update).not.toHaveBeenCalledWith(4, expect.anything());
    const [, lines] = notifier.sendAdminDigest.mock.calls[0] as unknown as [
      string,
      string[],
    ];
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("ya no admite mascotas");
    expect(lines[1]).toContain("404");
  });
});
