import type { ReservationSnapshotPayload } from "../../payments/domain/reservation-snapshot";
import type { ReservationEntity } from "../entities/reservation.entity";

import {
  type CancellationPolicyDefinition,
  type NoShowQuote,
  quoteCancellation,
  quoteNoShow,
} from "../../payments/domain/cancellation-policy";
import { PRICE_LINE_TYPE } from "../../payments/entities/reservation-price-line.entity";
import { expectedChargeCents } from "./reservation-amount.util";
import {
  getRefundDeadlineUtc,
  type ReservationPolicyInput,
} from "./reservation-policy.util";

/**
 * Traveler cancellation reasons (PDF catalogue, 13 codes) + `voluntary`, the
 * legacy generic code already stored in `reservations.cancel_reason` and
 * snapshots before F-PV4 (D-1). `voluntary` is still accepted by the API but
 * the UI offers `change_of_plans` instead. The reason never changes the
 * economics except `force_majeure` (manual review by V4P).
 */
export const TRAVELER_CANCELLATION_REASON = {
  CHANGE_OF_PLANS: "change_of_plans",
  ILLNESS_PERSON: "illness_person",
  ILLNESS_PET: "illness_pet",
  DEATH_PERSON: "death_person",
  DEATH_PET: "death_pet",
  TRANSPORT: "transport",
  FINANCIAL: "financial",
  OTHER_ACCOMMODATION: "other_accommodation",
  BOOKING_ERROR: "booking_error",
  ACCOMMODATION_CONDITIONS: "accommodation_conditions",
  DOG_CONDITIONS: "dog_conditions",
  FORCE_MAJEURE: "force_majeure",
  OTHER: "other",
  /** Legacy alias (D-1): accepted by the API, never offered in the UI. */
  VOLUNTARY: "voluntary",
} as const;

export type TravelerCancellationReason =
  (typeof TRAVELER_CANCELLATION_REASON)[keyof typeof TRAVELER_CANCELLATION_REASON];

export const TRAVELER_CANCELLATION_REASONS: readonly TravelerCancellationReason[] =
  Object.values(TRAVELER_CANCELLATION_REASON);

/** Reasons the UI offers (all but the legacy `voluntary` alias). */
export const TRAVELER_CANCELLATION_UI_REASONS: readonly TravelerCancellationReason[] =
  TRAVELER_CANCELLATION_REASONS.filter(
    reason => reason !== TRAVELER_CANCELLATION_REASON.VOLUNTARY,
  );

export const REASONS_REQUIRING_NOTES: readonly TravelerCancellationReason[] = [
  TRAVELER_CANCELLATION_REASON.OTHER,
  TRAVELER_CANCELLATION_REASON.FORCE_MAJEURE,
];

export const CANCELLATION_NOTES_MIN_LENGTH = 10;
export const CANCELLATION_NOTES_MAX_LENGTH = 1000;

export function isTravelerCancellationReason(
  value: string,
): value is TravelerCancellationReason {
  return (TRAVELER_CANCELLATION_REASONS as readonly string[]).includes(value);
}

export function reasonRequiresNotes(reason: string): boolean {
  return (REASONS_REQUIRING_NOTES as readonly string[]).includes(reason);
}

export function resolveSnapshotRefundDeadlineIso(
  snapshot: ReservationSnapshotPayload | null,
  reservation: Pick<ReservationEntity, "checkin">,
): string {
  const fromSnapshot = snapshot?.refund_policy.refund_deadline;
  if (fromSnapshot) {
    return fromSnapshot;
  }
  return getRefundDeadlineUtc(reservation.checkin).toISOString();
}

/** Refund window from the frozen snapshot (not live host policy). */
export function isWithinSnapshotRefundWindow(
  snapshot: ReservationSnapshotPayload | null,
  reservation: Pick<ReservationEntity, "checkin">,
  now: Date = new Date(),
): boolean {
  const deadlineIso = resolveSnapshotRefundDeadlineIso(snapshot, reservation);
  const deadlineMs = new Date(deadlineIso).getTime();
  if (!Number.isFinite(deadlineMs)) {
    return false;
  }
  return now.getTime() <= deadlineMs;
}

/**
 * Amount the traveler gets back on cancel. Delegates to the single quote
 * resolver so preview and execution never diverge (D-3).
 */
export function resolveTravelerRefundAmountCents(
  reservation: ReservationEntity,
  snapshot: ReservationSnapshotPayload | null,
  reason: TravelerCancellationReason = TRAVELER_CANCELLATION_REASON.VOLUNTARY,
  now: Date = new Date(),
): number {
  return resolveTravelerCancellationQuote({
    reservation,
    snapshot,
    reason,
    now,
  }).refund_cents;
}

