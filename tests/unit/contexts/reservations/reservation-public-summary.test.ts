import { NotFoundException } from "@nestjs/common";
import { vi } from "vitest";

import { ReservationService } from "@/src/contexts/reservations/services/reservation.service";

const legacyRow = {
  id: 15,
  status: "confirmed",
  payment_status: "paid",
  charge_mode: "immediate",
  charge_at: null,
  checkin: "2099-07-16",
  checkout: "2099-07-20",
  total: "400.00",
  timezone: null,
  stripe_checkout_session_id: "cs_legacy",
  source: "internal",
  provider_status: null,
};

const createService = (findLatestSnapshot: () => Promise<unknown>) => {
  const reservationRepository = {
    findOne: vi.fn(() => Promise.resolve({ ...legacyRow })),
  };
  return new ReservationService(
    reservationRepository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { findLatestSnapshot: vi.fn(findLatestSnapshot) } as never,
    {} as never,
    {} as never,
  );
};

describe("Fase 5 · ReservationService.getPublicSummary (legacy)", () => {
  it("legacy reservation: no policy text, immediate, no charge date", async () => {
    const service = createService(() =>
      Promise.resolve({
        payload: {
          refund_policy: {
            rule: "legacy_host_full_refund_until_24h_before_checkin",
            timezone: "Europe/Madrid",
          },
        },
      }),
    );

    const summary = await service.getPublicSummary(15, "cs_legacy");

    expect(summary).toEqual({
      id: 15,
      code: "#RES-15",
      status: "confirmed",
      payment_status: "paid",
      checkin: "2099-07-16",
      checkout: "2099-07-20",
      total: 400,
      policy_text: null,
      charge_mode: "immediate",
      charge_at_iso: null,
      timezone: "Europe/Madrid",
      source: "internal",
      provider_status: null,
    });
  });

  it("a failing snapshot read never breaks the success page", async () => {
    const service = createService(() => Promise.reject(new Error("db down")));

    const summary = await service.getPublicSummary(15, "cs_legacy");

    expect(summary.policy_text).toBeNull();
    expect(summary.charge_mode).toBe("immediate");
  });

  it("still requires the Checkout Session id", async () => {
    const service = createService(() => Promise.resolve(null));
    await expect(
      service.getPublicSummary(15, "cs_other"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
