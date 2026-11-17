import type { ReservationEmailPayload } from "@/src/contexts/reservations/types/reservation-email.types";
import type { Site } from "@/src/types/site.types";

import { vi } from "vitest";

import { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";
import { ReservationEmailService } from "@/src/contexts/reservations/services/reservation-email.service";
import { ReservationEmailTemplateService } from "@/src/contexts/reservations/services/reservation-email-template.service";

const templates = new ReservationEmailTemplateService();

const POLICY_TEXT =
  "Cancelación gratuita hasta el 03/05/2099 a las 18:00 (hora de Madrid).";
/** 03/05/2099 18:00 Europe/Madrid (CEST). */
const CHARGE_AT = "2099-05-03T16:00:00.000Z";

const basePayload = (
  overrides: Partial<ReservationEmailPayload> = {},
): ReservationEmailPayload => ({
  reservation_id: 77,
  guest_name: "Ana",
  guest_email: "ana@example.com",
  host_email: "host@example.com",
  checkin: "2099-05-10",
  checkout: "2099-05-12",
  guests: 2,
  pets: 1,
  total: 300,
  site_name: "Casa Perruna",
  price_lines: [
    {
      description: "Alojamiento 2 noches",
      detail: null,
      amount_cents: 30_000,
      is_optional: false,
    },
  ],
  total_cents: 30_000,
  deposit: null,
  dogs: [],
  ...overrides,
});

describe("Fase 5 · confirmation emails", () => {
  it("immediate / legacy: keeps «Total pagado» and adds no charge note nor policy", () => {
    const guest = templates.build("payment_confirmed_guest", basePayload());
    expect(guest?.html).toContain("Total pagado");
    expect(guest?.html).not.toContain("Total de la reserva");
    expect(guest?.html).not.toContain("no se ha cobrado");
    expect(guest?.html).not.toContain("Política de cancelación");
  });

  it("structured policy: guest and host emails include the frozen policy text", () => {
    const payload = basePayload({ policy_text: POLICY_TEXT });
    const guest = templates.build("payment_confirmed_guest", payload);
    const host = templates.build("payment_confirmed_host", payload);
    for (const email of [guest, host]) {
      expect(email?.html).toContain("Política de cancelación");
      expect(email?.html).toContain(
        "Cancelación gratuita hasta el 03/05/2099 a las 18:00 (hora de Madrid).",
      );
      // Paid now: the total is what was charged.
      expect(email?.html).toContain("Total pagado");
    }
  });

  it("flexible unpaid: «Total de la reserva» + charge date in the site timezone", () => {
    const payload = basePayload({
      policy_text: POLICY_TEXT,
      charge_pending: true,
      charge_at: CHARGE_AT,
      timezone: "Europe/Madrid",
    });
    const guest = templates.build("payment_confirmed_guest", payload);
    expect(guest?.html).toContain("Total de la reserva");
    expect(guest?.html).not.toContain("Total pagado");
    expect(guest?.html).toContain(
      "Hoy no se ha cobrado nada. Se cobrarán 300,00 € el 03/05/2099 a las 18:00 (hora de Madrid)",
    );

    const host = templates.build("payment_confirmed_host", payload);
    expect(host?.html).toContain("Total de la reserva");
    expect(host?.html).toContain(
      "Todavía no se ha cobrado nada al viajero. Se le cobrarán 300,00 € el 03/05/2099 a las 18:00 (hora de Madrid)",
    );
  });

  it("flexible unpaid in Canarias: hour shown in Atlantic/Canary", () => {
    const guest = templates.build(
      "payment_confirmed_guest",
      basePayload({
        charge_pending: true,
        charge_at: CHARGE_AT,
        timezone: "Atlantic/Canary",
      }),
    );
    expect(guest?.html).toContain(
      "el 03/05/2099 a las 17:00 (hora de Canarias)",
    );
  });

  it("flexible charged right after the setup (charge_at due): «en los próximos minutos»", () => {
    const guest = templates.build(
      "payment_confirmed_guest",
      basePayload({
        charge_pending: true,
        charge_at: new Date().toISOString(),
        timezone: "Europe/Madrid",
      }),
    );
    expect(guest?.html).toContain(
      "Se cobrarán 300,00 € en los próximos minutos",
    );
  });

  describe("ReservationEmailService.sendPaymentConfirmedEmails", () => {
    const site = {
      id: 42,
      name: "Casa Perruna",
      email: "host@example.com",
    } as Site;

    const reservation = (overrides: Partial<ReservationEntity> = {}) =>
      ({
        id: 77,
        site_id: 42,
        guest_name: "Ana",
        guest_email: "ana@example.com",
        checkin: "2099-05-10",
        checkout: "2099-05-12",
        guests: 2,
        pets: 1,
        total: 300,
        status: "confirmed",
        payment_status: "paid",
        charge_mode: "immediate",
        charge_at: null,
        timezone: "Europe/Madrid",
        ...overrides,
      }) as unknown as ReservationEntity;

    const snapshotPayload = (structured: boolean) => ({
      price_lines: [
        { description: "Alojamiento 2 noches", amount_cents: 30_000 },
      ],
      total_cents: 30_000,
      refund_policy: structured
        ? {
            rule: "structured",
            cancellation: { policy_type: "free_cancellation" },
            generated_text: POLICY_TEXT,
            timezone: "Europe/Madrid",
          }
        : { rule: "legacy_host_full_refund_until_24h_before_checkin" },
    });

    const createService = (structured: boolean) => {
      const enqueue = vi.fn(() => Promise.resolve({ queued: true }));
      const economics = {
        findLatestSnapshot: vi.fn(() =>
          Promise.resolve({ payload: snapshotPayload(structured) }),
        ),
      };
      const service = new ReservationEmailService(
        { enqueue } as never,
        templates,
        economics as never,
      );
      const htmls = () =>
        (enqueue.mock.calls as unknown as [{ html: string }][]).map(
          ([options]) => options.html,
        );
      return { service, htmls };
    };

    it("flexible unpaid: both emails carry the policy and the charge date", async () => {
      const { service, htmls } = createService(true);
      await service.sendPaymentConfirmedEmails(
        reservation({
          payment_status: "pending",
          charge_mode: "flexible",
          charge_at: new Date(CHARGE_AT),
        }),
        site,
      );
      const [guest, host] = htmls();
      expect(guest).toContain("Total de la reserva");
      expect(guest).toContain("el 03/05/2099 a las 18:00 (hora de Madrid)");
      expect(guest).toContain(POLICY_TEXT);
      expect(host).toContain("Se le cobrarán 300,00 €");
      expect(host).toContain(POLICY_TEXT);
    });

    it("legacy snapshot: classic email (no policy block, «Total pagado»)", async () => {
      const { service, htmls } = createService(false);
      await service.sendPaymentConfirmedEmails(reservation(), site);
      const [guest, host] = htmls();
      for (const html of [guest, host]) {
        expect(html).toContain("Total pagado");
        expect(html).not.toContain("Política de cancelación");
        expect(html).not.toContain("no se ha cobrado");
      }
    });
  });
});
