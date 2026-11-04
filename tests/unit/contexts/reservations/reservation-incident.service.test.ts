import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { vi } from "vitest";

import { createEconomics } from "@/tests/utils/economics";
import { FakeEntityStore } from "@/tests/utils/fake-entity-store";

import { AuditLogEntity } from "@/src/contexts/payments/entities/audit-log.entity";
import {
  AddIncidentAttachmentDto,
  CreateIncidentDto,
} from "@/src/contexts/reservations/dto/reservation-incident.dto";
import { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";
import { ReservationDisputeEntity } from "@/src/contexts/reservations/entities/reservation-dispute.entity";
import { ReservationEventEntity } from "@/src/contexts/reservations/entities/reservation-event.entity";
import { ReservationIncidentEntity } from "@/src/contexts/reservations/entities/reservation-incident.entity";
import { ReservationIncidentAttachmentEntity } from "@/src/contexts/reservations/entities/reservation-incident-attachment.entity";
import { ReservationIncidentMessageEntity } from "@/src/contexts/reservations/entities/reservation-incident-message.entity";
import { ReservationEventService } from "@/src/contexts/reservations/services/reservation-event.service";
import { ReservationIncidentService } from "@/src/contexts/reservations/services/reservation-incident.service";
import {
  INCIDENT_LIMITS,
  type IncidentType,
  PAYOUT_BLOCKING_INCIDENT_TYPES,
} from "@/src/contexts/reservations/utils/reservation-incident.util";

const OWNER = 10;
const OTHER = 99;
const NOW = new Date("2099-08-12T10:00:00.000Z");
const DESCRIPTION = "El alojamiento no tenía la zona para perros prometida";

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
  const emails = { sendIncidentAdminEmail: vi.fn(() => Promise.resolve()) };
  const reservationService = {
    getSiteById: vi.fn().mockResolvedValue({ id: 42 }),
  };
  const notifications = {
    notifyMessage: vi.fn<[unknown], Promise<void>>(() => Promise.resolve()),
  };
  const service = new ReservationIncidentService(
    reservationRepository as never,
    store.repository(ReservationIncidentEntity) as never,
    store.repository(ReservationIncidentAttachmentEntity) as never,
    store.repository(ReservationIncidentMessageEntity) as never,
    economics,
    events,
    emails as never,
    reservationService as never,
    notifications as never,
  );

  const addReservation = async (overrides: Partial<ReservationEntity> = {}) =>
    (await store.repository(ReservationEntity).save({
      site_id: 42,
      room_id: 3,
      user_id: OWNER,
      checkin: "2099-08-10",
      checkout: "2099-08-14",
      status: "confirmed",
      payment_status: "paid",
      payout_status: "held",
      total_cents: 32_450,
      refund_seq: 0,
      ...overrides,
    })) as unknown as ReservationEntity;

  const create = (
    reservationId: number,
    type: IncidentType,
    userId = OWNER,
    now = NOW,
  ) =>
    service.createForTraveler(
      userId,
      reservationId,
      { type, description: DESCRIPTION },
      now,
    );

  const stored = (id: number) =>
    store.rows(ReservationEntity).find(row => row.id === id);
  const audits = (action: string) =>
    store.rows(AuditLogEntity).filter(row => row.action === action);
  const eventTypes = () =>
    store.rows(ReservationEventEntity).map(row => row.event_type);

  return {
    store,
    service,
    emails,
    notifications,
    addReservation,
    create,
    stored,
    audits,
    eventTypes,
  };
};

const attachment = (key: string): AddIncidentAttachmentDto => ({
  storage_key: key,
  original_name: "certificado.pdf",
  mime: "application/pdf",
  size_bytes: 120_000,
});

const errorsOf = async <T extends object>(cls: new () => T, plain: object) =>
  validate(plainToInstance(cls, plain));

const hexKey = (n: number, ext = "pdf") =>
  `${n.toString(16).padStart(32, "0")}.${ext}`;

const lastNotification = (f: ReturnType<typeof createFixture>) =>
  f.notifications.notifyMessage.mock.calls.at(-1)?.[0] as
    | Record<string, unknown>
    | undefined;

