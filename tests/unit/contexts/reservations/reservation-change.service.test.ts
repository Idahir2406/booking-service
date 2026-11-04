import type { PriceLineDraft } from "@/src/contexts/payments/domain/price-lines";
import type { ReservationSnapshotPayload } from "@/src/contexts/payments/domain/reservation-snapshot";
import type { QuoteReservationResult } from "@/src/contexts/reservations/services/reservation.service";

import { HttpException } from "@nestjs/common";
import { vi } from "vitest";

import { createEconomics } from "@/tests/utils/economics";
import { FakeReservationDb } from "@/tests/utils/fake-reservation-db";

import { summarizePriceLines } from "@/src/contexts/payments/domain/price-lines";
import { buildReservationSnapshotPayload } from "@/src/contexts/payments/domain/reservation-snapshot";
import { AuditLogEntity } from "@/src/contexts/payments/entities/audit-log.entity";
import { ReservationPriceLineEntity } from "@/src/contexts/payments/entities/reservation-price-line.entity";
import { ReservationSnapshotEntity } from "@/src/contexts/payments/entities/reservation-snapshot.entity";
import { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";
import { ReservationAlternativeEntity } from "@/src/contexts/reservations/entities/reservation-alternative.entity";
import { ReservationChangeProposalEntity } from "@/src/contexts/reservations/entities/reservation-change-proposal.entity";
import { ReservationChangeRequestEntity } from "@/src/contexts/reservations/entities/reservation-change-request.entity";
import { ReservationEventEntity } from "@/src/contexts/reservations/entities/reservation-event.entity";
import { ReservationService } from "@/src/contexts/reservations/services/reservation.service";
import { ReservationAlternativeService } from "@/src/contexts/reservations/services/reservation-alternative.service";
import { ReservationChangeService } from "@/src/contexts/reservations/services/reservation-change.service";
import { ReservationChangeApplyService } from "@/src/contexts/reservations/services/reservation-change-apply.service";
import { ReservationChangeQueryService } from "@/src/contexts/reservations/services/reservation-change-query.service";
import { ReservationEventService } from "@/src/contexts/reservations/services/reservation-event.service";

const OWNER = 10;
const OTHER = 99;
const SITE = 42;
const ROOM = 3;
const NOW = new Date("2099-07-01T10:00:00.000Z");
const CHECKIN = "2099-08-10";
const CHECKOUT = "2099-08-12";
const NIGHTS = [
  "2099-08-08",
  "2099-08-09",
  "2099-08-10",
  "2099-08-11",
  "2099-08-12",
  "2099-08-13",
  "2099-08-14",
];

const accommodation = (cents: number, nights: number): PriceLineDraft => ({
  type: "accommodation",
  description: "Alojamiento · Suite",
  quantity: nights,
  unit_amount_cents: Math.round(cents / nights),
  amount_cents: cents,
  is_optional: false,
  is_commissionable: true,
  is_penalizable: true,
});

const DOG = {
  index: 0,
  name: "Luna",
  weight_kg: 12,
  is_ppp: false,
  room_id: ROOM,
  size: { id: 2, name: "Mediano", slug: "medium", rank: 2 },
  saved_dog_id: 7,
};

const snapshotV1 = (): ReservationSnapshotPayload => {
  const lines = [accommodation(20_000, 2)];
  return buildReservationSnapshotPayload({
    stay: { site_id: SITE, checkin: CHECKIN, checkout: CHECKOUT, nights: 2, guests: 2, pets: 1 },
    room: { id: ROOM, name: "Suite", max_guests: 4, max_pets: 2, price_per_night_cents: 10_000 },
    board: null,
    currency: "eur",
    lines,
    totals: summarizePriceLines(lines),
    commissionRate: 0.12,
    commissionCents: 2400,
    timezone: "Europe/Madrid",
    deadlineLocalTime: null,
    source: "checkout",
    commissionBase: "commissionable",
    extension: {
      dogs: [DOG],
      compatibility: { mode: "full", compatible: true, dogs_declared: true },
      dog_policy: null,
      services: [],
      extras: [],
      deposit: null,
      tourist_tax: null,
    },
  });
};

interface QuoteOptions {
  valid?: boolean;
  errors?: string[];
  dogViolations?: string[];
  nights?: number;
}

const quoteResult = (
  totalCents: number,
  options: QuoteOptions = {},
): QuoteReservationResult => {
  const nights = options.nights ?? 2;
  const lines = [accommodation(totalCents, nights)];
  const violations = (options.dogViolations ?? []).map(message => ({
    code: "max_size",
    message,
  }));
  const errors = [...(options.errors ?? []), ...violations.map(v => v.message)];
  return {
    valid: options.valid ?? errors.length === 0,
    nights,
    nightly_rate: 100,
    base_subtotal: totalCents / 100,
    board_amount: 0,
    subtotal: totalCents / 100,
    commission: 0,
    total: totalCents / 100,
    min_nights: null,
    max_nights: null,
    board_option: null,
    extras: [],
    errors,
    compatibility: {
      compatible: violations.length === 0,
      violations,
    } as never,
    internal: {
      lines,
      totals: summarizePriceLines(lines),
      pets: 1,
      board: null,
      snapshotExtension: {
        dogs: [{ ...DOG, saved_dog_id: undefined }],
        compatibility: { mode: "full", compatible: violations.length === 0, dogs_declared: true },
        dog_policy: null,
        services: [],
        extras: [],
        deposit: null,
        tourist_tax: null,
      },
    },
  };
};

const createFixture = () => {
  const db = new FakeReservationDb();
  const store = db.store;
  const { economics, snapshots, lines } = createEconomics(store);
  const events = new ReservationEventService(
    store.repository(ReservationEventEntity) as never,
  );
  const blocksService = { find_blocking_overlap: vi.fn().mockResolvedValue(null) };
  const mysqlService = {
    queryOne: vi.fn((_sql: string, params: number[]) =>
      Promise.resolve({ id: params[0], name: `Casa ${params[0]}`, user_id: 5 }),
    ),
  };
  const reservationRepository = {
    findOne: (options: { where: Record<string, unknown> }) =>
      db.manager().getRepository(ReservationEntity).findOne(options),
    manager: {
      transaction: <T>(run: (m: ReturnType<FakeReservationDb["manager"]>) => Promise<T>) =>
        db.transaction(run),
    },
  };
  const reservationService = new ReservationService(
    reservationRepository as never,
    mysqlService as never,
    {} as never,
    blocksService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    events,
    economics,
    {} as never,
    {} as never,
  );
  const quote = vi
    .spyOn(reservationService, "quoteReservation")
    .mockResolvedValue(quoteResult(20_000));
  vi.spyOn(reservationService, "loadSnapshotRoom").mockResolvedValue({
    id: 9,
    name: "Cabaña",
    max_guests: 4,
    max_pets: 2,
    price_per_night_cents: 10_000,
  });
  const payout = {
    refundInTransaction: vi.fn(
      (_m: unknown, reservation: ReservationEntity, cents: number) => {
        reservation.refund_seq += 1;
        reservation.amount_refunded = cents / 100;
        reservation.payment_status = "partially_refunded";
        return Promise.resolve({ refundId: "re_1", isPartial: true });
      },
    ),
  };
  const query = new ReservationChangeQueryService(
    store.repository(ReservationChangeRequestEntity) as never,
    store.repository(ReservationChangeProposalEntity) as never,
    store.repository(ReservationAlternativeEntity) as never,
  );
  const apply = new ReservationChangeApplyService(
    reservationService,
    payout as never,
    economics,
    snapshots,
    lines,
    events,
  );
  const service = new ReservationChangeService(
    reservationRepository as never,
    store.repository(ReservationChangeRequestEntity) as never,
    store.repository(ReservationChangeProposalEntity) as never,
    query,
    apply,
    economics,
    events,
  );
  const alternatives = new ReservationAlternativeService(
    reservationRepository as never,
    store.repository(ReservationAlternativeEntity) as never,
    query,
    apply,
    economics,
    events,
    reservationService,
  );

  db.seedNights(SITE, ROOM, NIGHTS, true);
  const setNight = (siteId: number, roomId: number, date: string, available: boolean) => {
    const row = db.availability.find(
      night => night.site_id === siteId && night.room_id === roomId && night.date === date,
    );
    if (row) {
      row.is_available = available;
    }
  };
  // The confirmed reservation holds its nights (activateFromPayment).
  setNight(SITE, ROOM, "2099-08-10", false);
  setNight(SITE, ROOM, "2099-08-11", false);

  const reservation = db.seedReservation(
    Object.assign(new ReservationEntity(), {
      id: 1,
      site_id: SITE,
      room_id: ROOM,
      source: "internal",
      user_id: OWNER,
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guests: 2,
      pets: 1,
      subtotal: 200,
      commission: 0,
      total: 200,
      total_cents: 20_000,
      commission_rate: 0.12,
      commission_cents: 2400,
      currency: "eur",
      timezone: "Europe/Madrid",
      status: "confirmed",
      payment_status: "paid",
      payout_status: "held",
      refund_seq: 0,
      snapshot_version: 1,
      stripe_payment_intent_id: "pi_1",
      expiration_date: new Date("2099-06-01T00:00:00Z"),
    }),
  );
  const v1 = snapshotV1();
  void store.repository(ReservationSnapshotEntity).save({
    reservation_id: reservation.id,
    version: 1,
    reason: "checkout",
    payload: structuredClone(v1),
  });

  const stored = () => db.reservations.get(reservation.id) as ReservationEntity;
  const snapshotRows = () => store.rows(ReservationSnapshotEntity);
  const audits = (action: string) =>
    store.rows(AuditLogEntity).filter(row => row.action === action);
  const night = (siteId: number, roomId: number, date: string) =>
    db.availability.find(
      row => row.site_id === siteId && row.room_id === roomId && row.date === date,
    )?.is_available;

  const openRequest = () =>
    service.createRequest(OWNER, reservation.id, { type: "change_dates", message: "Un día más tarde" }, NOW);

  const proposeDates = async (
    totalCents: number,
    checkin = "2099-08-11",
    checkout = "2099-08-13",
    extra: Record<string, unknown> = {},
  ) => {
    const request = await openRequest();
    quote.mockResolvedValueOnce(quoteResult(totalCents));
    const admin = await service.createProposal(
      request.id,
      { checkin, checkout, ...extra },
      NOW,
    );
    const proposal = admin.proposals[0];
    return { request: admin, proposal };
  };

  return {
    db,
    store,
    service,
    alternatives,
    quote,
    payout,
    mysqlService,
    reservation,
    v1,
    stored,
    snapshotRows,
    audits,
    night,
    setNight,
    openRequest,
    proposeDates,
  };
};

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      const body = error.getResponse() as { code?: string };
      return { status: error.getStatus(), code: body.code ?? null };
    }
    throw error;
  }
  throw new Error("expected an HttpException");
};

