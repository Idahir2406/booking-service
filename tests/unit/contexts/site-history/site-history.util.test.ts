import { describe, expect, it } from "vitest";

import { actors } from "@/contexts/payments/domain/audit-actor";
import {
  parsePhpSiteAudit,
  phpAuditActorMatches,
  siteActorFromHeaders,
} from "@/contexts/site-history/utils/site-audit-input.util";
import {
  diffForAudit,
  flattenForAudit,
  SITE_AUDIT_ACTION,
} from "@/contexts/site-history/utils/site-change.util";
import {
  buildSiteHistory,
  fieldLabel,
  formatValue,
} from "@/contexts/site-history/utils/site-history.util";

describe("flattenForAudit", () => {
  it("keys arrays of objects by code / id and joins scalar arrays", () => {
    expect(
      flattenForAudit({
        price_per_night: 80,
        board_options: [
          { code: "BB", price: 10, is_included: false },
          { code: "HB", price: 25, is_included: false },
        ],
        tipdest: [3, 1],
        dog_supplies: [{ supply_id: 4, state: "yes" }],
        updated_at: new Date("2026-11-16T00:00:00Z"),
      }),
    ).toEqual({
      price_per_night: 80,
      "board_options[BB].code": "BB",
      "board_options[HB].code": "HB",
      "board_options[BB].price": 10,
      "board_options[BB].is_included": false,
      "board_options[HB].price": 25,
      "board_options[HB].is_included": false,
      tipdest: "1, 3",
      "dog_supplies[4].supply_id": 4,
      "dog_supplies[4].state": "yes",
    });
  });
});

describe("diffForAudit", () => {
  it("returns only the changed fields", () => {
    expect(
      diffForAudit(
        {
          name: "Casa",
          price_per_night: "80.00",
          board_options: [{ code: "BB", price: 10 }],
        },
        {
          name: "Casa",
          price_per_night: 95,
          board_options: [{ code: "BB", price: 12 }],
        },
      ),
    ).toEqual({
      before: { "board_options[BB].price": 10, price_per_night: "80.00" },
      after: { "board_options[BB].price": 12, price_per_night: 95 },
    });
  });

  it("treats null, undefined and empty string as equal and numeric strings as numbers", () => {
    expect(
      diffForAudit(
        { a: null, b: "80.00", c: "" },
        { a: "", b: 80, c: undefined },
      ),
    ).toBeNull();
  });

  it("records created and removed items", () => {
    expect(diffForAudit({}, { name: "Doble" })).toEqual({
      before: { name: null },
      after: { name: "Doble" },
    });
    expect(
      diffForAudit({ extras: [{ name: "Cuna", price: 5 }] }, { extras: [] }),
    ).toEqual({
      before: { "extras[Cuna].name": "Cuna", "extras[Cuna].price": 5 },
      after: { "extras[Cuna].name": null, "extras[Cuna].price": null },
    });
  });

  it("never stores ignored keys", () => {
    expect(
      diffForAudit(
        { stripe_account_id: "acct_1" },
        { stripe_account_id: "acct_2" },
      ),
    ).toBeNull();
  });
});

describe("fieldLabel / formatValue", () => {
  it("labels nested paths in Spanish", () => {
    expect(fieldLabel("board_options[BB].price")).toBe("Régimen BB · Precio");
    expect(fieldLabel("schedule.checkin_from")).toBe("Horario · Entrada desde");
    expect(fieldLabel("image7")).toBe("Foto 7");
    expect(fieldLabel("description2_es")).toBe("Descripción larga (es)");
    expect(
      fieldLabel("dog_supplies[4].state", {
        dog_supplies: new Map([["4", "Cama para perro"]]),
      }),
    ).toBe("Para el perro: Cama para perro · Disponible");
  });

  it("formats money, booleans, empty and enum values", () => {
    expect(formatValue("price_per_night", 95)).toBe("95,00 €");
    expect(formatValue("board_options[BB].price", "10")).toBe("10,00 €");
    expect(formatValue("is_active", false)).toBe("No");
    expect(formatValue("note", null)).toBe("—");
    expect(formatValue("cribs.pricing_mode", "per_night")).toBe("por noche");
  });
});

describe("buildSiteHistory", () => {
  const rows = [
    {
      id: "12",
      action: SITE_AUDIT_ACTION.UNIT_UPDATED,
      actor_type: "host",
      actor_id: "site:7",
      before: { price_per_night: 80 },
      after: { price_per_night: 95 },
      metadata: { source: "wizard", room_name: "Doble" },
      created_at: new Date("2026-11-16T10:00:00Z"),
    },
    {
      id: "13",
      action: SITE_AUDIT_ACTION.ADMIN_UPDATED,
      actor_type: "admin",
      actor_id: "admino:laura",
      before: { active: "N" },
      after: { active: "S" },
      metadata: { source: "admino", subject: "Ficha del alojamiento" },
      created_at: new Date("2026-11-16T11:00:00Z"),
    },
  ];

  it("hides admin names and source from the host", () => {
    const [unit, admin] = buildSiteHistory(rows, "host");
    expect(unit).toMatchObject({
      label: "Unidad modificada",
      actor_label: "Alojamiento",
      subject: "Doble",
      source: null,
      changes: [
        {
          field: "price_per_night",
          label: "Precio por noche",
          before: "80,00 €",
          after: "95,00 €",
        },
      ],
    });
    expect(admin.actor_label).toBe("viajes4patas");
  });

  it("shows admin name and source to admino", () => {
    const [, admin] = buildSiteHistory(rows, "admin");
    expect(admin).toMatchObject({
      label: "Modificado por viajes4patas",
      actor_label: "viajes4patas (laura)",
      source: "admino",
      subject: "Ficha del alojamiento",
    });
  });
});

describe("PHP audit input", () => {
  it("accepts only PHP actions with flat scalar records", () => {
    expect(
      parsePhpSiteAudit({
        action: SITE_AUDIT_ACTION.PHOTOS_CHANGED,
        source: "legacy_profile",
        before: { image1: "a.webp" },
        after: { image1: "b.webp" },
      }),
    ).toEqual({
      ok: true,
      value: {
        action: SITE_AUDIT_ACTION.PHOTOS_CHANGED,
        source: "legacy_profile",
        before: { image1: "a.webp" },
        after: { image1: "b.webp" },
        subject: null,
      },
    });
    expect(
      parsePhpSiteAudit({
        action: SITE_AUDIT_ACTION.UNIT_UPDATED,
        source: "wizard",
      }),
    ).toEqual({ ok: false, error: "action not allowed" });
    expect(
      parsePhpSiteAudit({
        action: SITE_AUDIT_ACTION.PHOTOS_CHANGED,
        source: "wizard",
        after: { image1: { nested: true } },
      }),
    ).toEqual({ ok: false, error: "after.image1: must be a scalar" });
  });

  it("resolves host vs admin actor and checks the source", () => {
    expect(siteActorFromHeaders({}, 7)).toEqual(actors.host(7));
    const admin = siteActorFromHeaders({ "x-actor-name": "laura" }, 7);
    expect(admin).toEqual({ type: "admin", id: "admino:laura" });
    const input = {
      action: SITE_AUDIT_ACTION.ADMIN_UPDATED,
      source: "admino" as const,
      before: {},
      after: {},
      subject: null,
    };
    expect(phpAuditActorMatches(input, admin)).toBe(true);
    expect(phpAuditActorMatches(input, actors.host(7))).toBe(false);
  });
});
