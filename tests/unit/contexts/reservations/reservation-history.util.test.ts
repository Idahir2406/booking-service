import { describe, expect, it } from "vitest";

import { buildReservationHistory } from "@/contexts/reservations/utils/reservation-history.util";

const at = (iso: string) => new Date(iso);

describe("buildReservationHistory", () => {
  const events = [
    {
      event_type: "finalized",
      payload: { by: "system" },
      created_at: at("2026-07-22T10:00:00Z"),
    },
    {
      event_type: "payment_confirmed",
      payload: {},
      created_at: at("2026-07-01T10:05:00Z"),
    },
    {
      event_type: "host_cannot_host_rejected",
      payload: {
        note: "El alojamiento sí puede",
        actor: { id: null, name: "laura" },
      },
      created_at: at("2026-07-10T09:00:00Z"),
    },
    {
      event_type: "checkout_session_replaced",
      payload: {},
      created_at: at("2026-07-01T10:01:00Z"),
    },
  ];
  const audits = [
    {
      action: "reservation.created",
      actor_type: "traveler",
      actor_id: "10",
      created_at: at("2026-07-01T10:00:00Z"),
    },
    {
      action: "payout.status_changed",
      actor_type: "system",
      created_at: at("2026-07-02T10:00:00Z"),
    },
  ];

  it("orders items and resolves the actor (payload.by wins)", () => {
    const items = buildReservationHistory(events, audits, "admin");
    expect(items.map(item => item.action)).toEqual([
      "created",
      "checkout_session_replaced",
      "payment_confirmed",
      "host_cannot_host_rejected",
      "finalized",
    ]);
    expect(items[0].actor).toBe("traveler");
    expect(items.at(-1)?.actor).toBe("system");
  });

  it("shows admin name and notes only to V4P", () => {
    const admin = buildReservationHistory(events, audits, "admin").find(
      item => item.action === "host_cannot_host_rejected",
    );
    expect(admin?.actor_label).toBe("viajes4patas (laura)");
    expect(admin?.detail).toContain("Nota:");

    const host = buildReservationHistory(events, audits, "host");
    const hostItem = host.find(
      item => item.action === "host_cannot_host_rejected",
    );
    expect(hostItem?.actor_label).toBe("viajes4patas");
    expect(hostItem?.detail).toBeNull();
    expect(host.some(item => item.action === "checkout_session_replaced")).toBe(
      false,
    );
  });

  it("humanizes unknown event types", () => {
    const [item] = buildReservationHistory(
      [{ event_type: "something_new", created_at: at("2026-01-01T00:00:00Z") }],
      [],
      "host",
    );
    expect(item.label).toBe("Something new");
  });
});