describe("ReservationIncidentService (F-PV7a)", () => {
  describe("payout block (D7)", () => {
    it("during_stay with payout held → blocked via transitionPayout + linked open dispute + audit", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();

      const incident = await f.create(reservation.id, "during_stay");

      expect(incident).toMatchObject({
        type: "during_stay",
        status: "received",
        blocks_payout: true,
      });
      expect(f.stored(reservation.id)?.payout_status).toBe("blocked");

      const [dispute] = f.store.rows(ReservationDisputeEntity);
      expect(dispute).toMatchObject({
        reservation_id: reservation.id,
        source: "guest_report",
        status: "open",
      });
      const row = f.store.rows(ReservationIncidentEntity)[0];
      expect(row.dispute_id).toBe(dispute.id);

      const changed = f.audits("payout.status_changed");
      expect(changed).toHaveLength(1);
      expect(changed[0]).toMatchObject({
        before: { payout_status: "held" },
        after: { payout_status: "blocked" },
      });
      expect(f.eventTypes()).toContain("incident_opened");
      expect(f.emails.sendIncidentAdminEmail).toHaveBeenCalledWith(
        expect.objectContaining({ id: reservation.id }),
        { id: 42 },
        "during_stay",
        DESCRIPTION,
        true,
      );
    });

    it.each([...PAYOUT_BLOCKING_INCIDENT_TYPES])(
      "%s blocks the payout",
      async type => {
        const f = createFixture();
        const reservation = await f.addReservation();
        await f.create(reservation.id, type);
        expect(f.stored(reservation.id)?.payout_status).toBe("blocked");
      },
    );

    it.each(["before_arrival", "refund_issue", "other"] as const)(
      "%s never touches the payout nor opens a dispute",
      async type => {
        const f = createFixture();
        const reservation = await f.addReservation();
        const incident = await f.create(reservation.id, type);
        expect(incident.blocks_payout).toBe(false);
        expect(f.stored(reservation.id)?.payout_status).toBe("held");
        expect(f.store.rows(ReservationDisputeEntity)).toHaveLength(0);
        expect(f.audits("payout.status_changed")).toHaveLength(0);
      },
    );

    it("released payout stays released and the rejection is audited", async () => {
      const f = createFixture();
      const reservation = await f.addReservation({
        status: "finalized",
        payout_status: "released",
      });

      const incident = await f.create(reservation.id, "dog_issue");

      expect(f.stored(reservation.id)?.payout_status).toBe("released");
      expect(incident.blocks_payout).toBe(false);
      expect(f.audits("payout.transition_rejected")).toHaveLength(1);
      expect(f.audits("payout.status_changed")).toHaveLength(0);
      // The complaint is still recorded as an open dispute (A21 debt, F4).
      expect(f.store.rows(ReservationDisputeEntity)).toHaveLength(1);
    });

    it("is idempotent: same open type → 409 without a second block/dispute; another D7 type is a NOOP block", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      await f.create(reservation.id, "during_stay");

      await expect(
        f.create(reservation.id, "during_stay"),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(f.store.rows(ReservationDisputeEntity)).toHaveLength(1);

      const second = await f.create(reservation.id, "charge_issue");
      expect(second.blocks_payout).toBe(true);
      expect(f.stored(reservation.id)?.payout_status).toBe("blocked");
      // Only the first call changed the state (blocked -> blocked = NOOP).
      expect(f.audits("payout.status_changed")).toHaveLength(1);
      expect(f.store.rows(ReservationDisputeEntity)).toHaveLength(2);
    });
  });

  describe("eligibility and ownership", () => {
    it("another traveler's reservation → 403; missing reservation → 404; user 0 → 400", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      await expect(
        f.create(reservation.id, "other", OTHER),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(f.create(9999, "other")).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(f.create(reservation.id, "other", 0)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        f.service.listForTraveler(OTHER, reservation.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.stored(reservation.id)?.payout_status).toBe("held");
    });

    it("cancelled reservation: only refund_issue (no payout change); unpaid pending: nothing", async () => {
      const f = createFixture();
      const cancelled = await f.addReservation({
        status: "cancelled",
        payment_status: "refunded",
      });
      await expect(
        f.create(cancelled.id, "during_stay"),
      ).rejects.toBeInstanceOf(BadRequestException);
      const refundIssue = await f.create(cancelled.id, "refund_issue");
      expect(refundIssue.blocks_payout).toBe(false);

      const pending = await f.addReservation({
        status: "pending",
        payment_status: "pending",
        payout_status: undefined,
      });
      await expect(f.create(pending.id, "other")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("rejects reports more than 30 days after checkout", async () => {
      const f = createFixture();
      const reservation = await f.addReservation({
        status: "finalized",
        checkin: "2099-06-01",
        checkout: "2099-06-05",
      });
      await expect(
        f.create(
          reservation.id,
          "other",
          OWNER,
          new Date("2099-07-06T00:00:00Z"),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rate limit: at most 10 incidents per reservation → 429", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      for (
        let i = 0;
        i < INCIDENT_LIMITS.MAX_INCIDENTS_PER_RESERVATION;
        i += 1
      ) {
        await f.store.repository(ReservationIncidentEntity).save({
          reservation_id: reservation.id,
          user_id: OWNER,
          type: "other",
          status: "resolved",
          description: DESCRIPTION,
          dispute_id: null,
          blocks_payout: false,
        });
      }
      const error = await f
        .create(reservation.id, "before_arrival")
        .catch((error_: unknown) => error_);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    });

    it("messages/attachments/downloads on another traveler's incident → 403; missing → 404", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      const incident = await f.create(reservation.id, "other");
      const att = await f.service.addAttachment(
        OWNER,
        incident.id,
        attachment(hexKey(1)),
      );

      await expect(
        f.service.addTravelerMessage(OTHER, incident.id, { body: "hola" }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        f.service.addAttachment(OTHER, incident.id, attachment(hexKey(2))),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        f.service.getAttachmentFile(OTHER, incident.id, att.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        f.service.getAttachmentFile(OWNER, 9999, att.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        f.service.getAttachmentFile(OWNER, incident.id, 9999),
      ).rejects.toBeInstanceOf(NotFoundException);

      const file = await f.service.getAttachmentFile(
        OWNER,
        incident.id,
        att.id,
      );
      expect(file.storage_key).toBe(hexKey(1));
    });
  });

  describe("attachments and messages", () => {
    it("accepts at most 5 attachments; the same key twice is idempotent", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      const incident = await f.create(reservation.id, "other");
      for (let i = 1; i <= INCIDENT_LIMITS.MAX_ATTACHMENTS; i += 1) {
        await f.service.addAttachment(
          OWNER,
          incident.id,
          attachment(hexKey(i)),
        );
      }
      const again = await f.service.addAttachment(
        OWNER,
        incident.id,
        attachment(hexKey(1)),
      );
      expect(f.store.rows(ReservationIncidentAttachmentEntity)).toHaveLength(5);
      expect(again.original_name).toBe("certificado.pdf");

      await expect(
        f.service.addAttachment(OWNER, incident.id, attachment(hexKey(6))),
      ).rejects.toBeInstanceOf(ConflictException);
      const listedPage = await f.service.listForTraveler(OWNER, reservation.id);
      const [listed] = listedPage.items;
      expect(listed.can_attach).toBe(false);
      expect(listed.attachments[0]).not.toHaveProperty("storage_key");
    });

    it("traveler answer on needs_info moves it to in_review", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      const incident = await f.create(reservation.id, "before_arrival");
      await f.service.updateStatus(incident.id, {
        status: "needs_info",
        note: "Envíanos una foto de la entrada",
      });

      const answered = await f.service.addTravelerMessage(OWNER, incident.id, {
        body: "Adjunto la foto",
      });

      expect(answered.status).toBe("in_review");
      expect(answered.messages.map(m => m.author_type)).toEqual([
        "admin",
        "traveler",
      ]);
    });

    it("resolved incidents accept no more messages or attachments (409)", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      const incident = await f.create(reservation.id, "other");
      await f.service.updateStatus(incident.id, { status: "resolved" });
      await expect(
        f.service.addTravelerMessage(OWNER, incident.id, { body: "hola" }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        f.service.addAttachment(OWNER, incident.id, attachment(hexKey(1))),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("V4P status changes and unblock", () => {
    it("invalid transition (resolved → in_review) → 409; release_hold without resolved → 400", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      const incident = await f.create(reservation.id, "other");
      await expect(
        f.service.updateStatus(incident.id, {
          status: "in_review",
          release_hold: true,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await f.service.updateStatus(incident.id, { status: "resolved" });
      await expect(
        f.service.updateStatus(incident.id, { status: "in_review" }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        f.service.updateStatus(9999, { status: "resolved" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("resolved without release_hold keeps the payout blocked", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      const incident = await f.create(reservation.id, "during_stay");
      const result = await f.service.updateStatus(incident.id, {
        status: "resolved",
        note: "Hemos hablado con el alojamiento",
      });
      expect(result.payout_hold).toBe("not_requested");
      expect(result.incident.resolution_note).toBe(
        "Hemos hablado con el alojamiento",
      );
      expect(f.stored(reservation.id)?.payout_status).toBe("blocked");
      expect(f.store.rows(ReservationDisputeEntity)[0].status).toBe("open");
    });

    it("release_hold closes the dispute and moves blocked → held only when nothing else holds it (idempotent)", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      const first = await f.create(reservation.id, "during_stay");
      const second = await f.create(reservation.id, "dog_issue");

      const partial = await f.service.updateStatus(first.id, {
        status: "resolved",
        release_hold: true,
      });
      expect(partial.payout_hold).toBe("still_blocked");
      expect(f.stored(reservation.id)?.payout_status).toBe("blocked");

      // Resolved earlier without release, released later (same status = idempotent).
      await f.service.updateStatus(second.id, { status: "resolved" });
      const done = await f.service.updateStatus(second.id, {
        status: "resolved",
        release_hold: true,
      });
      expect(done.payout_hold).toBe("unblocked");
      expect(done.payout_status).toBe("held");
      expect(f.stored(reservation.id)?.payout_status).toBe("held");
      expect(
        f.store.rows(ReservationDisputeEntity).map(row => row.status),
      ).toEqual(["resolved_release", "resolved_release"]);

      const replay = await f.service.updateStatus(second.id, {
        status: "resolved",
        release_hold: true,
      });
      expect(replay.payout_hold).toBe("not_blocked");
      expect(f.stored(reservation.id)?.payout_status).toBe("held");
    });

    it("needs_info note becomes a V4P message visible to the traveler", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      const incident = await f.create(reservation.id, "other");
      const result = await f.service.updateStatus(incident.id, {
        status: "needs_info",
        note: "¿Puedes enviarnos el ticket?",
      });
      expect(result.incident.status).toBe("needs_info");
      expect(result.incident.can_reply).toBe(true);
      expect(result.incident.messages).toEqual([
        expect.objectContaining({
          author_type: "admin",
          body: "¿Puedes enviarnos el ticket?",
        }),
      ]);
    });
  });

  describe("chat + emails on every message (2026-10-25)", () => {
    it("creation sends the traveler copy only (the admin keeps incident_opened_admin)", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      await f.create(reservation.id, "other");
      expect(f.emails.sendIncidentAdminEmail).toHaveBeenCalledTimes(1);
      expect(lastNotification(f)).toMatchObject({
        author: "traveler",
        body: DESCRIPTION,
        event: "opened",
        recipients: ["incident_message_traveler"],
      });
    });

    it.each([
      ["received", "received"],
      ["in_review", "in_review"],
      ["needs_info", "in_review"],
    ] as const)(
      "traveler can write in %s (status after: %s) and both emails are requested",
      async (status, expected) => {
        const f = createFixture();
        const reservation = await f.addReservation();
        const incident = await f.create(reservation.id, "before_arrival");
        if (status !== "received") {
          await f.service.updateStatus(incident.id, { status });
        }
        f.notifications.notifyMessage.mockClear();

        const result = await f.service.addTravelerMessage(OWNER, incident.id, {
          body: "Os escribo de nuevo",
        });

        expect(result.status).toBe(expected);
        expect(result.can_reply).toBe(true);
        expect(result.messages.at(-1)).toMatchObject({
          author_type: "traveler",
          body: "Os escribo de nuevo",
        });
        expect(f.notifications.notifyMessage).toHaveBeenCalledTimes(1);
        const call = lastNotification(f);
        expect(call).toMatchObject({
          author: "traveler",
          body: "Os escribo de nuevo",
          event: "message",
        });
        expect(call).not.toHaveProperty("recipients");
        expect((call?.incident as { status: string }).status).toBe(expected);
      },
    );

    it("resolved: 409 with code incident_closed, no message, no email", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      const incident = await f.create(reservation.id, "other");
      await f.service.updateStatus(incident.id, { status: "resolved" });
      f.notifications.notifyMessage.mockClear();

      const error = await f.service
        .addTravelerMessage(OWNER, incident.id, { body: "hola" })
        .catch((error_: unknown) => error_);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: "incident_closed",
      });
      expect(f.store.rows(ReservationIncidentMessageEntity)).toHaveLength(0);
      expect(f.notifications.notifyMessage).not.toHaveBeenCalled();
    });

    it("V4P message in any open status emails traveler + admin copy with the actor", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      const incident = await f.create(reservation.id, "other");
      f.notifications.notifyMessage.mockClear();

      const result = await f.service.addAdminMessage(
        incident.id,
        { body: "Estamos revisándolo" },
        { id: 7, name: "Laura" },
      );

      expect(result.status).toBe("received");
      expect(lastNotification(f)).toMatchObject({
        author: "admin",
        body: "Estamos revisándolo",
        event: "message",
        actorName: "Laura",
      });
    });

    it("status notes: needs_info → status_note email; resolved note → resolved email; no note → no email", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      const incident = await f.create(reservation.id, "other");
      f.notifications.notifyMessage.mockClear();

      await f.service.updateStatus(incident.id, { status: "in_review" });
      expect(f.notifications.notifyMessage).not.toHaveBeenCalled();

      await f.service.updateStatus(incident.id, {
        status: "needs_info",
        note: "Envíanos el ticket",
      });
      expect(lastNotification(f)).toMatchObject({
        author: "admin",
        body: "Envíanos el ticket",
        event: "status_note",
      });

      await f.service.updateStatus(incident.id, {
        status: "resolved",
        note: "Te hemos devuelto el importe",
      });
      expect(lastNotification(f)).toMatchObject({
        body: "Te hemos devuelto el importe",
        event: "resolved",
      });
      expect(f.notifications.notifyMessage).toHaveBeenCalledTimes(2);

      // Same status again (idempotent) does not email twice.
      await f.service.updateStatus(incident.id, {
        status: "resolved",
        note: "Te hemos devuelto el importe",
      });
      expect(f.notifications.notifyMessage).toHaveBeenCalledTimes(2);
    });

    it("an email failure never breaks the request", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      const incident = await f.create(reservation.id, "other");
      f.notifications.notifyMessage.mockRejectedValue(new Error("smtp down"));

      const result = await f.service.addTravelerMessage(OWNER, incident.id, {
        body: "¿Hay novedades?",
      });
      expect(result.messages).toHaveLength(1);
      const admin = await f.service.addAdminMessage(incident.id, {
        body: "Sí, mañana te decimos",
      });
      expect(admin.messages).toHaveLength(2);
    });

    it("getForTraveler: owner by reservation → thread; other user 403; missing 404", async () => {
      const f = createFixture();
      const reservation = await f.addReservation();
      const incident = await f.create(reservation.id, "other");
      await f.service.addTravelerMessage(OWNER, incident.id, { body: "uno" });

      const own = await f.service.getForTraveler(OWNER, incident.id);
      expect(own.incident.messages.map(m => m.body)).toEqual(["uno"]);
      expect(own.reservation.id).toBe(reservation.id);
      await expect(
        f.service.getForTraveler(OTHER, incident.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        f.service.getForTraveler(OWNER, 9999),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("DTO validation", () => {
    it("CreateIncidentDto: traveler types only, description 20..2000", async () => {
      expect(
        await errorsOf(CreateIncidentDto, {
          type: "during_stay",
          description: DESCRIPTION,
        }),
      ).toHaveLength(0);
      expect(
        await errorsOf(CreateIncidentDto, {
          type: "force_majeure_cancellation",
          description: DESCRIPTION,
        }),
      ).not.toHaveLength(0);
      expect(
        await errorsOf(CreateIncidentDto, {
          type: "other",
          description: "corto",
        }),
      ).not.toHaveLength(0);
    });

    it("AddIncidentAttachmentDto: random key + allowed mime + max 5 MB", async () => {
      expect(
        await errorsOf(AddIncidentAttachmentDto, attachment(hexKey(1))),
      ).toHaveLength(0);
      expect(
        await errorsOf(AddIncidentAttachmentDto, {
          ...attachment(hexKey(1)),
          storage_key: "../../etc/passwd",
        }),
      ).not.toHaveLength(0);
      expect(
        await errorsOf(AddIncidentAttachmentDto, {
          ...attachment(hexKey(1)),
          mime: "text/html",
        }),
      ).not.toHaveLength(0);
      expect(
        await errorsOf(AddIncidentAttachmentDto, {
          ...attachment(hexKey(1)),
          size_bytes: 5 * 1024 * 1024 + 1,
        }),
      ).not.toHaveLength(0);
    });
  });
});
