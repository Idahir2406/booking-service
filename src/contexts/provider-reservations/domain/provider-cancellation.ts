import type { ProviderCancellationPolicy } from "../../providers/domain/provider.types";
import type { ProviderCancellationRecord } from "./provider-reservation.types";

import { type Cents, type Rate } from "../../payments/utils/money.util";
import {
  computeProviderPenalty,
  computeSellPrice,
} from "../../providers/domain/provider-pricing";

/**
 * Phase 5: cancellation of a provider reservation (source = nuitee). The
 * provider penalty is NET (what Nuitee keeps); V4P keeps the same proportion
 * of what the traveler paid, i.e. the net penalty plus our markup on it,
 * capped at what is still refundable. Same scaling the public page uses to
 * show the cancellation amounts (phase 3-4). Commission on the refunded part
 * follows the business decision still pending in the plan.
 */

export const PROVIDER_PENALTY_SOURCE = {
  /** Computed from provider_offers.cancellation_json at `now`. */
  COMPUTED: "computed",
  /** Real penalty returned by the provider's cancel call. */
  PROVIDER: "provider",
  /** Hotel cancelled or admin waived: no penalty. */
  WAIVED: "waived",
} as const;

export type ProviderPenaltySource =
  (typeof PROVIDER_PENALTY_SOURCE)[keyof typeof PROVIDER_PENALTY_SOURCE];

export interface ProviderCancellationOfferInput {
  refundable: boolean;
  cancellation_json: readonly ProviderCancellationPolicy[];
  net_cents: Cents;
  markup_rate: Rate | null;
  currency: string;
}

export interface ProviderCancellationQuoteInput {
  offer: ProviderCancellationOfferInput;
  /** reservations.total_cents (charged to the traveler). */
  chargedCents: Cents;
  alreadyRefundedCents: Cents;
  now: Date;
  /** Fallback markup when the offer has none (reservation.commission_rate). */
  fallbackMarkupRate?: Rate | null;
  /** Real provider penalty (net) from CancelResult, when trusted. */
  providerPenaltyNetCents?: Cents | null;
  /** Provider-side currency of providerPenaltyNetCents. */
  providerPenaltyCurrency?: string | null;
  /** Hotel cancellation / admin waiver: full refund. */
  waivePenalty?: boolean;
}

export interface ProviderCancellationQuote {
  /** Still refundable (charged - already refunded). */
  paid_cents: Cents;
  penalty_net_cents: Cents;
  /** Kept by V4P (sell basis, capped at paid_cents). */
  penalty_cents: Cents;
  refund_cents: Cents;
  within_free_period: boolean;
  /** Next instant (UTC ISO) at which the penalty grows; null = none. */
  deadline_iso: string | null;
  penalty_source: ProviderPenaltySource;
}

/**
 * Net provider penalty -> V4P sell basis: net + round_half_up(net x markup),
 * capped at `capCents` (never keep more than the traveler still has paid).
 */
export function scaleProviderPenaltyToSell(
  penaltyNetCents: Cents,
  markupRate: Rate,
  capCents: Cents,
): Cents {
  if (!Number.isFinite(penaltyNetCents) || penaltyNetCents <= 0) {
    return 0;
  }
  const sell = computeSellPrice(Math.round(penaltyNetCents), markupRate);
  return Math.max(0, Math.min(sell.sellCents, capCents));
}

function nextPaidDeadline(
  policies: readonly ProviderCancellationPolicy[],
  now: Date,
): string | null {
  const upcoming = policies
    .filter(
      policy =>
        policy.amountCents > 0 &&
        Number.isFinite(Date.parse(policy.deadline)) &&
        Date.parse(policy.deadline) > now.getTime(),
    )
    .sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline));
  const first = upcoming.at(0);
  return first ? new Date(first.deadline).toISOString() : null;
}

function sameCurrency(a: string | null | undefined, b: string): boolean {
  return (a ?? "").toUpperCase() === b.toUpperCase();
}

export function quoteProviderCancellation(
  input: ProviderCancellationQuoteInput,
): ProviderCancellationQuote {
  const paidCents = Math.max(
    0,
    input.chargedCents - input.alreadyRefundedCents,
  );
  const markupRate = input.offer.markup_rate ?? input.fallbackMarkupRate ?? 0;
  const computedNet = computeProviderPenalty(
    input.offer.cancellation_json,
    input.now,
    {
      refundable: input.offer.refundable,
      fullAmountCents: input.offer.net_cents,
    },
  );
  const deadlineIso = input.offer.refundable
    ? nextPaidDeadline(input.offer.cancellation_json, input.now)
    : null;

  if (input.waivePenalty === true) {
    return {
      paid_cents: paidCents,
      penalty_net_cents: 0,
      penalty_cents: 0,
      refund_cents: paidCents,
      within_free_period: computedNet === 0,
      deadline_iso: deadlineIso,
      penalty_source: PROVIDER_PENALTY_SOURCE.WAIVED,
    };
  }

  const providerNet = input.providerPenaltyNetCents;
  const useProvider =
    providerNet !== null &&
    providerNet !== undefined &&
    Number.isFinite(providerNet) &&
    providerNet >= 0 &&
    // A penalty in another currency cannot be compared with the charge.
    (input.providerPenaltyCurrency === null ||
      input.providerPenaltyCurrency === undefined ||
      sameCurrency(input.providerPenaltyCurrency, input.offer.currency));
  const penaltyNet = useProvider ? Math.round(providerNet) : computedNet;
  const penaltyCents = scaleProviderPenaltyToSell(
    penaltyNet,
    markupRate,
    paidCents,
  );
  return {
    paid_cents: paidCents,
    penalty_net_cents: penaltyNet,
    penalty_cents: penaltyCents,
    refund_cents: paidCents - penaltyCents,
    within_free_period: computedNet === 0,
    deadline_iso: deadlineIso,
    penalty_source: useProvider
      ? PROVIDER_PENALTY_SOURCE.PROVIDER
      : PROVIDER_PENALTY_SOURCE.COMPUTED,
  };
}

/** provider_booking_json.cancellation (any JSON shape tolerated). */
export function readCancellationRecord(
  json: unknown,
): ProviderCancellationRecord | null {
  if (typeof json !== "object" || json === null) {
    return null;
  }
  const value = (json as { cancellation?: unknown }).cancellation;
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Partial<ProviderCancellationRecord>;
  if (
    typeof record.status !== "string" ||
    typeof record.requested_at !== "string"
  ) {
    return null;
  }
  return record as ProviderCancellationRecord;
}

/** Returns a copy of provider_booking_json with `cancellation` replaced. */
export function withCancellationRecord(
  json: unknown,
  record: ProviderCancellationRecord | null,
): Record<string, unknown> {
  const base =
    typeof json === "object" && json !== null && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : {};
  return { ...base, cancellation: record };
}
