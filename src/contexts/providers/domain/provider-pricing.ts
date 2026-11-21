import type { ProviderCancellationPolicy } from "./provider.types";

import {
  assertCents,
  type Cents,
  normalizeRate,
  percentOfCents,
  type Rate,
} from "../../payments/utils/money.util";

export interface ProviderSellPrice {
  netCents: Cents;
  /** Normalized markup rate (0.15 = 15 %, max 4 decimals). */
  markupRate: Rate;
  markupCents: Cents;
  sellCents: Cents;
}

/**
 * V4P sell price of a provider offer: net + round_half_up(net x markupRate).
 * Nuitee is always queried with margin 0, so the net rate comes from the
 * provider and the markup (platform_settings.provider_markup_rate) is ours.
 */
export function computeSellPrice(
  netCents: Cents,
  markupRate: Rate,
): ProviderSellPrice {
  assertCents(netCents, "net amount");
  if (netCents < 0) {
    throw new RangeError("net amount must be >= 0");
  }
  const rate = normalizeRate(markupRate);
  const markupCents = percentOfCents(netCents, rate);
  return {
    netCents,
    markupRate: rate,
    markupCents,
    sellCents: netCents + markupCents,
  };
}

export interface ProviderPenaltyOptions {
  /** false (NRFN) = the full amount is always due. Default true. */
  refundable?: boolean;
  /**
   * Full amount charged by the provider (net), used for NRFN. When absent,
   * the highest policy amount is used.
   */
  fullAmountCents?: Cents | null;
}

/**
 * Provider cancellation penalty (cents, provider currency) at `nowUtc`:
 * - NRFN: the full amount.
 * - Otherwise the latest policy whose deadline has already passed applies
 *   (deadline <= now). Zero-amount nodes are ignored, so before the first
 *   paid deadline the penalty is 0.
 */
export function computeProviderPenalty(
  policies: readonly ProviderCancellationPolicy[],
  nowUtc: Date,
  options: ProviderPenaltyOptions = {},
): Cents {
  const paid = policies
    .filter(
      policy =>
        Number.isFinite(policy.amountCents) &&
        policy.amountCents > 0 &&
        Number.isFinite(Date.parse(policy.deadline)),
    )
    .sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline));

  if (options.refundable === false) {
    if (
      options.fullAmountCents !== undefined &&
      options.fullAmountCents !== null
    ) {
      return assertCents(options.fullAmountCents, "full amount");
    }
    let max = 0;
    for (const policy of paid) {
      max = Math.max(max, policy.amountCents);
    }
    return max;
  }

  const now = nowUtc.getTime();
  let penalty = 0;
  for (const policy of paid) {
    if (Date.parse(policy.deadline) <= now) {
      penalty = policy.amountCents;
    } else {
      break;
    }
  }
  return penalty;
}
