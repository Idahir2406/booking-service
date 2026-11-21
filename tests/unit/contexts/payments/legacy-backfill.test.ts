import {
  type LegacyReservationRow,
  planLegacyBackfill,
} from "@/src/contexts/payments/domain/legacy-backfill";
import { parsePlatformSettings } from "@/src/contexts/payments/domain/platform-settings";

const DEFAULTS = {
  commissionRate: 0.1,
  currency: "eur",
  timezone: "Europe/Madrid",
  deadlineLocalTime: "18:00",
};

const legacy = (
  overrides: Partial<LegacyReservationRow> = {},
): LegacyReservationRow => ({
  id: 9,
  site_id: 42,
  room_id: 3,
  source: "internal",
  checkin: "2026-03-28",
  checkout: "2026-03-30",
  guests: 2,
  pets: 1,
  subtotal: "200.00",
  commission: "0.00",
  total: "200.00",
  status: "confirmed",
  payment_status: "paid",
  stripe_checkout_session_id: "cs_1",
  stripe_payment_intent_id: "pi_1",
  paid_at: new Date("2026-03-01T10:00:00.000Z"),
  created_at: new Date("2026-03-01T09:00:00.000Z"),
  ...overrides,
});

describe("legacy backfill mapping (pure)", () => {
  it("paid reservation -> accommodation line, paid payment, snapshot v1, env commission", () => {
    const plan = planLegacyBackfill(legacy(), DEFAULTS);

    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]).toMatchObject({
      type: "accommodation",
      amount_cents: 20_000,
      is_commissionable: true,
      is_penalizable: true,
    });
    expect(plan.payment).toMatchObject({
      status: "paid",
      amount_cents: 20_000,
      idempotency_key: "payment:legacy:9",
      stripe_payment_intent_id: "pi_1",
    });
    expect(plan.refund).toBeNull();
    expect(plan.reservation).toEqual({
      commission_rate: 0.1,
      commission_cents: 2000,
      total_cents: 20_000,
      currency: "eur",
      timezone: "Europe/Madrid",
      snapshot_version: 1,
    });
    expect(plan.snapshot).toMatchObject({
      source: "legacy_backfill",
      total_cents: 20_000,
      stay: { checkin: "2026-03-28", checkout: "2026-03-30", nights: 2 },
      commission: { rate: 0.1, cents: 2000 },
    });
  });

  it("maps pending/cancelled/refunded states", () => {
    expect(
      planLegacyBackfill(
        legacy({ status: "pending", payment_status: "pending" }),
        DEFAULTS,
      ).payment?.status,
    ).toBe("pending_charge");

    const expired = planLegacyBackfill(
      legacy({
        status: "cancelled",
        payment_status: "pending",
        cancel_reason: "expired",
      }),
      DEFAULTS,
    );
    expect(expired.payment).toMatchObject({
      status: "failed",
      failure_code: "legacy:expired",
      paid_at: null,
    });

    const refunded = planLegacyBackfill(
      legacy({
        status: "cancelled",
        payment_status: "refunded",
        amount_refunded: null,
        stripe_refund_id: "re_1",
      }),
      DEFAULTS,
    );
    expect(refunded.payment?.status).toBe("paid");
    expect(refunded.refund).toMatchObject({
      status: "total_completed",
      amount_cents: 20_000,
      stripe_refund_id: "re_1",
      idempotency_key: "refund:legacy:9",
    });

    const partial = planLegacyBackfill(
      legacy({
        payment_status: "partially_refunded",
        amount_refunded: "50.00",
      }),
      DEFAULTS,
    );
    expect(partial.refund).toMatchObject({
      status: "partial_completed",
      amount_cents: 5000,
    });
  });

  it("uses subtotal + commission when total is missing, and skips payments for external sources", () => {
    const manual = planLegacyBackfill(
      legacy({ total: null, subtotal: "150.50", commission: "0" }),
      DEFAULTS,
    );
    expect(manual.reservation.total_cents).toBe(15_050);
    expect(manual.reservation.commission_cents).toBe(1505);

    expect(
      planLegacyBackfill(legacy({ source: "airbnb" }), DEFAULTS).payment,
    ).toBeNull();
  });

  it("is deterministic (same input -> same plan), so re-running is safe", () => {
    expect(planLegacyBackfill(legacy(), DEFAULTS)).toEqual(
      planLegacyBackfill(legacy(), DEFAULTS),
    );
  });
});

describe("platform settings parsing", () => {
  it("uses defaults and typed values, rejecting invalid rows", () => {
    const invalid: string[] = [];
    const settings = parsePlatformSettings(
      [
        { key: "commission_rate", value: "0.15" },
        { key: "deadline_local_time", value: "25:00" },
        { key: "default_timezone", value: "Mars/Olympus" },
        { key: "regularization_window_hours", value: "6" },
        { key: "unknown_key", value: "x" },
      ],
      key => invalid.push(key),
    );
    expect(settings).toEqual({
      commission_rate: 0.15,
      deadline_local_time: "18:00",
      default_timezone: "Europe/Madrid",
      available_after_checkout_hours: 24,
      regularization_window_hours: 6,
      payout_failure_days: 7,
      deferred_charge_enabled: false,
      deferred_min_lead_hours: 48,
      provider_markup_rate: 0.15,
    });
    expect(invalid).toEqual(["deadline_local_time", "default_timezone"]);
  });
});