describe("ReservationChangeService (F-PV7b)", () => {
  describe("change requests", () => {
    it("creating a request does not modify the reservation nor its snapshot", async () => {
      const f = createFixture();
      const before = { ...f.stored() };

      const request = await f.openRequest();

      expect(request).toMatchObject({
        type: "change_dates",
        status: "received",
        message: "Un día más tarde",
        can_cancel: true,
        proposals: [],
      });
      expect(f.stored()).toMatchObject({
        checkin: before.checkin,
        checkout: before.checkout,
        status: "confirmed",
        snapshot_version: 1,
      });
      expect(f.snapshotRows()).toHaveLength(1);
      expect(f.snapshotRows()[0].payload).toEqual(f.v1);
    });

    it("only one open request per reservation (409 open_request_exists)", async () => {
      const f = createFixture();
      await f.openRequest();
      expect(await codeOf(f.openRequest())).toEqual({ status: 409, code: "open_request_exists" });
    });

    it("max 10 requests per reservation (429)", async () => {
      const f = createFixture();
      for (let i = 0; i < 10; i += 1) {
        const request = await f.openRequest();
        await f.service.cancelRequest(OWNER, request.id, NOW);
      }
      expect((await codeOf(f.openRequest())).status).toBe(429);
    });

    it("ownership: other traveler 403, unknown reservation 404", async () => {
      const f = createFixture();
      expect((await codeOf(f.service.createRequest(OTHER, 1, { type: "other" }, NOW))).status).toBe(403);
      expect((await codeOf(f.service.createRequest(OWNER, 999, { type: "other" }, NOW))).status).toBe(404);
      const request = await f.openRequest();
      expect((await codeOf(f.service.cancelRequest(OTHER, request.id, NOW))).status).toBe(403);
      expect((await codeOf(f.service.listForTraveler(OTHER, 1, NOW))).status).toBe(403);
    });

    it.each([
      ["cancelled", { status: "cancelled" }],
      ["pending payment", { status: "pending", payment_status: "pending" }],
      ["finalized", { status: "finalized" }],
      ["check-in today", { checkin: "2099-07-01", checkout: "2099-07-03" }],
    ] as const)("%s reservation → 409 not_eligible", async (_label, patch) => {
      const f = createFixture();
      Object.assign(f.stored(), patch);
      expect(await codeOf(f.openRequest())).toEqual({ status: 409, code: "not_eligible" });
    });

    it("cancel closes the request and rejects its live proposal; closed → 409", async () => {
      const f = createFixture();
      const { request, proposal } = await f.proposeDates(20_000);
      const cancelled = await f.service.cancelRequest(OWNER, request.id, NOW);
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.proposals[0]).toMatchObject({ id: proposal.id, status: "rejected" });
      expect(await codeOf(f.service.cancelRequest(OWNER, request.id, NOW))).toEqual({
        status: 409,
        code: "request_closed",
      });
    });

    it("traveler list shows can_request_change and proposals", async () => {
      const f = createFixture();
      const empty = await f.service.listForTraveler(OWNER, 1, NOW);
      expect(empty.can_request_change).toBe(true);
      expect(empty.change_types).toHaveLength(6);
      await f.proposeDates(20_000);
      const list = await f.service.listForTraveler(OWNER, 1, NOW);
      expect(list.can_request_change).toBe(false);
      expect(list.requests[0].status).toBe("proposal_sent");
      expect(list.requests[0].proposals[0]).toMatchObject({
        status: "pending_traveler",
        amount_delta_cents: 0,
        can_accept: true,
        requires_payment: false,
      });
      expect(list.requests[0].proposals[0].before.checkin).toBe(CHECKIN);
      expect(list.requests[0].proposals[0].after.checkin).toBe("2099-08-11");
    });
  });

  describe("V4P proposals (internal)", () => {
    it("prices with the quote engine, excludes the reservation itself and moves the request to proposal_sent", async () => {
      const f = createFixture();
      const { request, proposal } = await f.proposeDates(18_000);
      expect(request.status).toBe("proposal_sent");
      expect(proposal).toMatchObject({ amount_delta_cents: -2000, refund_cents: 2000 });
      expect(f.quote).toHaveBeenLastCalledWith(
        expect.objectContaining({ site_id: SITE, room_id: ROOM, checkin: "2099-08-11", checkout: "2099-08-13" }),
        expect.objectContaining({ skipHostPaymentCheck: true, excludeReservation: expect.objectContaining({ id: 1 }) as unknown }),
      );
      expect(f.audits("change_proposal.created")).toHaveLength(1);
    });

    it("an invalid quote is refused (422) and nothing is stored", async () => {
      const f = createFixture();
      const request = await f.openRequest();
      f.quote.mockResolvedValueOnce(quoteResult(20_000, { dogViolations: ["Perro demasiado grande"] }));
      expect(await codeOf(f.service.createProposal(request.id, { checkin: "2099-08-11", checkout: "2099-08-13" }, NOW))).toEqual({
        status: 422,
        code: "dogs_incompatible",
      });
      expect(f.store.rows(ReservationChangeProposalEntity)).toHaveLength(0);
    });

    it("a new proposal supersedes the live one; rejected request accepts no proposal", async () => {
      const f = createFixture();
      const { request } = await f.proposeDates(20_000);
      f.quote.mockResolvedValueOnce(quoteResult(19_000));
      const second = await f.service.createProposal(request.id, { checkin: "2099-08-11", checkout: "2099-08-13" }, NOW);
      expect(second.proposals.map(p => p.status)).toEqual(["pending_traveler", "expired"]);
      const rejected = await f.service.setRequestStatus(request.id, { status: "rejected", note: "No hay disponibilidad" }, NOW);
      expect(rejected).toMatchObject({ status: "rejected", response_note: "No hay disponibilidad" });
      expect(await codeOf(f.service.createProposal(request.id, {}, NOW))).toEqual({ status: 409, code: "request_closed" });
    });
  });

  describe("accept / reject proposal", () => {
    it("delta 0: applies the change, writes snapshot v2 linked to v1 and never touches v1", async () => {
      const f = createFixture();
      const { proposal } = await f.proposeDates(20_000);

      const result = await f.service.acceptProposal(OWNER, proposal.id, NOW);

      expect(result).toMatchObject({
        applied: true,
        snapshot_version: 2,
        previous_snapshot_version: 1,
        amount_delta_cents: 0,
        refund_cents: 0,
        refund_initiated: false,
      });
      expect(f.stored()).toMatchObject({
        checkin: "2099-08-11",
        checkout: "2099-08-13",
        snapshot_version: 2,
        total_cents: 20_000,
        status: "confirmed",
        payment_status: "paid",
      });
      const rows = f.snapshotRows().sort((a, b) => a.version - b.version);
      expect(rows).toHaveLength(2);
      expect(rows[0].payload).toEqual(f.v1);
      expect(rows[1]).toMatchObject({ version: 2, reason: "change_accepted" });
      expect(rows[1].payload).toMatchObject({
        previous_version: 1,
        stay: { checkin: "2099-08-11", checkout: "2099-08-13" },
        change: { kind: "change_proposal", offer_id: proposal.id },
      });
      // Saved-dog link kept (verified at checkout); deadline follows the new check-in.
      expect((rows[1].payload as { dogs: { saved_dog_id?: number }[] }).dogs[0].saved_dog_id).toBe(7);
      // Nights: 10 released, 11 kept, 12 blocked.
      expect(f.night(SITE, ROOM, "2099-08-10")).toBe(true);
      expect(f.night(SITE, ROOM, "2099-08-11")).toBe(false);
      expect(f.night(SITE, ROOM, "2099-08-12")).toBe(false);
      expect(f.store.rows(ReservationPriceLineEntity)).toHaveLength(0);
      expect(f.payout.refundInTransaction).not.toHaveBeenCalled();
      expect(f.audits("reservation.change_applied")).toHaveLength(1);
      expect(f.audits("change_proposal.accepted")).toHaveLength(1);
      expect(f.audits("snapshot.created")).toHaveLength(1);
      expect(f.store.rows(ReservationChangeRequestEntity)[0].status).toBe("accepted");
      expect(f.store.rows(ReservationChangeProposalEntity)[0]).toMatchObject({
        status: "accepted",
        resulting_snapshot_version: 2,
      });
    });

    it("delta < 0: refunds |delta| through refundInTransaction + adjustment line; total_cents stays the charged amount", async () => {
      const f = createFixture();
      const { proposal } = await f.proposeDates(15_000);

      const result = await f.service.acceptProposal(OWNER, proposal.id, NOW);

      expect(result).toMatchObject({ amount_delta_cents: -5000, refund_cents: 5000, refund_initiated: true });
      expect(f.payout.refundInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 1 }),
        5000,
        `change_accepted:change_proposal:${proposal.id}`,
        expect.objectContaining({ responsible: "traveler" }),
      );
      const [line] = f.store.rows(ReservationPriceLineEntity);
      expect(line).toMatchObject({ type: "adjustment", amount_cents: -5000 });
      expect(f.stored()).toMatchObject({ total_cents: 20_000, payment_status: "partially_refunded" });
    });

    it("delta > 0: 409 payment_required, nothing applied, proposal still pending", async () => {
      const f = createFixture();
      const { proposal } = await f.proposeDates(25_000);
      expect(proposal).toMatchObject({ requires_payment: true, can_accept: false });

      expect(await codeOf(f.service.acceptProposal(OWNER, proposal.id, NOW))).toEqual({
        status: 409,
        code: "payment_required",
      });
      expect(f.stored()).toMatchObject({ checkin: CHECKIN, snapshot_version: 1 });
      expect(f.snapshotRows()).toHaveLength(1);
      expect(f.store.rows(ReservationChangeProposalEntity)[0].status).toBe("pending_traveler");
    });

    it("expired proposal: 410 offer_expired, stored as expired, request back to in_review, reservation unchanged", async () => {
      const f = createFixture();
      const { proposal } = await f.proposeDates(20_000);
      const later = new Date(NOW.getTime() + 73 * 60 * 60 * 1000);

      expect(await codeOf(f.service.acceptProposal(OWNER, proposal.id, later))).toEqual({
        status: 410,
        code: "offer_expired",
      });
      expect(f.store.rows(ReservationChangeProposalEntity)[0]).toMatchObject({
        status: "expired",
        close_reason: "expired",
      });
      expect(f.store.rows(ReservationChangeRequestEntity)[0].status).toBe("in_review");
      expect(f.stored()).toMatchObject({ checkin: CHECKIN, snapshot_version: 1 });
      expect(await codeOf(f.service.acceptProposal(OWNER, proposal.id, NOW))).toEqual({
        status: 410,
        code: "offer_expired",
      });
    });

    it("nights lost at accept time: 409 unavailable, proposal invalidated, reservation + inventory untouched", async () => {
      const f = createFixture();
      const { proposal } = await f.proposeDates(20_000);
      // Someone else booked the 12th meanwhile.
      f.db.seedReservation(
        Object.assign(new ReservationEntity(), {
          id: 50,
          site_id: SITE,
          room_id: ROOM,
          user_id: 0,
          checkin: "2099-08-12",
          checkout: "2099-08-13",
          status: "confirmed",
          payment_status: "paid",
          refund_seq: 0,
          expiration_date: new Date("2099-06-01T00:00:00Z"),
        }),
      );
      f.setNight(SITE, ROOM, "2099-08-12", false);
      const nightsBefore = f.db.availability.map(row => ({ ...row }));

      expect(await codeOf(f.service.acceptProposal(OWNER, proposal.id, NOW))).toEqual({
        status: 409,
        code: "unavailable",
      });
      expect(f.stored()).toMatchObject({ checkin: CHECKIN, checkout: CHECKOUT, snapshot_version: 1 });
      expect(f.snapshotRows()).toHaveLength(1);
      expect(f.db.availability).toEqual(nightsBefore);
      expect(f.store.rows(ReservationChangeProposalEntity)[0]).toMatchObject({
        status: "expired",
        close_reason: "unavailable",
      });
      expect(f.audits("reservation.change_applied")).toHaveLength(0);
    });

    it("re-validation fails (capacity / dogs) → 409 with the stable code, reservation unchanged", async () => {
      const f = createFixture();
      const { proposal } = await f.proposeDates(20_000);
      f.quote.mockResolvedValueOnce(quoteResult(20_000, { dogViolations: ["PPP no admitido"] }));
      expect(await codeOf(f.service.acceptProposal(OWNER, proposal.id, NOW))).toEqual({
        status: 409,
        code: "dogs_incompatible",
      });
      expect(f.stored().snapshot_version).toBe(1);
    });

    it("outdated base snapshot → 409 offer_outdated", async () => {
      const f = createFixture();
      const { proposal } = await f.proposeDates(20_000);
      f.stored().snapshot_version = 5;
      expect(await codeOf(f.service.acceptProposal(OWNER, proposal.id, NOW))).toEqual({
        status: 409,
        code: "offer_outdated",
      });
    });

    it("other traveler → 403; unknown proposal → 404", async () => {
      const f = createFixture();
      const { proposal } = await f.proposeDates(20_000);
      expect((await codeOf(f.service.acceptProposal(OTHER, proposal.id, NOW))).status).toBe(403);
      expect((await codeOf(f.service.rejectProposal(OTHER, proposal.id, NOW))).status).toBe(403);
      expect((await codeOf(f.service.acceptProposal(OWNER, 999, NOW))).status).toBe(404);
    });

    it("«Mantener mi reserva actual»: proposal rejected, request closed, reservation unchanged", async () => {
      const f = createFixture();
      const { proposal } = await f.proposeDates(20_000);
      const rejected = await f.service.rejectProposal(OWNER, proposal.id, NOW);
      expect(rejected.status).toBe("rejected");
      expect(f.store.rows(ReservationChangeRequestEntity)[0].status).toBe("cancelled");
      expect(f.stored()).toMatchObject({ checkin: CHECKIN, snapshot_version: 1 });
      expect(await codeOf(f.service.acceptProposal(OWNER, proposal.id, NOW))).toEqual({
        status: 409,
        code: "offer_closed",
      });
    });
  });

  describe("alternatives (PDF §10)", () => {
    const ALT_SITE = 77;
    const ALT_ROOM = 9;

    const createAlternative = async (f: ReturnType<typeof createFixture>, totalCents = 20_000) => {
      f.db.seedNights(ALT_SITE, ALT_ROOM, NIGHTS, true);
      f.quote.mockResolvedValueOnce(quoteResult(totalCents));
      return f.alternatives.create(1, { site_id: ALT_SITE, room_id: ALT_ROOM, conditions: "Misma fecha" }, NOW);
    };

    it("V4P creates it (compatible with the declared dogs) with before/after", async () => {
      const f = createFixture();
      const alternative = await createAlternative(f);
      expect(alternative).toMatchObject({
        status: "pending_traveler",
        compatible_with_dogs: true,
        can_accept: true,
        amount_delta_cents: 0,
      });
      expect(alternative.before.site_name).toBe("Casa 42");
      expect(alternative.after).toMatchObject({ site_id: ALT_SITE, site_name: "Casa 77", room_name: "Cabaña" });
      // Dogs never overridden: the quote uses the snapshot dogs.
      expect(f.quote).toHaveBeenLastCalledWith(
        expect.objectContaining({ site_id: ALT_SITE, room_id: ALT_ROOM, dogs: [expect.objectContaining({ weight_kg: 12, is_ppp: false })] }),
        expect.anything(),
      );
    });

    it("incompatible with the dogs: creation 422", async () => {
      const f = createFixture();
      f.db.seedNights(ALT_SITE, ALT_ROOM, NIGHTS, true);
      f.quote.mockResolvedValueOnce(quoteResult(20_000, { dogViolations: ["Talla no admitida"] }));
      expect(await codeOf(f.alternatives.create(1, { site_id: ALT_SITE, room_id: ALT_ROOM }, NOW))).toEqual({
        status: 422,
        code: "dogs_incompatible",
      });
    });

    it("accept moves the stay to the other unit and writes snapshot alternative_accepted", async () => {
      const f = createFixture();
      const alternative = await createAlternative(f);

      const result = await f.alternatives.accept(OWNER, alternative.id, NOW);

      expect(result).toMatchObject({ applied: true, snapshot_version: 2 });
      expect(f.stored()).toMatchObject({ site_id: ALT_SITE, room_id: ALT_ROOM, snapshot_version: 2 });
      const v2 = f.snapshotRows().find(row => row.version === 2);
      expect(v2).toMatchObject({ reason: "alternative_accepted" });
      expect(f.snapshotRows().find(row => row.version === 1)?.payload).toEqual(f.v1);
      expect(f.night(SITE, ROOM, "2099-08-10")).toBe(true);
      expect(f.night(SITE, ROOM, "2099-08-11")).toBe(true);
      expect(f.night(ALT_SITE, ALT_ROOM, "2099-08-10")).toBe(false);
      expect(f.night(ALT_SITE, ALT_ROOM, "2099-08-11")).toBe(false);
      expect(f.audits("alternative.accepted")).toHaveLength(1);
    });

    it("an alternative not compatible with the dogs cannot be accepted (400)", async () => {
      const f = createFixture();
      const alternative = await createAlternative(f);
      f.store.rows(ReservationAlternativeEntity)[0].compatible_with_dogs = false;
      expect(await codeOf(f.alternatives.accept(OWNER, alternative.id, NOW))).toEqual({
        status: 400,
        code: "dogs_incompatible",
      });
      expect(f.stored()).toMatchObject({ site_id: SITE, snapshot_version: 1 });
    });

    it("dogs no longer compatible at accept time → 400 and the alternative expires", async () => {
      const f = createFixture();
      const alternative = await createAlternative(f);
      f.quote.mockResolvedValueOnce(quoteResult(20_000, { dogViolations: ["Talla no admitida"] }));
      expect(await codeOf(f.alternatives.accept(OWNER, alternative.id, NOW))).toEqual({
        status: 400,
        code: "dogs_incompatible",
      });
      expect(f.store.rows(ReservationAlternativeEntity)[0].status).toBe("expired");
      expect(f.stored().site_id).toBe(SITE);
    });

    it("delta > 0 → 409 payment_required", async () => {
      const f = createFixture();
      const alternative = await createAlternative(f, 30_000);
      expect(alternative.requires_payment).toBe(true);
      expect(await codeOf(f.alternatives.accept(OWNER, alternative.id, NOW))).toEqual({
        status: 409,
        code: "payment_required",
      });
    });

    it("«No aceptar» keeps the reservation; other traveler 403", async () => {
      const f = createFixture();
      const alternative = await createAlternative(f);
      expect((await codeOf(f.alternatives.reject(OTHER, alternative.id, NOW))).status).toBe(403);
      const rejected = await f.alternatives.reject(OWNER, alternative.id, NOW);
      expect(rejected.status).toBe("rejected");
      expect(f.stored()).toMatchObject({ site_id: SITE, snapshot_version: 1 });
      expect(await codeOf(f.alternatives.accept(OWNER, alternative.id, NOW))).toEqual({
        status: 409,
        code: "offer_closed",
      });
    });
  });
});
