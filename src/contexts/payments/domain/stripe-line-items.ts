import { sumCents } from "../utils/money.util";

/**
 * F2: Stripe Checkout line_items built from the reservation price lines
 * (one Stripe item per line, Spanish names) so the traveler sees the same
 * breakdown on Stripe as in our checkout.
 *
 * Invariant: SUM(line_items) === total_cents (amount charged = reservation
 * total). Stripe forbids negative unit_amount, so if a line is negative
 * (discount/adjustment) or the itemized sum would not match, we fall back to
 * ONE item for the whole total: the amount charged is never altered.
 * Zero-amount lines (e.g. board included) are omitted.
 */

export const STRIPE_LINE_ITEMS_MODE = {
  ITEMIZED: "itemized",
  SINGLE: "single",
} as const;

export type StripeLineItemsMode =
  (typeof STRIPE_LINE_ITEMS_MODE)[keyof typeof STRIPE_LINE_ITEMS_MODE];

export interface StripeLineSource {
  description: string;
  amount_cents: number;
  metadata?: Record<string, unknown> | null;
}

export interface StripeProductData {
  name: string;
  description?: string;
}

export interface StripePriceData {
  currency: string;
  unit_amount: number;
  product_data: StripeProductData;
}

export interface StripeCheckoutLineItem {
  quantity: number;
  price_data: StripePriceData;
}

export interface StripeLineItemsResult {
  mode: StripeLineItemsMode;
  line_items: StripeCheckoutLineItem[];
  total_cents: number;
}

/** Stripe limits product names; keep them readable. */
const MAX_NAME_LENGTH = 250;
const MAX_DESCRIPTION_LENGTH = 500;

function detailOf(line: StripeLineSource): string | undefined {
  const detail = line.metadata?.detail;
  return typeof detail === "string" && detail.trim() !== ""
    ? detail.slice(0, MAX_DESCRIPTION_LENGTH)
    : undefined;
}

export function buildStripeLineItems(
  lines: readonly StripeLineSource[],
  totalCents: number,
  currency: string,
  fallbackName: string,
): StripeLineItemsResult {
  const single = (): StripeLineItemsResult => ({
    mode: STRIPE_LINE_ITEMS_MODE.SINGLE,
    total_cents: totalCents,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency,
          unit_amount: totalCents,
          product_data: { name: fallbackName.slice(0, MAX_NAME_LENGTH) },
        },
      },
    ],
  });

  if (lines.length === 0 || lines.some(line => line.amount_cents < 0)) {
    return single();
  }

  const items: StripeCheckoutLineItem[] = lines
    .filter(line => line.amount_cents > 0)
    .map(line => {
      const description = detailOf(line);
      return {
        // quantity 1 + line amount: line quantities may be "dogs x nights",
        // and unit x quantity is already exact in our lines.
        quantity: 1,
        price_data: {
          currency,
          unit_amount: line.amount_cents,
          product_data: {
            name: line.description.slice(0, MAX_NAME_LENGTH),
            ...(description ? { description } : {}),
          },
        },
      };
    });

  const itemizedTotal = sumCents(
    items.map(item => item.price_data.unit_amount * item.quantity),
  );
  if (items.length === 0 || itemizedTotal !== totalCents) {
    return single();
  }
  return {
    mode: STRIPE_LINE_ITEMS_MODE.ITEMIZED,
    total_cents: totalCents,
    line_items: items,
  };
}
