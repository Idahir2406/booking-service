/**
 * Provider reservations (source = nuitee): quote (prebook), manual-capture
 * checkout and book. Shapes shared by the services, the controller and the
 * PHP web (JSON contract).
 */

export const PROVIDER_QUOTE_STATUS = {
  /** Pending reservation created; continue with POST checkout. */
  OK: "ok",
  /** Price / cancellation / board changed: show it and quote again. */
  REQUIRES_RECONFIRMATION: "requires_reconfirmation",
} as const;

export type ProviderQuoteStatus =
  (typeof PROVIDER_QUOTE_STATUS)[keyof typeof PROVIDER_QUOTE_STATUS];

export const PROVIDER_QUOTE_CHANGE = {
  PRICE: "price",
  CANCELLATION: "cancellation",
  BOARD: "board",
} as const;

export type ProviderQuoteChange =
  (typeof PROVIDER_QUOTE_CHANGE)[keyof typeof PROVIDER_QUOTE_CHANGE];

/** i18n keys the web shows when there is nothing to sell. */
export const PROVIDER_RATES_MESSAGE = {
  NO_AVAILABILITY: "provider_rates_no_availability",
  PETS_NOT_ALLOWED: "provider_rates_pets_not_allowed",
  PROVIDER_ERROR: "provider_rates_unavailable",
} as const;

export type ProviderRatesMessage =
  (typeof PROVIDER_RATES_MESSAGE)[keyof typeof PROVIDER_RATES_MESSAGE];

export const PROVIDER_BOOK_OUTCOME = {
  CONFIRMED: "confirmed",
  FAILED: "failed",
  /** Outcome unknown at the provider: resolvePending (cron) decides. */
  PENDING: "pending",
  /** Already handled or not applicable (idempotent re-entry). */
  NOOP: "noop",
} as const;

export type ProviderBookOutcome =
  (typeof PROVIDER_BOOK_OUTCOME)[keyof typeof PROVIDER_BOOK_OUTCOME];

/** reservations.cancel_reason = `provider_<reason>` on the fail path. */
export const PROVIDER_FAILURE_REASON = {
  UNAVAILABLE: "unavailable",
  PRICE_INCREASED: "price_increased",
  OFFER_EXPIRED: "offer_expired",
  PROVIDER_REJECTED: "rejected",
  PROVIDER_CANCELLED: "provider_cancelled",
  NO_BOOKING_FOUND: "no_booking_found",
  AUTHORIZATION_EXPIRING: "authorization_expiring",
  PAYMENT_NOT_AUTHORIZED: "payment_not_authorized",
  RESERVATION_NOT_PENDING: "reservation_not_pending",
} as const;

export type ProviderFailureReason =
  (typeof PROVIDER_FAILURE_REASON)[keyof typeof PROVIDER_FAILURE_REASON];

export interface ProviderBookingHolderRecord {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
}

export interface ProviderBookingDogRecord {
  name: string | null;
  weight_kg: number;
  is_ppp: boolean;
}

export interface ProviderBookingFailureRecord {
  reason: ProviderFailureReason;
  message: string | null;
  at: string;
}

/**
 * reservations.provider_booking_json: traveler data needed to book (frozen
 * at quote time), lifecycle instants and the last provider payload.
 */
export interface ProviderBookingRecord {
  version: 1;
  holder: ProviderBookingHolderRecord;
  adults: number;
  children_ages: number[];
  dogs: ProviderBookingDogRecord[];
  /** guests[0].remarks sent to the provider. */
  remarks: string | null;
  /** checkout.session.completed received (card authorized). */
  authorized_at: string | null;
  /** provider_status -> booking (book call about to be made). */
  booking_started_at: string | null;
  hotel_confirmation_code: string | null;
  /** Last BookResult.raw / listBookings match. */
  booking: unknown;
  failure: ProviderBookingFailureRecord | null;
  /** booking.checkinInstruction webhook payload (raw, parsed). */
  checkin_instructions?: unknown;
  /** Phase 5: cancellation lifecycle (absent until someone cancels). */
  cancellation?: ProviderCancellationRecord | null;
}

// --- Phase 5: cancellation ---------------------------------------------------

/**
 * provider_booking_json.cancellation.status:
 * - requested: claim taken, provider cancel call in flight (concurrency guard);
 * - pending: provider answered PENDING_UNKNOWN / timed out; the 5-min cron
 *   reconciles with getBooking and refunds only once CANCELLED;
 * - cancelled: provider confirmed and V4P refunded (terminal).
 */
export const PROVIDER_CANCELLATION_STATUS = {
  REQUESTED: "requested",
  PENDING: "pending",
  CANCELLED: "cancelled",
} as const;

export type ProviderCancellationStatus =
  (typeof PROVIDER_CANCELLATION_STATUS)[keyof typeof PROVIDER_CANCELLATION_STATUS];

export const PROVIDER_CANCELLATION_INITIATOR = {
  TRAVELER: "traveler",
  ADMIN: "admin",
  /** Hotel / provider cancelled a confirmed booking (webhook, reconcile). */
  PROVIDER: "provider",
} as const;

export type ProviderCancellationInitiator =
  (typeof PROVIDER_CANCELLATION_INITIATOR)[keyof typeof PROVIDER_CANCELLATION_INITIATOR];

/** reservations.cancel_reason when the hotel/provider cancelled. */
export const PROVIDER_CANCELLED_BY_HOTEL_REASON = "provider_cancelled_by_hotel";

export interface ProviderCancellationRecord {
  status: ProviderCancellationStatus;
  initiator: ProviderCancellationInitiator;
  requested_at: string;
  /** Traveler reason / admin note key (stored as reservations.cancel_reason). */
  reason: string;
  notes: string | null;
  actor_id: number | null;
  /** Admin courtesy: refund everything even if the provider charges. */
  waive_penalty: boolean;
  provider_raw_status: string | null;
  /** Provider penalty (net, provider currency) when known. */
  penalty_net_cents: number | null;
  /** Penalty kept by V4P (sell basis) and amount refunded. */
  penalty_cents: number | null;
  refund_cents: number | null;
  completed_at: string | null;
  /** Admin alerted that the pending cancellation is taking too long. */
  alerted_at: string | null;
}

export const PROVIDER_CANCEL_OUTCOME = {
  CANCELLED: "cancelled",
  /** Provider has not confirmed yet: nothing refunded, cron reconciles. */
  PENDING: "pending",
  NOOP: "noop",
} as const;

export type ProviderCancelOutcome =
  (typeof PROVIDER_CANCEL_OUTCOME)[keyof typeof PROVIDER_CANCEL_OUTCOME];

export interface ProviderCancelResult {
  reservation_id: number;
  outcome: ProviderCancelOutcome;
  provider_status: string | null;
  penalty_cents: number;
  refund_cents: number;
  refund_initiated: boolean;
  reason?: string;
}

export interface ProviderBookResult {
  reservationId: number;
  outcome: ProviderBookOutcome;
  providerStatus: string | null;
  reason?: string;
}
