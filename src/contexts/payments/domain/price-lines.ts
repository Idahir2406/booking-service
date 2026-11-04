import {
  NEGATIVE_ALLOWED_LINE_TYPES,
  PRICE_LINE_TYPE,
  type PriceLineType,
} from "../entities/reservation-price-line.entity";
import {
  assertCents,
  type Cents,
  MoneyError,
  multiplyCents,
  sumCents,
  toCents,
} from "../utils/money.util";

export interface PriceLineDraft {
  type: PriceLineType;
  description: string;
  quantity: number;
  unit_amount_cents: Cents;
  amount_cents: Cents;
  is_optional: boolean;
  is_commissionable: boolean;
  is_penalizable: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface PriceLinesSummary {
  total_cents: Cents;
  /** A3: base V4P commission is computed on. */
  commissionable_cents: Cents;
  /** A4: base a traveler cancellation penalty applies to. */
  penalizable_cents: Cents;
  optional_cents: Cents;
  non_commissionable_cents: Cents;
}

export function validatePriceLine(line: PriceLineDraft): void {
  assertCents(line.unit_amount_cents, "unit_amount_cents");
  assertCents(line.amount_cents, "amount_cents");
  if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
    throw new MoneyError(`Invalid quantity for ${line.type} line`);
  }
  if (
    line.amount_cents < 0 &&
    !NEGATIVE_ALLOWED_LINE_TYPES.includes(line.type)
  ) {
    throw new MoneyError(
      `Negative amount not allowed for ${line.type} lines (use discount/adjustment)`,
    );
  }
  if (line.description.trim() === "") {
    throw new MoneyError(`Price line ${line.type} needs a description`);
  }
}

export function summarizePriceLines(
  lines: readonly Pick<
    PriceLineDraft,
    "amount_cents" | "is_optional" | "is_commissionable" | "is_penalizable"
  >[],
): PriceLinesSummary {
  const amounts = (predicate: (line: (typeof lines)[number]) => boolean) =>
    sumCents(
      lines.filter(line => predicate(line)).map(line => line.amount_cents),
    );
  return {
    total_cents: amounts(() => true),
    commissionable_cents: amounts(line => line.is_commissionable),
    penalizable_cents: amounts(line => line.is_penalizable),
    optional_cents: amounts(line => line.is_optional),
    non_commissionable_cents: amounts(line => !line.is_commissionable),
  };
}

export interface CheckoutBoardInput {
  code: string;
  name: string;
  is_included: boolean;
  price: number;
}

export interface CheckoutPriceInput {
  nights: number;
  /** Legacy decimals coming from the quote. */
  nightly_rate: number;
  base_subtotal: number;
  board_amount: number;
  total: number;
  room_name?: string | null;
  board?: CheckoutBoardInput | null;
}

/**
 * Price lines for today's checkout (accommodation + board). Both are
 * commissionable and penalizable (A3/A4: board is part of the stay).
 * If legacy float math and cents disagree, an explicit `adjustment` line
 * closes the gap so SUM(lines) === amount charged, always.
 */
export function buildCheckoutPriceLines(
  input: CheckoutPriceInput,
): PriceLineDraft[] {
  const nights = Math.max(0, Math.trunc(input.nights));
  const unitCents = toCents(input.nightly_rate);
  const accommodationCents = toCents(input.base_subtotal);
  const lines: PriceLineDraft[] = [
    {
      type: PRICE_LINE_TYPE.ACCOMMODATION,
      description: input.room_name
        ? `Alojamiento · ${input.room_name}`
        : "Alojamiento",
      quantity: nights > 0 ? nights : 1,
      unit_amount_cents: nights > 0 ? unitCents : accommodationCents,
      amount_cents: accommodationCents,
      is_optional: false,
      is_commissionable: true,
      is_penalizable: true,
      metadata: { nights, nightly_rate_cents: unitCents },
    },
  ];

  if (input.board) {
    const boardCents = toCents(input.board_amount);
    lines.push({
      type: PRICE_LINE_TYPE.BOARD,
      description: `Régimen · ${input.board.name}`,
      quantity: 1,
      unit_amount_cents: boardCents,
      amount_cents: boardCents,
      is_optional: false,
      is_commissionable: true,
      is_penalizable: true,
      metadata: {
        code: input.board.code,
        is_included: input.board.is_included,
        price_cents: toCents(input.board.price),
        nights,
      },
    });
  }

  const expectedTotal = toCents(input.total);
  const diff = expectedTotal - summarizePriceLines(lines).total_cents;
  if (diff !== 0) {
    lines.push({
      type: PRICE_LINE_TYPE.ADJUSTMENT,
      description: "Ajuste de redondeo",
      quantity: 1,
      unit_amount_cents: diff,
      amount_cents: diff,
      is_optional: false,
      is_commissionable: true,
      is_penalizable: true,
      metadata: { reason: "rounding" },
    });
  }

  for (const line of lines) {
    validatePriceLine(line);
  }
  return lines;
}

/** Helper for callers that know unit x quantity. */
export function lineAmount(unitCents: Cents, quantity: number): Cents {
  return multiplyCents(unitCents, quantity);
}
