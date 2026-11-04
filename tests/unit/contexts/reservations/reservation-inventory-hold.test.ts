import { describe, expect, it } from "vitest";

import { isReservationBlockingInventory } from "@/contexts/reservations/utils/reservation-policy.util";

describe("isReservationBlockingInventory", () => {
  const now = new Date("2026-07-25T12:00:00.000Z");

  it("blocks confirmed and finalized regardless of expiration", () => {
    expect(
      isReservationBlockingInventory(
        {
          status: "confirmed",
          payment_status: "paid",
          expiration_date: "2020-01-01T00:00:00.000Z",
        },
        now,
      ),
    ).toBe(true);

    expect(
      isReservationBlockingInventory(
        {
          status: "finalized",
          payment_status: "paid",
          expiration_date: "2020-01-01T00:00:00.000Z",
        },
        now,
      ),
    ).toBe(true);
  });

  it("blocks paid reservations even if still pending", () => {
    expect(
      isReservationBlockingInventory(
        {
          status: "pending",
          payment_status: "paid",
          expiration_date: "2020-01-01T00:00:00.000Z",
        },
        now,
      ),
    ).toBe(true);
  });

  it("does not block an unpaid pending reservation", () => {
    expect(
      isReservationBlockingInventory(
        {
          status: "pending",
          payment_status: "pending",
          charge_mode: "immediate",
          expiration_date: "2026-07-25T12:30:00.000Z",
        },
        now,
      ),
    ).toBe(false);

    expect(
      isReservationBlockingInventory(
        {
          status: "pending",
          payment_status: "pending",
          charge_mode: "flexible",
          expiration_date: "2026-07-25T12:30:00.000Z",
        },
        now,
      ),
    ).toBe(false);
  });

  it("does not block cancelled reservations", () => {
    expect(
      isReservationBlockingInventory(
        {
          status: "cancelled",
          payment_status: "paid",
          expiration_date: null,
        },
        now,
      ),
    ).toBe(false);
  });
});