export interface TravelerCancelPolicyOptions {
  /**
   * F-PV7b: the row is partially_refunded ONLY because of accepted-change
   * adjustment refunds (isPartiallyRefundedByChangeOnly). It is then treated
   * as confirmed+paid; any other partial refund still blocks the cancel.
   */
  partialRefundFromChange?: boolean;
}

export function travelerPolicyAllowsCancel(
  reservation: ReservationPolicyInput,
  now: Date = new Date(),
  options: TravelerCancelPolicyOptions = {},
): boolean {
  if (
    reservation.status === "cancelled" ||
    reservation.status === "finalized"
  ) {
    return false;
  }
  if (reservation.status === "pending") {
    return reservation.payment_status === "pending";
  }
  if (reservation.status !== "confirmed") {
    return false;
  }
  const paidLike =
    reservation.payment_status === "paid" ||
    (reservation.payment_status === "partially_refunded" &&
      options.partialRefundFromChange === true);
  if (!paidLike) {
    return false;
  }
  if (reservation.payout_status === "blocked") {
    return false;
  }
  const checkoutStart = new Date(
    `${reservation.checkout.slice(0, 10)}T00:00:00.000Z`,
  );
  return now.getTime() < checkoutStart.getTime();
}

export const CANCELLATION_QUOTE_SOURCE = {
  STRUCTURED: "structured",
  LEGACY_24H: "legacy_24h",
} as const;

export type CancellationQuoteSource =
  (typeof CANCELLATION_QUOTE_SOURCE)[keyof typeof CANCELLATION_QUOTE_SOURCE];

export interface TravelerCancellationQuote {
  can_cancel: boolean;
  /** Charged minus already refunded (0 for an unpaid pending row). */
  paid_cents: number;
  penalty_cents: number;
  refund_cents: number;
  within_free_period: boolean;
  deadline_iso: string | null;
  /** Frozen policy text from the snapshot; null on legacy rows. */
  policy_text: string | null;
  releases_inventory: boolean;
  /** force_majeure: refund_cents is informative until V4P reviews it. */
  requires_review: boolean;
  source: CancellationQuoteSource;
}

export interface TravelerCancellationQuoteInput {
  reservation: ReservationEntity;
  snapshot: ReservationSnapshotPayload | null;
  reason: TravelerCancellationReason;
  now?: Date;
  /** See TravelerCancelPolicyOptions.partialRefundFromChange. */
  partial_refund_from_change?: boolean;
}

const DEFAULT_TIMEZONE = "Europe/Madrid";

/** Price of one night from the frozen accommodation line (0 if absent). */
export function firstNightCentsFromSnapshot(
  snapshot: ReservationSnapshotPayload,
): number {
  const line = snapshot.price_lines.find(
    item => item.type === PRICE_LINE_TYPE.ACCOMMODATION,
  );
  if (!line) {
    return 0;
  }
  const unit = Number(line.unit_amount_cents);
  if (Number.isFinite(unit) && unit > 0) {
    return Math.round(unit);
  }
  const quantity = Number(line.quantity);
  const amount = Number(line.amount_cents);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }
  return quantity > 0 ? Math.round(amount / quantity) : Math.round(amount);
}

function structuredPolicy(
  snapshot: ReservationSnapshotPayload | null,
): CancellationPolicyDefinition | null {
  return snapshot?.refund_policy.cancellation ?? null;
}

export interface ReservationNoShowQuote extends NoShowQuote {
  /** Remaining paid amount (charged − already refunded) the quote applies to. */
  paid_cents: number;
}

/**
 * No-show (punto 6) on the frozen policy of the reservation. Base is the
 * remaining paid amount, so a refund never exceeds what is left on the
 * PaymentIntent. Pure: the admino preview and the confirmation share it.
 */
export function resolveNoShowQuote(
  reservation: ReservationEntity,
  snapshot: ReservationSnapshotPayload | null,
): ReservationNoShowQuote {
  const paidCents = remainingPaidCents(reservation);
  const quote = quoteNoShow(
    structuredPolicy(snapshot),
    paidCents,
    snapshot ? firstNightCentsFromSnapshot(snapshot) : 0,
  );
  return { ...quote, paid_cents: paidCents };
}

