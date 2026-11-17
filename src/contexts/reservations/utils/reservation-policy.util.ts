import { localTimeUtcIso } from "../../payments/domain/cancellation-policy";

export const REFUND_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Fallback when a reservation has no timezone (legacy rows). */
export const FINALIZE_DEFAULT_TIMEZONE = "Europe/Madrid";

/**
 * "Finalizar estancia" closes a stay that already ended (it is NOT a
 * cancellation): it starts the feedback window and, after it, the host
 * payout. If the host does not finalize, the system does it this many hours
 * after the finalize moment (so the payout is never stuck).
 */
export const AUTO_FINALIZE_AFTER_HOURS = 48;

export interface ReservationPolicyInput {
  status: string;
  payment_status: string;
  /** Fase 4: flexible + unpaid confirmed reservations can be cancelled. */
  charge_mode?: string | null;
  payout_status?: string | null;
  checkin: string;
  checkout: string;
  /** IANA timezone of the accommodation (reservations.timezone). */
  timezone?: string | null;
  /**
   * Local check-out time "HH:MM" frozen for this reservation (snapshot
   * schedule). Missing = 00:00 local of the check-out day.
   */
  checkout_until?: string | null;
}

export interface ReservationInventoryHoldInput {
  status: string;
  payment_status: string;
  charge_mode?: string | null;
  expiration_date?: Date | string | null;
}

export interface DeferredChargeStateInput {
  status: string;
  payment_status: string;
  charge_mode?: string | null;
}

/** Fase 4: a pending flexible reservation saves the card (Checkout setup mode). */
export function isSetupCheckout(
  reservation: Pick<DeferredChargeStateInput, "status" | "charge_mode">,
): boolean {
  return (
    reservation.status === "pending" && reservation.charge_mode === "flexible"
  );
}

/**
 * Fase 4: confirmed flexible reservation whose deferred charge is still
 * unpaid (card saved, charge not yet due, in flight or in regularization).
 */
export function isDeferredUnpaid(
  reservation: DeferredChargeStateInput,
): boolean {
  return (
    reservation.status === "confirmed" &&
    reservation.charge_mode === "flexible" &&
    reservation.payment_status === "pending"
  );
}

/**
 * Whether a reservation still blocks inventory / calendar dates.
 * - confirmed / finalized: always — including a confirmed `flexible`
 *   reservation whose deferred charge is still unpaid (Fase 4: the setup
 *   session confirmed it and claimed the nights)
 * - paid (any non-cancelled flow): always, expiration ignored
 * - pending unpaid: never (neither immediate nor flexible checkout holds
 *   nights before Stripe confirms the payment / the saved card)
 * - cancelled: never
 */
export function isReservationBlockingInventory(
  reservation: ReservationInventoryHoldInput,
  now: Date = new Date(),
): boolean {
  // Clock kept in the signature (callers pass it); not needed by the rule.
  void now;
  const status = String(reservation.status || "").toLowerCase();
  const paymentStatus = String(reservation.payment_status || "").toLowerCase();

  if (status === "cancelled") {
    return false;
  }

  if (paymentStatus === "paid") {
    return true;
  }

  if (status === "confirmed" || status === "finalized") {
    return true;
  }

  return false;
}

export interface ReservationPolicyCapabilities {
  can_cancel: boolean;
  can_refund: boolean;
  can_finalize: boolean;
  /** Punto 6: host may report "No se presentó" (from check-in, payout not blocked). */
  can_report_no_show: boolean;
  refund_deadline: string;
  /** ISO instant from which the host can finalize the stay. */
  finalize_available_from: string;
}

export function parseIsoDateAtUtcMidnight(isoDate: string): Date {
  return new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
}

export function formatUtcIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getCheckinStartUtc(checkin: string): Date {
  return parseIsoDateAtUtcMidnight(checkin);
}

export function getCheckoutStartUtc(checkout: string): Date {
  return parseIsoDateAtUtcMidnight(checkout);
}

const LOCAL_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Instant from which the stay can be finalized: the check-out day at the
 * accommodation's check-out time (default 00:00) in its local timezone.
 * Never before check-out: finalizing starts the payout to the host, so a
 * guest who is still staying must not be "finalized".
 */
export function getFinalizeAvailableFromUtc(
  checkout: string,
  timezone?: string | null,
  checkoutUntil?: string | null,
): Date {
  const [year, month, day] = checkout.slice(0, 10).split("-").map(Number);
  const localTime =
    checkoutUntil && LOCAL_TIME_RE.test(checkoutUntil.slice(0, 5))
      ? checkoutUntil.slice(0, 5)
      : "00:00";
  try {
    return new Date(
      localTimeUtcIso(
        year,
        month,
        day,
        localTime,
        timezone?.trim() ? timezone : FINALIZE_DEFAULT_TIMEZONE,
      ),
    );
  } catch {
    // Unknown timezone or malformed date: fall back to 00:00 UTC.
    return getCheckoutStartUtc(checkout);
  }
}

/** Instant after which the system finalizes the stay on its own. */
export function getAutoFinalizeAtUtc(
  checkout: string,
  timezone?: string | null,
  checkoutUntil?: string | null,
): Date {
  return new Date(
    getFinalizeAvailableFromUtc(checkout, timezone, checkoutUntil).getTime() +
      AUTO_FINALIZE_AFTER_HOURS * 60 * 60 * 1000,
  );
}

export function getRefundDeadlineUtc(checkin: string): Date {
  return new Date(getCheckinStartUtc(checkin).getTime() - REFUND_WINDOW_MS);
}

