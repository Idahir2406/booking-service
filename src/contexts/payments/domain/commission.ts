import {
  type Cents,
  normalizeRate,
  percentOfCents,
  type Rate,
} from "../utils/money.util";

export interface FrozenCommission {
  /** Frozen at reservation creation (decimal(5,4)); null on legacy rows. */
  commissionRate: Rate | null;
  /** Frozen at creation on the full total; null on legacy rows. */
  commissionCents: Cents | null;
}

export interface PlatformFeeInput extends FrozenCommission {
  /** Amount charged to the traveler. */
  totalCents: Cents;
  /** Amount already refunded to the traveler (0 if none). */
  refundedCents: Cents;
  /** Legacy fallback (envs.COMMISSION_PERCENTAGE) for rows without F1 fields. */
  fallbackRate: Rate;
}

export interface PlatformFee {
  feeCents: Cents;
  hostAmountCents: Cents;
  rateUsed: Rate;
  source: "frozen_cents" | "frozen_rate" | "env_fallback";
}

/**
 * Platform fee retained from the host transfer (A2: 12 % on the
 * commissionable base, Stripe costs absorbed).
 * F1 rules (F2 refines with the commissionable/penalizable bases):
 *  - no refunds            -> frozen commission_cents (exact, frozen at booking)
 *  - partial refund        -> frozen rate x net retained amount (A4/A11: V4P
 *                             only earns on what is finally retained)
 *  - legacy row (no F1)    -> env COMMISSION_PERCENTAGE x net (previous behaviour)
 */
export function computePlatformFee(input: PlatformFeeInput): PlatformFee {
  const netCents = Math.max(0, input.totalCents - input.refundedCents);

  if (input.commissionRate === null) {
    const rate = normalizeRate(input.fallbackRate);
    const feeCents = percentOfCents(netCents, rate);
    return {
      feeCents,
      hostAmountCents: netCents - feeCents,
      rateUsed: rate,
      source: "env_fallback",
    };
  }

  const rate = normalizeRate(input.commissionRate);
  if (input.refundedCents <= 0 && input.commissionCents !== null) {
    const feeCents = Math.min(input.commissionCents, netCents);
    return {
      feeCents,
      hostAmountCents: netCents - feeCents,
      rateUsed: rate,
      source: "frozen_cents",
    };
  }

  const feeCents = percentOfCents(netCents, rate);
  return {
    feeCents,
    hostAmountCents: netCents - feeCents,
    rateUsed: rate,
    source: "frozen_rate",
  };
}
