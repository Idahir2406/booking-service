import type { IncidentMessageEmailPayload } from "@/src/contexts/reservations/types/reservation-email.types";

import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { vi } from "vitest";

import { FakeEntityStore } from "@/tests/utils/fake-entity-store";

import { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";
import { ReservationIncidentEntity } from "@/src/contexts/reservations/entities/reservation-incident.entity";
import { ReservationIncidentAttachmentEntity } from "@/src/contexts/reservations/entities/reservation-incident-attachment.entity";
import { ReservationIncidentMessageEntity } from "@/src/contexts/reservations/entities/reservation-incident-message.entity";
import { ReservationEmailService } from "@/src/contexts/reservations/services/reservation-email.service";
import { ReservationEmailTemplateService } from "@/src/contexts/reservations/services/reservation-email-template.service";
import { ReservationIncidentService } from "@/src/contexts/reservations/services/reservation-incident.service";
import { ReservationIncidentNotificationService } from "@/src/contexts/reservations/services/reservation-incident-notification.service";
import {
  incidentPreview,
  TravelerIncidentInboxService,
} from "@/src/contexts/reservations/services/traveler-incident-inbox.service";
import { envs } from "@/src/contexts/shared/configs/envs";

const OWNER = 10;
const OTHER = 99;

const payload = (
  overrides: Partial<IncidentMessageEmailPayload> = {},
): IncidentMessageEmailPayload => ({
  incident_id: 5,
  reservation_id: 77,
  incident_type: "during_stay",
  incident_status: "in_review",
  event: "message",
  author: "traveler",
  body: "No había <b>agua</b> & luz",
  site_name: "Casa Rural <Pinos>",
  site_town: "Olot",
  checkin: "2099-08-10",
  checkout: "2099-08-14",
  traveler_name: "Ana",
  traveler_email: "ana@example.com",
  admin_email: "reservas@viajes4patas.com",
  actor_name: null,
  panel_url: "https://web.test/mi-perfil-textos?selTab=tv_incidencias&inc=5",
  admin_url: "https://web.test/admino/php/admIncidencia.php?id=5",
  ...overrides,
});

const templates = new ReservationEmailTemplateService();

const subject = (
  type: "incident_message_admin" | "incident_message_traveler",
  overrides: Partial<IncidentMessageEmailPayload>,
) => templates.buildIncidentMessage(type, payload(overrides))?.subject;

const createNotifier = (
  profile: { name: string | null; email: string | null } | null,
  send: () => Promise<boolean> = () => Promise.resolve(true),
) => {
  const reservationRepository = {
    findOne: vi.fn().mockResolvedValue({
      id: 77,
      user_id: OWNER,
      site_id: 42,
      checkin: "2099-08-10",
      checkout: "2099-08-14",
      guest_name: "Ana Reserva",
      guest_email: "guest@example.com",
    }),
  };
  const emails = { sendIncidentMessageEmail: vi.fn(send) };
  const mysql = {
    queryOne: vi.fn((sql: string) =>
      Promise.resolve(
        sql.includes("user_profiles")
          ? profile
          : { name: "Casa Pinos", poblacio: "Olot" },
      ),
    ),
  };
  const notifier = new ReservationIncidentNotificationService(
    reservationRepository as never,
    emails as never,
    mysql as never,
  );
  return { notifier, emails };
};

const createInbox = (siteLookup?: () => Promise<unknown[]>) => {
  const store = new FakeEntityStore();
  const reservations = store.repository(ReservationEntity);
  const incidents = store.repository(ReservationIncidentEntity);
  const messages = store.repository(ReservationIncidentMessageEntity);
  const attachments = store.repository(ReservationIncidentAttachmentEntity);
  const incidentService = new ReservationIncidentService(
    reservations as never,
    incidents as never,
    attachments as never,
    messages as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const mysql = {
    query: vi.fn(
      siteLookup ??
        (() =>
          Promise.resolve([
            { id: 42, name: "Casa Pinos", poblacio: "Olot" },
            { id: 43, name: "Masia Sol", poblacio: "" },
          ])),
    ),
  };
  const inbox = new TravelerIncidentInboxService(
    reservations as never,
    incidents as never,
    messages as never,
    attachments as never,
    incidentService,
    mysql as never,
  );
  const addReservation = async (overrides: Partial<ReservationEntity>) =>
    (await reservations.save({
      site_id: 42,
      room_id: 3,
      user_id: OWNER,
      checkin: "2099-08-10",
      checkout: "2099-08-14",
      status: "confirmed",
      payment_status: "paid",
      ...overrides,
    })) as unknown as ReservationEntity;
  const addIncident = async (
    reservationId: number,
    overrides: Record<string, unknown> = {},
  ) =>
    (await incidents.save({
      reservation_id: reservationId,
      user_id: OWNER,
      type: "other",
      status: "received",
      description: "El alojamiento no tenía agua caliente",
      blocks_payout: false,
      dispute_id: null,
      created_at: new Date("2099-08-11T10:00:00Z"),
      ...overrides,
    })) as unknown as ReservationIncidentEntity;
  const addMessage = (
    incidentId: number,
    author: "traveler" | "admin",
    body: string,
    at: string,
  ) =>
    messages.save({
      incident_id: incidentId,
      author_type: author,
      body,
      created_at: new Date(at),
    });
  return { inbox, mysql, addReservation, addIncident, addMessage };
};

describe("Incident chat emails — templates", () => {
  it("traveler message → admin email: escaped HTML, plain text, admino link", () => {
    const built = templates.buildIncidentMessage(
      "incident_message_admin",
      payload(),
    );
    expect(built).not.toBeNull();
    expect(built?.to).toBe("reservas@viajes4patas.com");
    expect(built?.subject).toBe(
      "Nuevo mensaje del viajero en la incidencia #INC-5 (#RES-77)",
    );
    expect(built?.html).toContain("No había &lt;b&gt;agua&lt;/b&gt; &amp; luz");
    expect(built?.html).toContain("Casa Rural &lt;Pinos&gt; · Olot");
    expect(built?.html).not.toContain("<b>agua</b>");
    expect(built?.html).toContain(
      'href="https://web.test/admino/php/admIncidencia.php?id=5"',
    );
    expect(built?.text).toContain("No había <b>agua</b> & luz");
    expect(built?.text).toContain("ana@example.com");
  });

  it("V4P message → traveler email with the panel link; missing email → skipped", () => {
    const built = templates.buildIncidentMessage(
      "incident_message_traveler",
      payload({ author: "admin", body: "Hola Ana" }),
    );
    expect(built?.to).toBe("ana@example.com");
    expect(built?.subject).toBe(
      "Nuevo mensaje en tu incidencia #INC-5 (#RES-77)",
    );
    expect(built?.html).toContain(
      'href="https://web.test/mi-perfil-textos?selTab=tv_incidencias&amp;inc=5"',
    );
    expect(built?.text).toContain(
      "https://web.test/mi-perfil-textos?selTab=tv_incidencias&inc=5",
    );
    expect(
      templates.buildIncidentMessage(
        "incident_message_traveler",
        payload({ traveler_email: "" }),
      ),
    ).toBeNull();
  });

  it("subjects for the copies, the creation and the resolution", () => {
    expect(subject("incident_message_traveler", {})).toBe(
      "Hemos recibido tu mensaje en la incidencia #INC-5 (#RES-77)",
    );
    expect(subject("incident_message_traveler", { event: "opened" })).toBe(
      "Hemos recibido tu incidencia #INC-5 (#RES-77)",
    );
    expect(subject("incident_message_admin", { author: "admin" })).toBe(
      "Copia: respuesta enviada en la incidencia #INC-5 (#RES-77)",
    );
    expect(
      subject("incident_message_traveler", {
        author: "admin",
        event: "resolved",
      }),
    ).toBe("Tu incidencia se ha resuelto #INC-5 (#RES-77)");
  });

  it("ReservationEmailService queues html + text and never throws", async () => {
    const enqueue = vi.fn(() => Promise.resolve({ queued: true }));
    const service = new ReservationEmailService(
      { enqueue } as never,
      templates,
      {} as never,
    );
    await expect(
      service.sendIncidentMessageEmail("incident_message_admin", payload()),
    ).resolves.toBe(true);
    const [options] = enqueue.mock.calls[0] as unknown as [
      { html: string; text?: string },
    ];
    expect(options.html).toContain("#INC-5");
    expect(options.text).toContain("Mensaje del viajero");

    enqueue.mockRejectedValueOnce(new Error("redis down"));
    await expect(
      service.sendIncidentMessageEmail("incident_message_admin", payload()),
    ).resolves.toBe(false);
  });
});

describe("ReservationIncidentNotificationService", () => {
  const incident = {
    id: 5,
    reservation_id: 77,
    type: "during_stay",
    status: "in_review",
  } as unknown as ReservationIncidentEntity;

  it("one email to the admin and one to the traveler (profile email first)", async () => {
    const { notifier, emails } = createNotifier({
      name: "Ana",
      email: "ana@example.com",
    });
    await notifier.notifyMessage({
      incident,
      author: "traveler",
      body: "hola",
      event: "message",
    });
    const calls = emails.sendIncidentMessageEmail.mock.calls as unknown as [
      string,
      IncidentMessageEmailPayload,
    ][];
    expect(calls.map(([type]) => type)).toEqual([
      "incident_message_admin",
      "incident_message_traveler",
    ]);
    expect(calls[0][1]).toMatchObject({
      traveler_email: "ana@example.com",
      admin_email: envs.BOOKING_ADMIN_EMAIL,
      site_name: "Casa Pinos",
      site_town: "Olot",
      checkin: "2099-08-10",
      body: "hola",
    });
    expect(calls[0][1].panel_url).toMatch(
      /\/mi-perfil-textos\?selTab=tv_incidencias&inc=5$/,
    );
    expect(calls[0][1].admin_url).toMatch(/\/php\/admIncidencia\.php\?id=5$/);
  });

  it("falls back to reservation.guest_email; respects recipients", async () => {
    const { notifier, emails } = createNotifier({ name: "", email: "" });
    await notifier.notifyMessage({
      incident,
      author: "admin",
      body: "respuesta",
      event: "status_note",
      recipients: ["incident_message_traveler"],
    });
    const calls = emails.sendIncidentMessageEmail.mock.calls as unknown as [
      string,
      IncidentMessageEmailPayload,
    ][];
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("incident_message_traveler");
    expect(calls[0][1].traveler_email).toBe("guest@example.com");
    expect(calls[0][1].traveler_name).toBe("Ana Reserva");
  });

  it("an email failure is logged; the other recipient still gets it; never throws", async () => {
    let n = 0;
    const { notifier, emails } = createNotifier(null, () => {
      n += 1;
      return n === 1
        ? Promise.reject(new Error("smtp down"))
        : Promise.resolve(true);
    });
    await expect(
      notifier.notifyMessage({
        incident,
        author: "traveler",
        body: "hola",
        event: "message",
      }),
    ).resolves.toBeUndefined();
    expect(emails.sendIncidentMessageEmail).toHaveBeenCalledTimes(2);
  });
});

describe("TravelerIncidentInboxService (Incidencias tab)", () => {
  it("lists only the incidents of the user's reservations, last activity first, with site data", async () => {
    const f = createInbox();
    const mine = await f.addReservation({ site_id: 42 });
    const mineOther = await f.addReservation({ site_id: 43 });
    const foreign = await f.addReservation({ user_id: OTHER });
    const old = await f.addIncident(mine.id, {
      type: "during_stay",
      blocks_payout: true,
    });
    const recent = await f.addIncident(mineOther.id, { status: "resolved" });
    await f.addIncident(foreign.id);
    await f.addMessage(
      recent.id,
      "admin",
      "Resuelto, gracias",
      "2099-08-20T09:00:00Z",
    );
    await f.addMessage(
      old.id,
      "traveler",
      "x".repeat(300),
      "2099-08-12T09:00:00Z",
    );

    const page = await f.inbox.listForTraveler(OWNER);

    expect(page.total).toBe(2);
    expect(page.items.map(item => item.id)).toEqual([recent.id, old.id]);
    expect(page.items[0]).toMatchObject({
      incident_ref: `#INC-${recent.id}`,
      reservation_ref: `#RES-${mineOther.id}`,
      status: "resolved",
      is_open: false,
      site_id: 43,
      site_name: "Masia Sol",
      site_town: null,
      last_message_preview: "Resuelto, gracias",
      last_message_author: "admin",
      message_count: 1,
      attachment_count: 0,
      checkin: "2099-08-10",
      checkout: "2099-08-14",
    });
    expect(page.items[1]).toMatchObject({
      site_name: "Casa Pinos",
      site_town: "Olot",
      blocks_payout: true,
      is_open: true,
    });
    expect([...(page.items[1].last_message_preview ?? "")]).toHaveLength(140);
    expect(page.items[1].last_message_preview?.endsWith("…")).toBe(true);
  });

  it("no reservations/incidents → empty; failed site lookup → null names", async () => {
    const f = createInbox(() => Promise.reject(new Error("mysql down")));
    expect(await f.inbox.listForTraveler(OWNER)).toEqual({
      items: [],
      total: 0,
    });
    const reservation = await f.addReservation({});
    await f.addIncident(reservation.id);
    const page = await f.inbox.listForTraveler(OWNER);
    expect(page.items[0]).toMatchObject({
      site_name: null,
      site_town: null,
      last_message_preview: "El alojamiento no tenía agua caliente",
      last_message_author: null,
    });
  });

  it("thread: chronological messages with author_display, can_reply while open; 403/404", async () => {
    const f = createInbox();
    const reservation = await f.addReservation({});
    const incident = await f.addIncident(reservation.id, {
      status: "needs_info",
    });
    await f.addMessage(incident.id, "admin", "¿Foto?", "2099-08-12T09:00:00Z");
    await f.addMessage(
      incident.id,
      "traveler",
      "Adjunta",
      "2099-08-12T10:00:00Z",
    );

    const thread = await f.inbox.getThreadForTraveler(OWNER, incident.id);
    expect(thread).toMatchObject({
      incident_ref: `#INC-${incident.id}`,
      site_name: "Casa Pinos",
      can_reply: true,
    });
    expect(
      thread.messages.map(m => [m.author_type, m.author_display, m.body]),
    ).toEqual([
      ["admin", "Equipo V4P", "¿Foto?"],
      ["traveler", "Tú", "Adjunta"],
    ]);
    await expect(
      f.inbox.getThreadForTraveler(OTHER, incident.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      f.inbox.getThreadForTraveler(OWNER, 9999),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("incidentPreview collapses whitespace and keeps short texts", () => {
    expect(incidentPreview("  hola\n\n  mundo ")).toBe("hola mundo");
    expect(incidentPreview("")).toBeNull();
  });
});
