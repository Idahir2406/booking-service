import type { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";

import { summarizePriceLines } from "@/src/contexts/payments/domain/price-lines";
import { buildReservationSnapshotPayload } from "@/src/contexts/payments/domain/reservation-snapshot";
import { InvalidTransitionError } from "@/src/contexts/payments/domain/state-machine";
import {
  buildChangedSnapshotPayload,
  buildChangeQuoteInput,
  CHANGE_OFFER_STATUS,
  CHANGE_REQUEST_STATUS,
  changeOfferStateMachine,
  changeRequestStateMachine,
  effectiveOfferStatus,
  isChangeEligibleReservation,
  resolveOfferExpiry,
  summarizeSnapshotForTraveler,
} from "@/src/contexts/reservations/utils/reservation-change.util";

const NOW = new Date("2099-07-01T10:00:00.000Z");

const lines = [
  {
    type: "accommodation" as const,
    description: "Alojamiento",
    quantity: 2,
    unit_amount_cents: 10_000,
    amount_cents: 20_000,
    is_optional: false,
    is_commissionable: true,
    is_penalizable: true,
  },
];

const snapshot = () => {
  const payload = buildReservationSnapshotPayload({
    stay: { site_id: 42, checkin: "2099-08-10", checkout: "2099-08-12", nights: 2, guests: 2, pets: 1 },
    room: { id: 3, name: "Suite", max_guests: 4, max_pets: 2, price_per_night_cents: 10_000 },
    board: null,
    currency: "eur",
    lines,
    totals: summarizePriceLines(lines),
    commissionRate: 0.12,
    commissionCents: 2400,
    timezone: "Europe/Madrid",
    deadlineLocalTime: "18:00",
    source: "checkout",
    extension: {
      dogs: [
        { index: 0, name: "Luna", weight_kg: 12, is_ppp: false, room_id: 3, size: null, saved_dog_id: 7 },
      ],
      compatibility: { mode: "full", compatible: true, dogs_declared: true },
      dog_policy: null,
      services: [
        { type: "dog_supply", id: 5, name: "Cama", pricing_mode: "per_stay", price_cents: 1000, quantity: 1, amount_cents: 1000 },
      ],
      extras: [{ id: 8, name: "Cuna", pricing_mode: "per_stay", price_cents: 500, amount_cents: 500 }],
      deposit: null,
      tourist_tax: null,
    },
  });
  payload.refund_policy.generated_text = "Cancelación gratuita hasta 7 días antes";
  return payload;
};

const reservation = (patch: Partial<ReservationEntity> = {}) =>
  ({
    status: "confirmed",
    payment_status: "paid",
    checkin: "2099-08-10",
    site_id: 42,
    room_id: 3,
    board_option_id: undefined,
    ...patch,
  }) as ReservationEntity;

describe("reservation-change.util (F-PV7b)", () => {
  it("request state machine: open -> closed only through allowed moves", () => {
    const S = CHANGE_REQUEST_STATUS;
    expect(changeRequestStateMachine.canTransition(S.RECEIVED, S.PROPOSAL_SENT)).toBe(true);
    expect(changeRequestStateMachine.canTransition(S.PROPOSAL_SENT, S.IN_REVIEW)).toBe(true);
    expect(changeRequestStateMachine.canTransition(S.PROPOSAL_SENT, S.ACCEPTED)).toBe(true);
    expect(changeRequestStateMachine.canTransition(S.RECEIVED, S.ACCEPTED)).toBe(false);
    expect(() => changeRequestStateMachine.assertTransition(S.CANCELLED, S.IN_REVIEW)).toThrow(InvalidTransitionError);
    expect(changeRequestStateMachine.isTerminal(S.ACCEPTED)).toBe(true);
    expect(changeRequestStateMachine.isTerminal(S.REJECTED)).toBe(true);
  });

  it("offer state machine: pending is the only non-final state", () => {
    const O = CHANGE_OFFER_STATUS;
    for (const to of [O.ACCEPTED, O.REJECTED, O.EXPIRED]) {
      expect(changeOfferStateMachine.canTransition(O.PENDING_TRAVELER, to)).toBe(true);
      expect(changeOfferStateMachine.isTerminal(to)).toBe(true);
    }
    expect(() => changeOfferStateMachine.assertTransition(O.EXPIRED, O.ACCEPTED)).toThrow(InvalidTransitionError);
  });

  it("eligibility: upcoming confirmed + paid (or partially refunded) only", () => {
    expect(isChangeEligibleReservation(reservation(), NOW)).toBe(true);
    expect(isChangeEligibleReservation(reservation({ payment_status: "partially_refunded" }), NOW)).toBe(true);
    expect(isChangeEligibleReservation(reservation({ status: "cancelled" }), NOW)).toBe(false);
    expect(isChangeEligibleReservation(reservation({ status: "finalized" }), NOW)).toBe(false);
    expect(isChangeEligibleReservation(reservation({ status: "pending", payment_status: "pending" }), NOW)).toBe(false);
    expect(isChangeEligibleReservation(reservation({ payment_status: "refunded" }), NOW)).toBe(false);
    expect(isChangeEligibleReservation(reservation({ checkin: "2099-07-01" }), NOW)).toBe(false);
    expect(isChangeEligibleReservation(reservation({ checkin: "2099-07-02" }), NOW)).toBe(true);
  });

  it("effective status: pending past expires_at is expired; closed states unchanged", () => {
    const later = new Date(NOW.getTime() + 1000);
    expect(effectiveOfferStatus({ status: "pending_traveler", expires_at: later }, NOW)).toBe("pending_traveler");
    expect(effectiveOfferStatus({ status: "pending_traveler", expires_at: NOW }, NOW)).toBe("expired");
    expect(effectiveOfferStatus({ status: "rejected", expires_at: NOW }, NOW)).toBe("rejected");
  });

  it("expiry is capped at the check-in and null when no time is left", () => {
    expect(resolveOfferExpiry(NOW, 72, "2099-08-10")?.toISOString()).toBe("2099-07-04T10:00:00.000Z");
    expect(resolveOfferExpiry(NOW, 72, "2099-07-02")?.toISOString()).toBe("2099-07-02T00:00:00.000Z");
    expect(resolveOfferExpiry(NOW, 72, "2099-07-01")).toBeNull();
  });

  it("quote input copies the snapshot; another unit keeps dogs but drops unit-bound data", () => {
    const same = buildChangeQuoteInput(reservation(), snapshot(), { checkout: "2099-08-13" });
    expect(same).toMatchObject({
      site_id: 42,
      room_id: 3,
      checkin: "2099-08-10",
      checkout: "2099-08-13",
      guests: 2,
      dogs: [{ name: "Luna", weight_kg: 12, is_ppp: false, room_id: 3, saved_dog_id: 7 }],
      services: [{ type: "dog_supply", id: 5, quantity: 1 }],
      extras: [{ id: 8 }],
    });
    const other = buildChangeQuoteInput(reservation(), snapshot(), { site_id: 77, room_id: 9 });
    expect(other.dogs[0].room_id).toBeUndefined();
    expect(other.extras).toEqual([]);
    expect(other.board_option_id).toBeUndefined();
  });

  it("changed snapshot keeps frozen cancellation terms and commission, recomputes the deadline", () => {
    const previous = snapshot();
    const quote = buildChangeQuoteInput(reservation(), previous, { checkin: "2099-08-11", checkout: "2099-08-13" });
    const next = buildChangedSnapshotPayload({
      previous,
      reservation: { commission_rate: 0.12, commission_cents: 2400, timezone: "Europe/Madrid" },
      quote,
      nights: 2,
      pets: 1,
      room: previous.room,
      board: null,
      lines,
      extension: { dogs: [], compatibility: { mode: "full", compatible: true, dogs_declared: true }, dog_policy: null, services: [], extras: [], deposit: null, tourist_tax: null },
      source: "change_accepted",
    });
    expect(next.stay).toMatchObject({ checkin: "2099-08-11", checkout: "2099-08-13" });
    expect(next.refund_policy.generated_text).toBe("Cancelación gratuita hasta 7 días antes");
    expect(next.refund_policy.refund_deadline).not.toBe(previous.refund_policy.refund_deadline);
    expect(next.commission).toMatchObject({ rate: 0.12, cents: 2400 });
    expect(next.source).toBe("change_accepted");
    // The previous payload object is never mutated.
    expect(previous.stay.checkin).toBe("2099-08-10");
  });

  it("summary for the before/after table has no enums nor ids of payments", () => {
    const summary = summarizeSnapshotForTraveler(snapshot(), "Casa Luna");
    expect(summary).toMatchObject({
      site_name: "Casa Luna",
      room_name: "Suite",
      nights: 2,
      dogs_count: 1,
      services: [{ name: "Cama", quantity: 1, amount_cents: 1000 }],
      extras: [{ name: "Cuna", amount_cents: 500 }],
      total_cents: 20_000,
    });
    expect(summary.dog_conditions?.compatible).toBe(true);
  });
});