/** Refundable base: charged minus everything already refunded (>= 0). */
function remainingPaidCents(reservation: ReservationEntity): number {
  const alreadyRefunded = Math.round(
    Number(reservation.amount_refunded ?? 0) * 100,
  );
  return Math.max(0, expectedChargeCents(reservation) - alreadyRefunded);
}

/**
 * Single pure resolver for the traveler cancellation (D-3): the preview
 * endpoint and cancelByTraveler both call it, so the previewed refund is
 * the executed refund to the cent. No I/O, no side effects.
 *
 * - `refund_policy.cancellation` frozen in the snapshot → quoteCancellation.
 * - Absent (every reservation today) → legacy 24 h rule: full remaining
 *   charge inside the snapshot window, 0 after it.
 * - force_majeure → requires_review, refund informative (= remaining paid).
 * - Unpaid pending → nothing paid, nothing refunded.
 *
 * Refundable base (`paid_cents`) is ALWAYS charged − already refunded, so a
 * refund never exceeds what is left on the PaymentIntent.
 *
 * F-PV7b, row partially refunded only by accepted-change adjustments:
 * - legacy 24 h: inside the window → the full remaining amount; after → 0.
 * - structured: the penalty is computed on the CURRENT price (total_cents
 *   of the frozen snapshot version, i.e. the post-change v2 price, and its
 *   first night), refund = min(current price − penalty, remaining) and
 *   penalty_cents = remaining − refund (paid = penalty + refund holds).
 * Any other row keeps the penalty on the remaining amount (unchanged).
 */
export function resolveTravelerCancellationQuote(
  input: TravelerCancellationQuoteInput,
): TravelerCancellationQuote {
  const { reservation, snapshot, reason } = input;
  const now = input.now ?? new Date();
  const fromChange = input.partial_refund_from_change === true;
  const canCancel = travelerPolicyAllowsCancel(reservation, now, {
    partialRefundFromChange: fromChange,
  });
  const policy = structuredPolicy(snapshot);
  const source = policy
    ? CANCELLATION_QUOTE_SOURCE.STRUCTURED
    : CANCELLATION_QUOTE_SOURCE.LEGACY_24H;
  const frozenText = snapshot?.refund_policy.generated_text ?? null;

  if (reservation.status === "pending") {
    return {
      can_cancel: canCancel,
      paid_cents: 0,
      penalty_cents: 0,
      refund_cents: 0,
      within_free_period: true,
      deadline_iso: null,
      policy_text: frozenText,
      releases_inventory: canCancel,
      requires_review: false,
      source,
    };
  }

  const paidCents = remainingPaidCents(reservation);
  const isForceMajeure = reason === TRAVELER_CANCELLATION_REASON.FORCE_MAJEURE;

  let withinFree: boolean;
  let deadlineIso: string | null;
  let penaltyCents: number;
  let refundCents: number;
  let policyText: string | null = frozenText;

  if (policy && snapshot) {
    const snapshotTotal = Math.round(Number(snapshot.total_cents));
    const priceBaseCents =
      fromChange && Number.isFinite(snapshotTotal) && snapshotTotal > 0
        ? snapshotTotal
        : paidCents;
    const quote = quoteCancellation({
      policy,
      checkin: snapshot.stay.checkin,
      timezone:
        snapshot.timezone ??
        snapshot.refund_policy.timezone ??
        reservation.timezone ??
        DEFAULT_TIMEZONE,
      paid_cents: priceBaseCents,
      first_night_cents: firstNightCentsFromSnapshot(snapshot),
      booked_at: reservation.created_at,
      now,
    });
    withinFree = quote.within_free_period;
    deadlineIso = quote.deadline_iso;
    refundCents = Math.min(Math.max(0, quote.refund_cents), paidCents);
    penaltyCents = paidCents - refundCents;
    policyText = frozenText ?? quote.generated_text;
  } else {
    withinFree = isWithinSnapshotRefundWindow(snapshot, reservation, now);
    deadlineIso = resolveSnapshotRefundDeadlineIso(snapshot, reservation);
    refundCents = withinFree ? paidCents : 0;
    penaltyCents = paidCents - refundCents;
  }

  if (isForceMajeure) {
    // Informative: the full remaining amount can be requested; V4P decides.
    penaltyCents = 0;
    refundCents = paidCents;
  }

  return {
    can_cancel: canCancel,
    paid_cents: paidCents,
    penalty_cents: penaltyCents,
    refund_cents: refundCents,
    within_free_period: withinFree,
    deadline_iso: deadlineIso,
    policy_text: policyText,
    releases_inventory: canCancel,
    requires_review: isForceMajeure,
    source,
  };
}
