import type {
  ProviderBookingDogRecord,
  ProviderBookingRecord,
  ProviderFailureReason,
  ProviderQuoteChange,
} from "./provider-reservation.types";

import {
  PROVIDER_FAILURE_REASON,
  PROVIDER_QUOTE_CHANGE,
} from "./provider-reservation.types";

/** Conservative cap for guests[].remarks (provider limit is undocumented). */
export const PROVIDER_REMARKS_MAX_LENGTH = 250;

export interface QuoteChangeInput {
  priceDifferencePercent: number;
  cancellationChanged: boolean;
  boardChanged: boolean;
  /** Sell price computed from the prebook net. */
  sellCents: number;
  /** Price the traveler accepted (absent on the first quote). */
  acceptedPriceCents?: number | null;
}

export interface QuoteChangeDecision {
  requiresReconfirmation: boolean;
  changes: ProviderQuoteChange[];
}

/**
 * The traveler must see the offer again when the prebook changed it
 * (price, cancellation, board) or when the price they accepted is not the
 * one we would charge. Re-quoting with accepted_price_cents === sell
 * confirms it (the provider keeps reporting the diff vs the search).
 */
export function decideQuoteReconfirmation(
  input: QuoteChangeInput,
): QuoteChangeDecision {
  const changes: ProviderQuoteChange[] = [];
  if (
    Number.isFinite(input.priceDifferencePercent) &&
    input.priceDifferencePercent !== 0
  ) {
    changes.push(PROVIDER_QUOTE_CHANGE.PRICE);
  }
  if (input.cancellationChanged) {
    changes.push(PROVIDER_QUOTE_CHANGE.CANCELLATION);
  }
  if (input.boardChanged) {
    changes.push(PROVIDER_QUOTE_CHANGE.BOARD);
  }
  const accepted = input.acceptedPriceCents;
  const hasAccepted = accepted !== undefined && accepted !== null;
  if (hasAccepted) {
    if (accepted !== input.sellCents) {
      if (!changes.includes(PROVIDER_QUOTE_CHANGE.PRICE)) {
        changes.push(PROVIDER_QUOTE_CHANGE.PRICE);
      }
      return { requiresReconfirmation: true, changes };
    }
    return { requiresReconfirmation: false, changes };
  }
  return { requiresReconfirmation: changes.length > 0, changes };
}

/**
 * Short remark for the hotel (guests[0].remarks). Not guaranteed to be
 * honored by the property; the traveler is told so.
 */
export function buildDogRemarks(
  dogs: readonly ProviderBookingDogRecord[],
  petsCount: number,
  maxLength: number = PROVIDER_REMARKS_MAX_LENGTH,
): string | null {
  const count = Math.max(dogs.length, Math.trunc(petsCount || 0));
  if (count <= 0) {
    return null;
  }
  const head = `Viajan ${count} ${count === 1 ? "perro" : "perros"}`;
  const details = dogs.map(dog => {
    const parts = [`${formatWeight(dog.weight_kg)} kg`];
    if (dog.is_ppp) {
      parts.push("PPP");
    }
    const name = (dog.name ?? "").trim();
    return name === "" ? parts.join(", ") : `${name} (${parts.join(", ")})`;
  });
  const text =
    details.length > 0 ? `${head}: ${details.join("; ")}.` : `${head}.`;
  return truncate(text, maxLength);
}

function formatWeight(weightKg: number): string {
  const value = Number(weightKg);
  if (!Number.isFinite(value)) {
    return "?";
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/** "5,8" | "5, 8" | "" -> [5, 8]. Invalid entries are dropped. */
export function parseChildrenAges(raw: string | null | undefined): number[] {
  if (raw === null || raw === undefined) {
    return [];
  }
  return String(raw)
    .split(",")
    .map(part => part.trim())
    .filter(part => part !== "")
    .map(Number)
    .filter(age => Number.isInteger(age) && age >= 0 && age <= 17);
}

/** The prebook must be redone before booking (no id or past its TTL). */
export function isPrebookStale(
  offer: { prebook_id?: string | null; expires_at?: Date | null },
  now: Date,
): boolean {
  if (!offer.prebook_id) {
    return true;
  }
  if (!offer.expires_at) {
    return false;
  }
  return new Date(offer.expires_at).getTime() <= now.getTime();
}

export interface PendingTimeoutInput {
  record: Pick<
    ProviderBookingRecord,
    "authorized_at" | "booking_started_at"
  > | null;
  /** Fallback when the record has no instants. */
  reservationCreatedAt: Date | null;
  /** PaymentIntent.created (unix seconds), when known. */
  paymentIntentCreatedUnix?: number | null;
  now: Date;
  failAfterMinutes: number;
  authMaxAgeHours: number;
}

/**
 * Fail reason for a booking still unresolved at the provider (no booking
 * found by clientReference), or null to keep waiting:
 * - the card authorization is about to lapse (authMaxAgeHours);
 * - nothing was found failAfterMinutes after the book attempt started.
 */
export function pendingTimeoutReason(
  input: PendingTimeoutInput,
): ProviderFailureReason | null {
  if (authorizationExpiring(input)) {
    return PROVIDER_FAILURE_REASON.AUTHORIZATION_EXPIRING;
  }
  const startedMs = parseInstant(
    input.record?.booking_started_at ?? null,
    input.reservationCreatedAt,
  );
  if (startedMs === null) {
    return null;
  }
  const waitedMs = input.now.getTime() - startedMs;
  return waitedMs >= input.failAfterMinutes * 60_000
    ? PROVIDER_FAILURE_REASON.NO_BOOKING_FOUND
    : null;
}

/** The authorization is older than authMaxAgeHours. */
export function authorizationExpiring(
  input: Omit<PendingTimeoutInput, "failAfterMinutes">,
): boolean {
  const authorizedMs =
    input.paymentIntentCreatedUnix !== null &&
    input.paymentIntentCreatedUnix !== undefined
      ? input.paymentIntentCreatedUnix * 1000
      : parseInstant(
          input.record?.authorized_at ?? null,
          input.reservationCreatedAt,
        );
  if (authorizedMs === null) {
    return false;
  }
  return (
    input.now.getTime() - authorizedMs >= input.authMaxAgeHours * 3_600_000
  );
}

function parseInstant(
  iso: string | null,
  fallback: Date | null,
): number | null {
  if (iso) {
    const parsed = Date.parse(iso);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  if (fallback) {
    const time = new Date(fallback).getTime();
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

/** Narrow the stored JSON (column is `unknown`) to the booking record. */
export function readBookingRecord(
  value: unknown,
): ProviderBookingRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Partial<ProviderBookingRecord>;
  if (candidate.version !== 1 || typeof candidate.holder !== "object") {
    return null;
  }
  return candidate as ProviderBookingRecord;
}

/** `V4P-<id>`: idempotency reference sent to the provider. */
export function clientReferenceFor(reservationId: number): string {
  return `V4P-${reservationId}`;
}
