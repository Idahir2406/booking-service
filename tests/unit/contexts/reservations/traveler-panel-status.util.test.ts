import type { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";

import { describe, expect, it } from "vitest";

import { PAYMENT_STATUSES } from "@/src/contexts/payments/domain/payment-state-machine";
import { REFUND_STATUSES } from "@/src/contexts/payments/domain/refund-state-machine";
import {
  isAbandonedPendingCheckout,
  mapPaymentLabelKey,
  mapRefundLabelKey,
  mapTravelerFacingStatus,
  resolveTravelerPayability,
  resolveTravelerTab,
  TRAVELER_PAYMENT_LABEL,
  TRAVELER_STATUS,
  TRAVELER_TAB,
} from "@/src/contexts/reservations/utils/traveler-panel-status.util";

type StatusFields = Pick<ReservationEntity, "status" | "payment_status">;

const status = (
  reservation: StatusFields,
  flags: Partial<{
    has_open_dispute: boolean;
    has_pending_refund: boolean;
    has_open_incident: boolean;
  }> = {},
) =>
  mapTravelerFacingStatus({
    reservation,
    has_open_dispute: false,
    has_pending_refund: false,
    has_open_incident: false,
    ...flags,
  });

const NOW = new Date("2026-08-10T12:00:00.000Z");

describe("traveler-panel-status.util", () => {
  describe("mapTravelerFacingStatus", () => {
    it("cancelled wins over an open dispute", () => {
      expect(
        status(
          { status: "cancelled", payment_status: "refunded" },
          { has_open_dispute: true, has_pending_refund: true },
        ),
      ).toEqual({ status: TRAVELER_STATUS.CANCELLED, is_fallback: false });
    });

    it("open dispute on confirmed/paid → incident_review", () => {
      expect(
        status(
          { status: "confirmed", payment_status: "paid" },
          { has_open_dispute: true },
        ).status,
      ).toBe(TRAVELER_STATUS.INCIDENT_REVIEW);
    });

    it("pending refund without dispute → incident_review", () => {
      expect(
        status(
          { status: "confirmed", payment_status: "paid" },
          { has_pending_refund: true },
        ).status,
      ).toBe(TRAVELER_STATUS.INCIDENT_REVIEW);
    });

    it("F-PV7a: open incident on confirmed/paid or finalized → incident_review", () => {
      expect(
        status(
          { status: "confirmed", payment_status: "paid" },
          { has_open_incident: true },
        ).status,
      ).toBe(TRAVELER_STATUS.INCIDENT_REVIEW);
      expect(
        status(
          { status: "finalized", payment_status: "paid" },
          { has_open_incident: true },
        ).status,
      ).toBe(TRAVELER_STATUS.INCIDENT_REVIEW);
      expect(
        status(
          { status: "cancelled", payment_status: "refunded" },
          { has_open_incident: true },
        ).status,
      ).toBe(TRAVELER_STATUS.CANCELLED);
    });

    it("finalized", () => {
      expect(
        status({ status: "finalized", payment_status: "paid" }).status,
      ).toBe(TRAVELER_STATUS.FINALIZED);
    });

    it("pending + pending → payment_pending", () => {
      expect(
        status({ status: "pending", payment_status: "pending" }).status,
      ).toBe(TRAVELER_STATUS.PAYMENT_PENDING);
    });

    it("confirmed + paid → confirmed", () => {
      expect(status({ status: "confirmed", payment_status: "paid" })).toEqual({
        status: TRAVELER_STATUS.CONFIRMED,
        is_fallback: false,
      });
    });

    it("confirmed + partially_refunded → conservative fallback", () => {
      expect(
        status({ status: "confirmed", payment_status: "partially_refunded" }),
      ).toEqual({ status: TRAVELER_STATUS.IN_PROGRESS, is_fallback: true });
    });
  });

  describe("resolveTravelerTab", () => {
    it("checkout today is upcoming, yesterday is past", () => {
      expect(
        resolveTravelerTab(
          { status: "confirmed", checkout: "2026-08-10" },
          NOW,
        ),
      ).toBe(TRAVELER_TAB.UPCOMING);
      expect(
        resolveTravelerTab(
          { status: "confirmed", checkout: "2026-08-09" },
          NOW,
        ),
      ).toBe(TRAVELER_TAB.PAST);
    });

    it("finalized with a future checkout is past", () => {
      expect(
        resolveTravelerTab(
          { status: "finalized", checkout: "2026-09-01" },
          NOW,
        ),
      ).toBe(TRAVELER_TAB.PAST);
    });

    it("cancelled goes to the cancelled tab", () => {
      expect(
        resolveTravelerTab(
          { status: "cancelled", checkout: "2026-09-01" },
          NOW,
        ),
      ).toBe(TRAVELER_TAB.CANCELLED);
    });
  });

  describe("isAbandonedPendingCheckout", () => {
    it("pending + pending past expiration_date is abandoned", () => {
      expect(
        isAbandonedPendingCheckout(
          {
            status: "pending",
            payment_status: "pending",
            expiration_date: new Date("2026-08-10T11:00:00.000Z"),
          },
          NOW,
        ),
      ).toBe(true);
    });

    it("pending before expiration_date or confirmed is not abandoned", () => {
      expect(
        isAbandonedPendingCheckout(
          {
            status: "pending",
            payment_status: "pending",
            expiration_date: new Date("2026-08-10T13:00:00.000Z"),
          },
          NOW,
        ),
      ).toBe(false);
      expect(
        isAbandonedPendingCheckout(
          {
            status: "confirmed",
            payment_status: "paid",
            expiration_date: new Date("2026-08-01T00:00:00.000Z"),
          },
          NOW,
        ),
      ).toBe(false);
    });
  });

  describe("label keys", () => {
    it("never exposes raw payment/refund enums", () => {
      const paymentKeys = PAYMENT_STATUSES.map(value =>
        mapPaymentLabelKey(value),
      );
      const refundKeys = REFUND_STATUSES.map(value => mapRefundLabelKey(value));
      for (const key of [...paymentKeys, ...refundKeys]) {
        expect(key.startsWith("cv_")).toBe(true);
      }
      expect(paymentKeys).not.toContain("processing");
      expect(paymentKeys).not.toContain("pending_charge");
      expect(mapPaymentLabelKey("processing")).toBe(
        TRAVELER_PAYMENT_LABEL.PENDING,
      );
      expect(mapPaymentLabelKey("pending_charge")).toBe(
        TRAVELER_PAYMENT_LABEL.PENDING,
      );
      expect(mapPaymentLabelKey("paid")).toBe("cv_pay_paid");
      expect(mapRefundLabelKey("pending")).toBe("cv_ref_pending");
      expect(mapRefundLabelKey("total_completed")).toBe("cv_ref_completed");
      expect(mapRefundLabelKey("partial_completed")).toBe("cv_ref_completed");
      expect(mapRefundLabelKey("failed")).toBe("cv_ref_failed");
    });
  });
});

describe("resolveTravelerPayability (pay-pending)", () => {
  const NOW = new Date("2099-01-10T12:00:00.000Z");
  const base = {
    status: "pending",
    payment_status: "pending",
    checkin: "2099-02-01",
    expiration_date: new Date("2099-01-10T13:00:00.000Z"),
  } as Pick<
    ReservationEntity,
    "status" | "payment_status" | "checkin" | "expiration_date"
  >;

  it("pending + payment pending + hold not expired -> payable until expiration", () => {
    expect(resolveTravelerPayability(base, NOW)).toEqual({
      can_pay: true,
      pay_expires_at: "2099-01-10T13:00:00.000Z",
    });
  });

  it("expired hold, past check-in or non-pending states are not payable", () => {
    const notPayable = { can_pay: false, pay_expires_at: null };
    expect(
      resolveTravelerPayability(
        { ...base, expiration_date: new Date("2099-01-10T11:59:59.000Z") },
        NOW,
      ),
    ).toEqual(notPayable);
    expect(
      resolveTravelerPayability({ ...base, expiration_date: NOW }, NOW),
    ).toEqual(notPayable);
    expect(
      resolveTravelerPayability({ ...base, checkin: "2099-01-09" }, NOW),
    ).toEqual(notPayable);
    expect(
      resolveTravelerPayability({ ...base, status: "cancelled" }, NOW),
    ).toEqual(notPayable);
    expect(
      resolveTravelerPayability(
        { ...base, status: "confirmed", payment_status: "paid" },
        NOW,
      ),
    ).toEqual(notPayable);
  });
});
