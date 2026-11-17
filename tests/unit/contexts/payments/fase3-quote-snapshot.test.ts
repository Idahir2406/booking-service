import type { PriceLineDraft } from "@/src/contexts/payments/domain/price-lines";
import type { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";

import { describe, expect, it } from "vitest";

import {
  CANCELLATION_POLICY_TYPE,
  type CancellationPolicyDefinition,
  cancellationPolicyFromColumns,
  CHARGE_MODE,
  NO_SHOW_POLICY,
  PENALTY_TYPE,
} from "@/src/contexts/payments/domain/cancellation-policy";
import {
  PLATFORM_SETTING_DEFAULTS,
  type PlatformSettings,
} from "@/src/contexts/payments/domain/platform-settings";
import { summarizePriceLines } from "@/src/contexts/payments/domain/price-lines";
import {
  buildRefundRule,
  buildReservationSnapshotPayload,
  CURRENT_REFUND_RULE,
  STRUCTURED_REFUND_RULE,
} from "@/src/contexts/payments/domain/reservation-snapshot";
import {
  freezeReservationFields,
  type FrozenTerms,
  quoteCancellationFromTerms,
  ReservationEconomicsService,
  snapshotCancellationTerms,
} from "@/src/contexts/payments/services/reservation-economics.service";
import { resolveTravelerCancellationQuote } from "@/src/contexts/reservations/utils/refund-policy.util";
import {
  buildChangedSnapshotPayload,
  type ChangeQuoteInput,
} from "@/src/contexts/reservations/utils/reservation-change.util";

const CHECKIN = "2026-06-20";
const CHECKOUT = "2026-06-23";
const TOTAL = 30_000;
/** 13/06/2026 18:00 Europe/Madrid (CEST). */
const DEADLINE = "2026-06-13T16:00:00.000Z";

const FREE: CancellationPolicyDefinition = {
  policy_type: CANCELLATION_POLICY_TYPE.FREE_CANCELLATION,
  deadline_days: 7,
  penalty_type: PENALTY_TYPE.PERCENT_50,
  no_show_policy: NO_SHOW_POLICY.SAME_AS_CANCELLATION,
  grace_after_booking_hours: null,
  early_cancellation_weeks: null,
};

const columns = (
  policy: CancellationPolicyDefinition | null,
  timezone: string | null = "Europe/Madrid",
) => ({
  site_id: 42,
  cancellation_policy_type: policy?.policy_type ?? null,
  cancellation_deadline_days: policy?.deadline_days ?? null,
  cancellation_penalty_type: policy?.penalty_type ?? null,
  no_show_policy: policy?.no_show_policy ?? null,
  grace_after_booking_hours: policy?.grace_after_booking_hours ?? null,
  early_cancellation_weeks: policy?.early_cancellation_weeks ?? null,
  timezone,
});

function economics(
  site: ReturnType<typeof columns> | null,
  settings: Partial<PlatformSettings> = {},
) {
  const all: PlatformSettings = { ...PLATFORM_SETTING_DEFAULTS, ...settings };
  return new ReservationEconomicsService(
    { getAll: () => Promise.resolve(all) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { findOne: () => Promise.resolve(site) } as never,
  );
}

const terms = (
  site: ReturnType<typeof columns> | null,
  now: string,
  settings: Partial<PlatformSettings> = {},
): Promise<FrozenTerms> =>
  economics(site, settings).resolveFrozenTerms({
    siteId: 42,
    checkin: CHECKIN,
    now: new Date(now),
  });

const lines: PriceLineDraft[] = [
  {
    type: "accommodation",
    description: "Alojamiento",
    quantity: 3,
    unit_amount_cents: 10_000,
    amount_cents: TOTAL,
    is_optional: false,
    is_commissionable: true,
    is_penalizable: true,
  },
];

function snapshotFor(
  frozen: FrozenTerms,
  chargeMode: ReservationEntity["charge_mode"],
) {
  return buildReservationSnapshotPayload({
    stay: {
      site_id: 42,
      checkin: CHECKIN,
      checkout: CHECKOUT,
      nights: 3,
      guests: 2,
      pets: 1,
    },
    room: null,
    board: null,
    currency: "eur",
    lines,
    totals: summarizePriceLines(lines),
    commissionRate: 0.12,
    commissionCents: 3600,
    timezone: frozen.timezone,
    deadlineLocalTime: frozen.deadlineLocalTime,
    source: "checkout",
    commissionBase: "commissionable",
    cancellation: snapshotCancellationTerms(frozen, {
      charge_mode: chargeMode,
      created_at: new Date(frozen.bookedAtIso ?? 0),
    }),
  });
}

describe("Fase 3 · frozen terms and charge plan", () => {
  it("site without policy (or no site_settings row): legacy terms, immediate", async () => {
    for (const site of [null, columns(null, null)]) {
      const frozen = await terms(site, "2026-06-01T10:00:00.000Z", {
        deferred_charge_enabled: true,
      });
      expect(frozen.cancellationPolicy).toBeNull();
      expect(frozen.chargePlan).toBeNull();
      expect(frozen.timezone).toBe("Europe/Madrid");
      expect(
        freezeReservationFields(frozen, {
          total_cents: TOTAL,
          commissionable_cents: TOTAL,
        }).charge_mode,
      ).toBe(CHARGE_MODE.IMMEDIATE);
      expect(quoteCancellationFromTerms(frozen, TOTAL)).toBeNull();
    }
  });

  it("without a stay the terms stay legacy even if the service has a repo", async () => {
    const frozen = await economics(columns(FREE)).resolveFrozenTerms();
    expect(frozen.cancellationPolicy).toBeNull();
    expect(frozen.chargePlan).toBeNull();
  });

  it("site timezone is frozen (Canarias)", async () => {
    const frozen = await terms(
      columns(FREE, "Atlantic/Canary"),
      "2026-06-01T10:00:00.000Z",
    );
    expect(frozen.timezone).toBe("Atlantic/Canary");
    expect(frozen.chargePlan?.deadline_iso).toBe("2026-06-13T17:00:00.000Z");
  });

  it("free cancellation, deferred charge OFF (default): immediate, charged now", async () => {
    const frozen = await terms(columns(FREE), "2026-06-01T10:00:00.000Z");
    expect(frozen.chargePlan).toMatchObject({
      charge_mode: CHARGE_MODE.IMMEDIATE,
      charge_at_iso: null,
      deadline_iso: DEADLINE,
      is_last_minute: false,
    });
    expect(
      freezeReservationFields(frozen, {
        total_cents: TOTAL,
        commissionable_cents: TOTAL,
      }).charge_mode,
    ).toBe(CHARGE_MODE.IMMEDIATE);
    expect(quoteCancellationFromTerms(frozen, TOTAL)).toEqual({
      policy_type: CANCELLATION_POLICY_TYPE.FREE_CANCELLATION,
      generated_text:
        "Cancelación gratuita hasta el 13/06/2026 a las 18:00 (hora de Madrid). Después se cobra el 50 % del importe total.",
      deadline_iso: DEADLINE,
      deadline_local: {
        date: "2026-06-13",
        time: "18:00",
        timezone: "Europe/Madrid",
      },
      timezone: "Europe/Madrid",
      charge_mode: CHARGE_MODE.IMMEDIATE,
      charge_at_iso: null,
      charge_now_cents: TOTAL,
      is_last_minute: false,
    });
  });

  it("free cancellation, deferred charge ON: flexible, nothing charged now", async () => {
    const frozen = await terms(columns(FREE), "2026-06-01T10:00:00.000Z", {
      deferred_charge_enabled: true,
    });
    expect(
      freezeReservationFields(frozen, {
        total_cents: TOTAL,
        commissionable_cents: TOTAL,
      }).charge_mode,
    ).toBe(CHARGE_MODE.FLEXIBLE);
    expect(quoteCancellationFromTerms(frozen, TOTAL)).toMatchObject({
      charge_mode: CHARGE_MODE.FLEXIBLE,
      charge_at_iso: DEADLINE,
      charge_now_cents: 0,
      is_last_minute: false,
    });
  });

  it("deferred ON but less than deferred_min_lead_hours to the deadline: immediate", async () => {
    const frozen = await terms(columns(FREE), "2026-06-12T10:00:00.000Z", {
      deferred_charge_enabled: true,
    });
    expect(quoteCancellationFromTerms(frozen, TOTAL)).toMatchObject({
      charge_mode: CHARGE_MODE.IMMEDIATE,
      charge_now_cents: TOTAL,
      is_last_minute: false,
    });
  });

  it("last minute (deadline passed): immediate and flagged", async () => {
    const frozen = await terms(columns(FREE), DEADLINE, {
      deferred_charge_enabled: true,
    });
    expect(quoteCancellationFromTerms(frozen, TOTAL)).toMatchObject({
      charge_mode: CHARGE_MODE.IMMEDIATE,
      charge_now_cents: TOTAL,
      is_last_minute: true,
      deadline_iso: DEADLINE,
    });
  });

  it("partial and non-refundable: immediate, no deadline", async () => {
    const partial = await terms(
      columns({
        ...FREE,
        policy_type: CANCELLATION_POLICY_TYPE.PARTIAL_FROM_BOOKING,
        deadline_days: null,
        penalty_type: PENALTY_TYPE.FIRST_NIGHT,
      }),
      "2026-06-01T10:00:00.000Z",
      { deferred_charge_enabled: true },
    );
    expect(quoteCancellationFromTerms(partial, TOTAL)).toMatchObject({
      policy_type: CANCELLATION_POLICY_TYPE.PARTIAL_FROM_BOOKING,
      generated_text:
        "Parcialmente reembolsable. Si cancelas después de reservar, se cobra el importe de la primera noche.",
      deadline_iso: null,
      deadline_local: null,
      charge_mode: CHARGE_MODE.IMMEDIATE,
      charge_now_cents: TOTAL,
    });
    const nonRef = await terms(
      columns({
        ...FREE,
        policy_type: CANCELLATION_POLICY_TYPE.NON_REFUNDABLE,
        deadline_days: null,
        penalty_type: PENALTY_TYPE.PERCENT_100,
        no_show_policy: NO_SHOW_POLICY.FULL_TOTAL,
      }),
      "2026-06-01T10:00:00.000Z",
    );
    expect(quoteCancellationFromTerms(nonRef, TOTAL)).toMatchObject({
      policy_type: CANCELLATION_POLICY_TYPE.NON_REFUNDABLE,
      charge_mode: CHARGE_MODE.IMMEDIATE,
      charge_now_cents: TOTAL,
      is_last_minute: false,
    });
  });

  it("invalid stored combination falls back to the legacy rule", () => {
    expect(
      cancellationPolicyFromColumns({
        ...columns(FREE),
        cancellation_deadline_days: 5,
      }),
    ).toBeNull();
    expect(
      cancellationPolicyFromColumns({
        ...columns(FREE),
        cancellation_penalty_type: "bogus",
      }),
    ).toBeNull();
  });
});

describe("Fase 3 · snapshot refund rule", () => {
  it("without policy the legacy rule is written exactly as before", async () => {
    const frozen = await terms(null, "2026-06-01T10:00:00.000Z");
    const payload = snapshotFor(frozen, "immediate");
    expect(payload.refund_policy).toEqual(
      buildRefundRule(CHECKIN, "18:00", "Europe/Madrid"),
    );
    expect(payload.refund_policy.rule).toBe(CURRENT_REFUND_RULE);
    expect(payload.refund_policy.cancellation).toBeUndefined();
  });

  it("free cancellation flexible: policy, text, deadline and charge plan frozen", async () => {
    const frozen = await terms(columns(FREE), "2026-06-01T10:00:00.000Z", {
      deferred_charge_enabled: true,
    });
    const payload = snapshotFor(frozen, "flexible");
    expect(payload.refund_policy).toEqual({
      rule: STRUCTURED_REFUND_RULE,
      window_hours: 168,
      refund_deadline: DEADLINE,
      deadline_local_time: "18:00",
      timezone: "Europe/Madrid",
      cancellation: FREE,
      generated_text:
        "Cancelación gratuita hasta el 13/06/2026 a las 18:00 (hora de Madrid). Después se cobra el 50 % del importe total.",
      deadline_local_date: "2026-06-13",
      charge_mode: CHARGE_MODE.FLEXIBLE,
      charge_at: DEADLINE,
      booked_at: "2026-06-01T10:00:00.000Z",
    });
    // Deep copy: the frozen policy never shares a reference with the terms.
    expect(payload.refund_policy.cancellation).not.toBe(
      frozen.cancellationPolicy,
    );
  });

  it("free cancellation with deferred charge off: immediate, no charge_at", async () => {
    const frozen = await terms(columns(FREE), "2026-06-01T10:00:00.000Z");
    const payload = snapshotFor(frozen, "immediate");
    expect(payload.refund_policy).toMatchObject({
      charge_mode: CHARGE_MODE.IMMEDIATE,
      charge_at: null,
      refund_deadline: DEADLINE,
    });
  });

  it("non-refundable: refund_deadline = booking instant; grace extends it", async () => {
    const nonRef: CancellationPolicyDefinition = {
      ...FREE,
      policy_type: CANCELLATION_POLICY_TYPE.NON_REFUNDABLE,
      deadline_days: null,
      penalty_type: PENALTY_TYPE.PERCENT_100,
      no_show_policy: NO_SHOW_POLICY.FULL_TOTAL,
    };
    const plain = snapshotFor(
      await terms(columns(nonRef), "2026-06-01T10:00:00.000Z"),
      "immediate",
    );
    expect(plain.refund_policy).toMatchObject({
      refund_deadline: "2026-06-01T10:00:00.000Z",
      deadline_local_date: null,
      window_hours: 0,
    });
    const withGrace = snapshotFor(
      await terms(
        columns({ ...nonRef, grace_after_booking_hours: 24 }),
        "2026-06-01T10:00:00.000Z",
      ),
      "immediate",
    );
    expect(withGrace.refund_policy.refund_deadline).toBe(
      "2026-06-02T10:00:00.000Z",
    );
  });
});

describe("Fase 3 · traveler quote uses the frozen 18:00 deadline", () => {
  const reservation = {
    id: 1,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    status: "confirmed",
    payment_status: "paid",
    payout_status: "held",
    total_cents: TOTAL,
    amount_refunded: null,
    created_at: new Date("2026-06-01T10:00:00.000Z"),
    timezone: "Europe/Madrid",
  } as unknown as ReservationEntity;

  it("17:59 free, 18:00 local already penalized", async () => {
    const frozen = await terms(columns(FREE), "2026-06-01T10:00:00.000Z");
    const payload = snapshotFor(frozen, "immediate");
    const at = (now: string) =>
      resolveTravelerCancellationQuote({
        reservation,
        snapshot: payload,
        reason: "change_of_plans",
        now: new Date(now),
      });
    expect(at("2026-06-13T15:59:00.000Z")).toMatchObject({
      within_free_period: true,
      refund_cents: TOTAL,
      deadline_iso: DEADLINE,
      source: "structured",
    });
    expect(at(DEADLINE)).toMatchObject({
      within_free_period: false,
      penalty_cents: 15_000,
      refund_cents: 15_000,
    });
    // 20:00 local of the deadline day: before Fase 3 this was still free.
    expect(at("2026-06-13T18:00:00.000Z").within_free_period).toBe(false);
  });
});

const changeQuote = (checkin: string, checkout: string): ChangeQuoteInput =>
  ({
    site_id: 42,
    room_id: 3,
    checkin,
    checkout,
    guests: 2,
    dogs: [],
    services: [],
    extras: [],
  }) as unknown as ChangeQuoteInput;

const change = (previous: ReturnType<typeof snapshotFor>, checkin: string) =>
  buildChangedSnapshotPayload({
    previous,
    reservation: {
      commission_rate: 0.12,
      commission_cents: 3600,
      timezone: "Atlantic/Canary",
      created_at: new Date("2026-06-01T10:00:00.000Z"),
    },
    quote: changeQuote(checkin, "2026-07-14"),
    nights: 3,
    pets: 1,
    room: null,
    board: null,
    lines,
    extension: {
      dogs: [],
      compatibility: { mode: "full", compatible: true, dogs_declared: true },
      dog_policy: null,
      services: [],
      extras: [],
      deposit: null,
      tourist_tax: null,
    },
    source: "change_accepted",
  });

describe("Fase 3 · change recomputes the deadline with the frozen policy", () => {
  it("structured: frozen policy/timezone/18:00 on the new check-in; charge mode untouched", async () => {
    const frozen = await terms(columns(FREE), "2026-06-01T10:00:00.000Z", {
      deferred_charge_enabled: true,
    });
    const previous = snapshotFor(frozen, "flexible");
    const next = change(previous, "2026-07-11");
    expect(next.refund_policy).toMatchObject({
      rule: STRUCTURED_REFUND_RULE,
      // 04/07/2026 18:00 Madrid (frozen timezone wins over the reservation's).
      refund_deadline: "2026-07-04T16:00:00.000Z",
      deadline_local_date: "2026-07-04",
      deadline_local_time: "18:00",
      timezone: "Europe/Madrid",
      cancellation: FREE,
      charge_mode: CHARGE_MODE.FLEXIBLE,
      charge_at: DEADLINE,
      booked_at: "2026-06-01T10:00:00.000Z",
    });
    expect(next.refund_policy.generated_text).toContain(
      "04/07/2026 a las 18:00 (hora de Madrid)",
    );
    // The previous payload is never mutated.
    expect(previous.refund_policy.refund_deadline).toBe(DEADLINE);
  });

  it("legacy: still the 24 h rule on the new check-in", async () => {
    const previous = snapshotFor(
      await terms(null, "2026-06-01T10:00:00.000Z"),
      "immediate",
    );
    const next = change(previous, "2026-07-11");
    expect(next.refund_policy).toEqual(
      buildRefundRule("2026-07-11", "18:00", "Europe/Madrid"),
    );
  });
});