export function computeReservationPolicyCapabilities(
  reservation: ReservationPolicyInput,
  now: Date = new Date(),
): ReservationPolicyCapabilities {
  const checkinStart = getCheckinStartUtc(reservation.checkin);
  const checkoutStart = getCheckoutStartUtc(reservation.checkout);
  const refundDeadline = getRefundDeadlineUtc(reservation.checkin);
  const refundDeadlineIso = refundDeadline.toISOString();
  const finalizeFrom = getFinalizeAvailableFromUtc(
    reservation.checkout,
    reservation.timezone,
    reservation.checkout_until,
  );
  const finalizeFromIso = finalizeFrom.toISOString();
  const nowMs = now.getTime();
  const payoutBlocked = reservation.payout_status === "blocked";

  if (
    reservation.status === "cancelled" ||
    reservation.status === "finalized"
  ) {
    return {
      can_cancel: false,
      can_refund: false,
      can_finalize: false,
      can_report_no_show: false,
      refund_deadline: refundDeadlineIso,
      finalize_available_from: finalizeFromIso,
    };
  }

  if (reservation.status === "pending") {
    return {
      can_cancel: !payoutBlocked,
      can_refund: false,
      can_finalize: false,
      can_report_no_show: false,
      refund_deadline: refundDeadlineIso,
      finalize_available_from: finalizeFromIso,
    };
  }

  if (reservation.status === "confirmed") {
    const isPaid = reservation.payment_status === "paid";
    const payoutReleased = reservation.payout_status === "released";
    const beforeCheckout = nowMs < checkoutStart.getTime();
    const fromCheckin = nowMs >= checkinStart.getTime();

    return {
      can_cancel: isPaid && !payoutBlocked && beforeCheckout,
      can_refund:
        isPaid &&
        !payoutReleased &&
        !payoutBlocked &&
        nowMs <= refundDeadline.getTime(),
      can_finalize: isPaid && !payoutBlocked && nowMs >= finalizeFrom.getTime(),
      can_report_no_show:
        (isPaid || reservation.payment_status === "partially_refunded") &&
        !payoutBlocked &&
        !payoutReleased &&
        fromCheckin,
      refund_deadline: refundDeadlineIso,
      finalize_available_from: finalizeFromIso,
    };
  }

  return {
    can_cancel: false,
    can_refund: false,
    can_finalize: false,
    can_report_no_show: false,
    refund_deadline: refundDeadlineIso,
    finalize_available_from: finalizeFromIso,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Nights between two ISO dates using pure UTC math. Local-time parsing
 * (`new Date("YYYY-MM-DDT00:00:00")`) loses/gains one hour across DST
 * transitions, so a 2-night stay over the spring-forward weekend computed
 * as 47h / 24h = 1 night.
 */
export function calcNightsUtc(checkin: string, checkout: string): number {
  const start = parseIsoDateAtUtcMidnight(checkin).getTime();
  const end = parseIsoDateAtUtcMidnight(checkout).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return 0;
  }
  return Math.round((end - start) / DAY_MS);
}

/** Night dates (YYYY-MM-DD) in [checkin, checkout), generated with UTC math (DST-safe). */
export function getNightDatesUtc(checkin: string, checkout: string): string[] {
  const dates: string[] = [];
  const startMs = parseIsoDateAtUtcMidnight(checkin).getTime();
  const endMs = parseIsoDateAtUtcMidnight(checkout).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return dates;
  }
  for (let ms = startMs; ms < endMs; ms += DAY_MS) {
    dates.push(formatUtcIsoDate(new Date(ms)));
  }
  return dates;
}

/** Stripe rejects Checkout Sessions whose `expires_at` is < 30 min from creation. */
export const STRIPE_CHECKOUT_MIN_EXPIRY_MS = 30 * 60 * 1000;
/** Stripe rejects Checkout Sessions whose `expires_at` is > 24 h from creation. */
export const STRIPE_CHECKOUT_MAX_EXPIRY_MS = 24 * 60 * 60 * 1000;
/** Safety margin so the session request does not fall under the 30 min minimum in transit. */
export const STRIPE_CHECKOUT_EXPIRY_MARGIN_MS = 60 * 1000;

/**
 * Pending-reservation TTL, single source of truth for BOTH the reservation
 * `expiration_date` and the Stripe Checkout Session `expires_at`.
 * Clamped to Stripe's accepted window.
 */
export function resolvePendingTtlMs(configuredMs: number): number {
  const min = STRIPE_CHECKOUT_MIN_EXPIRY_MS + STRIPE_CHECKOUT_EXPIRY_MARGIN_MS;
  if (!Number.isFinite(configuredMs) || configuredMs < min) {
    return min;
  }
  return Math.min(configuredMs, STRIPE_CHECKOUT_MAX_EXPIRY_MS);
}

/**
 * Checkout Session `expires_at` (unix seconds) aligned with the reservation
 * expiration. If the reservation expiry is already too close (slow request),
 * it is pushed to the minimum Stripe accepts; the caller must then persist
 * the returned date back on the reservation so both stay aligned.
 */
export function resolveCheckoutExpiry(
  reservationExpiration: Date,
  now: Date = new Date(),
): { expiresAtUnix: number; expirationDate: Date } {
  const minMs =
    now.getTime() +
    STRIPE_CHECKOUT_MIN_EXPIRY_MS +
    STRIPE_CHECKOUT_EXPIRY_MARGIN_MS;
  const maxMs = now.getTime() + STRIPE_CHECKOUT_MAX_EXPIRY_MS;
  const targetMs = Math.min(
    Math.max(reservationExpiration.getTime(), minMs),
    maxMs,
  );
  const expiresAtUnix = Math.ceil(targetMs / 1000);
  return { expiresAtUnix, expirationDate: new Date(expiresAtUnix * 1000) };
}
