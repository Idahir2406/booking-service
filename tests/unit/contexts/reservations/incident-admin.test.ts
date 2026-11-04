import { NotFoundException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { vi } from "vitest";

import { createEconomics } from "@/tests/utils/economics";
import { FakeEntityStore } from "@/tests/utils/fake-entity-store";

import { AuditLogEntity } from "@/src/contexts/payments/entities/audit-log.entity";
import { ReservationSnapshotEntity } from "@/src/contexts/payments/entities/reservation-snapshot.entity";
import { ListIncidentsQueryDto } from "@/src/contexts/reservations/dto/incident-admin.dto";
import { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";
import { ReservationDisputeEntity } from "@/src/contexts/reservations/entities/reservation-dispute.entity";
import { ReservationEventEntity } from "@/src/contexts/reservations/entities/reservation-event.entity";
import { ReservationIncidentEntity } from "@/src/contexts/reservations/entities/reservation-incident.entity";
import { ReservationIncidentAttachmentEntity } from "@/src/contexts/reservations/entities/reservation-incident-attachment.entity";
import { ReservationIncidentMessageEntity } from "@/src/contexts/reservations/entities/reservation-incident-message.entity";
import { ReservationEventService } from "@/src/contexts/reservations/services/reservation-event.service";
import { ReservationIncidentService } from "@/src/contexts/reservations/services/reservation-incident.service";
import { ReservationIncidentAdminService } from "@/src/contexts/reservations/services/reservation-incident-admin.service";
import {
  adminActorAuditId,
  allowedNextStatuses,
  buildIncidentListQuery,
  incidentAgeHours,
  type IncidentListFilters,
  InvalidAdminActorError,
  parseAdminActorHeaders,
} from "@/src/contexts/reservations/utils/incident-admin.util";

const OWNER = 10;
const NOW = new Date("2099-08-12T10:00:00.000Z");
const DESCRIPTION = "El alojamiento no tenía la zona para perros prometida";
const KEY = `${"a".repeat(32)}.pdf`;

const baseFilters = (
  overrides: Partial<IncidentListFilters> = {},
): IncidentListFilters => ({ limit: 25, offset: 0, ...overrides });

const parse = (plain: object) =>
  plainToInstance(ListIncidentsQueryDto, plain, {
    enableImplicitConversion: true,
  });

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
  const { economics } = createEconomics(store);
  const events = new ReservationEventService(
    store.repository(ReservationEventEntity) as never,
  );
  const incidentService = new ReservationIncidentService(
    reservationRepository as never,
    store.repository(ReservationIncidentEntity) as never,
    store.repository(ReservationIncidentAttachmentEntity) as never,
    store.repository(ReservationIncidentMessageEntity) as never,
    economics,
    events,
    { sendIncidentAdminEmail: vi.fn(() => Promise.resolve()) } as never,
    { getSiteById: vi.fn().mockResolvedValue({ id: 42 }) } as never,
    { notifyMessage: vi.fn(() => Promise.resolve()) } as never,
  );
  const mysql = {
    query: vi.fn(),
    queryOne: vi.fn((sql: string) =>
      Promise.resolve(
        sql.includes("user_profiles")
          ? { name: "Ana Viajera", email: "ana@example.com" }
          : { name: "Casa Rural Can Gos" },
      ),
    ),
  };
  const admin = new ReservationIncidentAdminService(
    store.repository(ReservationIncidentEntity) as never,
    store.repository(ReservationIncidentMessageEntity) as never,
    store.repository(ReservationIncidentAttachmentEntity) as never,
    store.repository(ReservationEntity) as never,
    store.repository(ReservationDisputeEntity) as never,
    store.repository(ReservationEventEntity) as never,
    store.repository(ReservationSnapshotEntity) as never,
    economics,
    mysql as never,
  );
  const addReservation = async (overrides: Partial<ReservationEntity> = {}) =>
    (await store.repository(ReservationEntity).save({
      site_id: 42,
      room_id: 3,
      user_id: OWNER,
      checkin: "2099-08-10",
      checkout: "2099-08-14",
      guests: 2,
      pets: 1,
      status: "confirmed",
      payment_status: "paid",
      payout_status: "held",
      total_cents: 32_450,
      currency: "eur",
      refund_seq: 0,
      ...overrides,
    })) as unknown as ReservationEntity;
  const audits = (action: string) =>
    store.rows(AuditLogEntity).filter(row => row.action === action);
  const eventsOf = (type: string) =>
    store.rows(ReservationEventEntity).filter(row => row.event_type === type);
  return {
    store,
    incidentService,
    admin,
    mysql,
    addReservation,
    audits,
    eventsOf,
  };
};

describe("Backoffice fase 1 — incidents admin", () => {
  describe("actor headers", () => {
    it("no headers → null (legacy anonymous v4p)", () => {
      expect(parseAdminActorHeaders({})).toBeNull();
    });

    it("valid id + name are trimmed and parsed", () => {
      expect(
        parseAdminActorHeaders({
          "x-actor-id": " 7 ",
          "x-actor-name": "  adminv4patas ",
        }),
      ).toEqual({ id: 7, name: "adminv4patas" });
    });

    it("name only (admino users have no numeric id) is accepted", () => {
      expect(parseAdminActorHeaders({ "x-actor-name": "nitus" })).toEqual({
        id: null,
        name: "nitus",
      });
    });

    it.each([
      [{ "x-actor-id": "0" }],
      [{ "x-actor-id": "-3" }],
      [{ "x-actor-id": "abc" }],
      [{ "x-actor-id": "99999999999" }],
      [{ "x-actor-name": "" }],
      [{ "x-actor-name": "x".repeat(101) }],
      [{ "x-actor-name": "evil\nname" }],
    ])("rejects invalid headers %j", headers => {
      expect(() => parseAdminActorHeaders(headers)).toThrow(
        InvalidAdminActorError,
      );
    });

    it("audit id: numeric id, else admino:{name} (≤ 64 chars)", () => {
      expect(adminActorAuditId(null)).toBeNull();
      expect(adminActorAuditId({ id: 5, name: "x" })).toBe("5");
      expect(adminActorAuditId({ id: null, name: "nitus" })).toBe(
        "admino:nitus",
      );
      expect(
        adminActorAuditId({ id: null, name: "y".repeat(100) })?.length,
      ).toBe(64);
    });
  });

  describe("allowed transitions (state machine)", () => {
    it.each([
      ["received", ["in_review", "needs_info", "resolved"]],
      ["in_review", ["needs_info", "resolved"]],
      ["needs_info", ["in_review", "resolved"]],
      ["resolved", []],
    ] as const)("%s → %j", (from, expected) => {
      expect(allowedNextStatuses(from)).toEqual(expected);
    });
  });

  describe("list query builder", () => {
    it("no filters → no WHERE, pagination params last", () => {
      const built = buildIncidentListQuery(baseFilters(), "v4p_j");
      expect(built.countSql).not.toContain("WHERE");
      expect(built.listSql).toContain("`v4p_jsites1`");
      expect(built.listSql).toContain("`v4p_juser_profiles`");
      expect(built.listParams).toEqual([25, 0]);
      expect(built.countParams).toEqual([]);
    });

    it("status open + type + blocks_payout + dates", () => {
      const built = buildIncidentListQuery(
        baseFilters({
          status: "open",
          type: "during_stay",
          blocks_payout: false,
          from: "2099-08-01",
          to: "2099-08-31",
          limit: 10,
          offset: 20,
        }),
        "v4p_j",
      );
      expect(built.listSql).toContain("i.status IN (?)");
      expect(built.listParams).toEqual([
        ["received", "in_review", "needs_info"],
        "during_stay",
        0,
        "2099-08-01 00:00:00",
        "2099-09-01 00:00:00",
        10,
        20,
      ]);
      // counters ignore the status filter but keep the others
      expect(built.statusCountSql).not.toContain("i.status IN");
      expect(built.statusCountParams).toEqual([
        "during_stay",
        0,
        "2099-08-01 00:00:00",
        "2099-09-01 00:00:00",
      ]);
    });

    it.each(["#RES-123", "RES-123", "res123", "123"])(
      "q %s searches by reservation (or incident) id",
      q => {
        const built = buildIncidentListQuery(baseFilters({ q }), "v4p_j");
        expect(built.countSql).toContain("(i.reservation_id = ? OR i.id = ?)");
        expect(built.countParams).toEqual([123, 123]);
      },
    );

    it("q with @ searches profile and guest email (LIKE escaped)", () => {
      const built = buildIncidentListQuery(
        baseFilters({ q: "a_b%@x.com" }),
        "v4p_j",
      );
      expect(built.countSql).toContain("p.email LIKE ?");
      expect(built.countParams).toEqual([
        String.raw`%a\_b\%@x.com%`,
        String.raw`%a\_b\%@x.com%`,
      ]);
    });

    it("never interpolates filter values into SQL", () => {
      const evil = "x' OR 1=1 --";
      const built = buildIncidentListQuery(baseFilters({ q: evil }), "v4p_j");
      expect(built.listSql).not.toContain(evil);
    });
  });

  describe("ListIncidentsQueryDto (implicit conversion like main.ts)", () => {
    it("empty form values are ignored; booleans parsed from raw strings", async () => {
      const dto = parse({
        status: "",
        type: "",
        blocks_payout: "false",
        limit: "",
        offset: "",
        from: "",
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
      expect(dto.blocks_payout).toBe(false);
      expect(dto.status).toBeUndefined();
      expect(dto.limit).toBeUndefined();
      expect(parse({ blocks_payout: "1" }).blocks_payout).toBe(true);
    });

    it.each([
      { status: "closed" },
      { type: "nope" },
      { limit: "500" },
      { offset: "-1" },
      { from: "2099-13-01" },
      { q: "x".repeat(101) },
      { blocks_payout: "maybe" },
    ])("rejects %j", async plain => {
      const errors = await validate(parse(plain));
      expect(errors.length).toBeGreaterThan(0);
    });

    it("accepts status=open", async () => {
      expect(await validate(parse({ status: "open" }))).toHaveLength(0);
    });
  });

  describe("age", () => {
    it("open: hours until now; resolved: until resolved_at", () => {
      expect(
        incidentAgeHours("2099-08-11T09:30:00.000Z", null, "received", NOW),
      ).toBe(24);
      expect(
        incidentAgeHours(
          "2099-08-01T00:00:00.000Z",
          "2099-08-01T05:00:00.000Z",
          "resolved",
          NOW,
        ),
      ).toBe(5);
    });
  });

  describe("service", () => {
    it("list maps rows: #RES ref, traveler fallback, counts, age, last activity", async () => {
      const f = createFixture();
      f.mysql.query
        .mockResolvedValueOnce([
          {
            id: 5,
            reservation_id: "77",
            type: "during_stay",
            status: "received",
            blocks_payout: 1,
            dispute_id: 3,
            created_at: new Date("2099-08-09T10:00:00.000Z"),
            updated_at: new Date("2099-08-09T10:00:00.000Z"),
            resolved_at: null,
            reservation_status: "confirmed",
            payment_status: "paid",
            payout_status: "blocked",
            checkin: "2099-08-10",
            checkout: new Date("2099-08-14T00:00:00.000Z"),
            site_name: "Can Gos",
            profile_name: "",
            profile_email: null,
            guest_name: "Ana",
            guest_email: "ana@example.com",
            message_count: "2",
            attachment_count: 1,
            last_message_at: new Date("2099-08-11T08:00:00.000Z"),
            last_attachment_at: null,
          },
        ])
        .mockResolvedValueOnce([{ total: "41" }])
        .mockResolvedValueOnce([
          { status: "received", total: 3 },
          { status: "resolved", total: "38" },
        ]);

      const result = await f.admin.list({ status: "open", limit: 10 }, NOW);

      expect(result).toMatchObject({
        total: 41,
        limit: 10,
        offset: 0,
        status_counts: {
          received: 3,
          in_review: 0,
          needs_info: 0,
          resolved: 38,
        },
      });
      expect(result.items[0]).toEqual({
        id: 5,
        reservation_id: 77,
        reservation_ref: "#RES-77",
        type: "during_stay",
        status: "received",
        created_at: "2099-08-09T10:00:00.000Z",
        updated_at: "2099-08-09T10:00:00.000Z",
        age_hours: 72,
        blocks_payout: true,
        dispute_id: 3,
        reservation_status: "confirmed",
        payment_status: "paid",
        payout_status: "blocked",
        checkin: "2099-08-10",
        checkout: "2099-08-14",
        site_name: "Can Gos",
        traveler_name: "Ana",
        traveler_email: "ana@example.com",
        message_count: 2,
        attachment_count: 1,
        last_activity_at: "2099-08-11T08:00:00.000Z",
      });
      const [listSql, listParams] = f.mysql.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(listSql).toContain("LIMIT ? OFFSET ?");
      expect(listParams.slice(-2)).toEqual([10, 0]);
    });

    it("detail: shape, allowed transitions, release_hold applicable, never storage paths", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      const incident = await f.incidentService.createForTraveler(
        OWNER,
        reservation.id,
        { type: "during_stay", description: DESCRIPTION },
        NOW,
      );
      await f.incidentService.addAttachment(OWNER, incident.id, {
        storage_key: KEY,
        original_name: "foto.pdf",
        mime: "application/pdf",
        size_bytes: 1000,
      });

      const detail = await f.admin.getDetail(incident.id, NOW);

      expect(detail).toMatchObject({
        id: incident.id,
        reservation_ref: `#RES-${reservation.id}`,
        status: "received",
        blocks_payout: true,
        traveler: {
          user_id: OWNER,
          name: "Ana Viajera",
          email: "ana@example.com",
        },
        reservation: {
          id: reservation.id,
          payout_status: "blocked",
          site_name: "Casa Rural Can Gos",
          guests: 2,
          pets: 1,
          total_cents: 32_450,
        },
        dispute: { status: "open", source: "guest_report" },
        allowed_next_statuses: ["in_review", "needs_info", "resolved"],
        release_hold: {
          applicable: true,
          reason: null,
          other_open_disputes: 0,
          currency: "eur",
        },
        can_message: true,
      });
      expect(detail.release_hold.host_amount_cents).toBeGreaterThan(0);
      expect(detail.attachments).toEqual([
        expect.objectContaining({
          original_name: "foto.pdf",
          mime: "application/pdf",
          size_bytes: 1000,
        }),
      ]);
      const json = JSON.stringify(detail);
      expect(json).not.toContain(KEY);
      expect(json).not.toContain("storage_key");
      expect(detail.history.map(entry => entry.event_type)).toContain(
        "incident_opened",
      );
    });

    it("detail: release_hold not applicable when the incident does not block", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      const incident = await f.incidentService.createForTraveler(
        OWNER,
        reservation.id,
        { type: "other", description: DESCRIPTION },
        NOW,
      );
      const detail = await f.admin.getDetail(incident.id, NOW);
      expect(detail.release_hold).toMatchObject({
        applicable: false,
        reason: "incident_not_blocking",
      });
    });

    it("detail: resolved → no transitions, no messages; unknown → 404", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      const incident = await f.incidentService.createForTraveler(
        OWNER,
        reservation.id,
        { type: "other", description: DESCRIPTION },
        NOW,
      );
      await f.incidentService.updateStatus(incident.id, { status: "resolved" });
      const detail = await f.admin.getDetail(incident.id, NOW);
      expect(detail.allowed_next_statuses).toEqual([]);
      expect(detail.can_message).toBe(false);
      await expect(f.admin.getDetail(9999, NOW)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("attachment file: only when it belongs to the incident", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      const first = await f.incidentService.createForTraveler(
        OWNER,
        reservation.id,
        { type: "other", description: DESCRIPTION },
        NOW,
      );
      const second = await f.incidentService.createForTraveler(
        OWNER,
        reservation.id,
        { type: "dog_issue", description: DESCRIPTION },
        NOW,
      );
      const attachment = await f.incidentService.addAttachment(
        OWNER,
        first.id,
        {
          storage_key: KEY,
          original_name: "foto.pdf",
          mime: "application/pdf",
          size_bytes: 1000,
        },
      );

      await expect(
        f.admin.getAttachmentFile(first.id, attachment.id),
      ).resolves.toEqual({
        id: attachment.id,
        incident_id: first.id,
        storage_key: KEY,
        original_name: "foto.pdf",
        mime: "application/pdf",
        size_bytes: 1000,
      });
      await expect(
        f.admin.getAttachmentFile(second.id, attachment.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("actor recorded on status (event + payout audit + note message) and on messages", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      const incident = await f.incidentService.createForTraveler(
        OWNER,
        reservation.id,
        { type: "during_stay", description: DESCRIPTION },
        NOW,
      );
      const actor = { id: null, name: "adminv4patas" };

      await f.incidentService.updateStatus(
        incident.id,
        { status: "needs_info", note: "Envíanos una foto" },
        NOW,
        actor,
      );
      await f.incidentService.addAdminMessage(
        incident.id,
        { body: "Seguimos revisando" },
        { id: 7, name: "nitus" },
      );
      await f.incidentService.updateStatus(
        incident.id,
        { status: "resolved", release_hold: true },
        NOW,
        actor,
      );

      const statusEvents = f.eventsOf("incident_status_changed");
      expect(statusEvents[0].payload).toMatchObject({
        to: "needs_info",
        actor: { id: null, name: "adminv4patas" },
      });
      expect(typeof statusEvents[0].payload?.message_id).toBe("number");
      expect(f.eventsOf("incident_message_admin")[0].payload).toMatchObject({
        actor: { id: 7, name: "nitus" },
      });

      const unblocked = f
        .audits("payout.status_changed")
        .find(row => row.after?.payout_status === "held");
      expect(unblocked).toMatchObject({
        actor_type: "admin",
        actor_id: "admino:adminv4patas",
        metadata: expect.objectContaining({ actor_name: "adminv4patas" }),
      });

      const detail = await f.admin.getDetail(incident.id, NOW);
      expect(detail.messages.map(row => row.actor)).toEqual([
        { id: null, name: "adminv4patas" },
        { id: 7, name: "nitus" },
      ]);
      expect(
        detail.history
          .filter(entry => entry.event_type === "incident_status_changed")
          .map(entry => entry.actor?.name),
      ).toEqual(["adminv4patas", "adminv4patas"]);
    });

    it("no actor → legacy behaviour (anonymous admin, no actor in payload)", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      const incident = await f.incidentService.createForTraveler(
        OWNER,
        reservation.id,
        { type: "during_stay", description: DESCRIPTION },
        NOW,
      );
      await f.incidentService.updateStatus(incident.id, {
        status: "resolved",
        release_hold: true,
      });
      const [event] = f.eventsOf("incident_status_changed");
      expect(event.payload).not.toHaveProperty("actor");
      const unblocked = f
        .audits("payout.status_changed")
        .find(row => row.after?.payout_status === "held");
      expect(unblocked).toMatchObject({ actor_type: "admin", actor_id: null });
    });
  });
});
