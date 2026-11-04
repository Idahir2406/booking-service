import { PRICE_LINE_TYPE } from "../entities/reservation-price-line.entity";
import {
  type Cents,
  normalizeRate,
  parseToCents,
  percentOfCents,
  type Rate,
} from "../utils/money.util";
import { ACTOR_TYPE } from "./audit-actor";
import { PAYMENT_STATUS, type PaymentStatus } from "./payment-state-machine";
import { type PriceLineDraft, summarizePriceLines } from "./price-lines";
import { REFUND_STATUS, type RefundStatus } from "./refund-state-machine";
import {
  buildReservationSnapshotPayload,
  type ReservationSnapshotPayload,
} from "./reservation-snapshot";

/** Legacy reservation columns the backfill reads (raw DB row shape). */
export interface LegacyReservationRow {
  id: number;
  site_id: number;
  room_id: number;
  source: string;
  checkin: string | Date;
  checkout: string | Date;
  guests: number;
  pets: number;
  subtotal: string | number | null;
  commission: string | number | null;
  total: string | number | null;
  status: string;
  payment_status: string;
  cancel_reason?: string | null;
  amount_refunded?: string | number | null;
  stripe_checkout_session_id?: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_refund_id?: string | null;
  paid_at?: Date | string | null;
  cancelled_at?: Date | string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
  board_snapshot?: unknown;
}

export interface BackfillDefaults {
  commissionRate: Rate;
  currency: string;
  timezone: string;
  deadlineLocalTime: string | null;
}

export interface BackfillPayment {
  status: PaymentStatus;
  amount_cents: Cents;
  idempotency_key: string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  failure_code: string | null;
  paid_at: Date | null;
}

export interface BackfillRefund {
  status: RefundStatus;
  amount_cents: Cents;
  idempotency_key: string;
  stripe_refund_id: string | null;
  reason: string;
  completed_at: Date | null;
}

export interface BackfillReservationFields {
  commission_rate: Rate;
  commission_cents: Cents;
  total_cents: Cents;
  currency: string;
  timezone: string;
  snapshot_version: number;
}

export interface LegacyBackfillPlan {
  reservationId: number;
  reservation: BackfillReservationFields;
  lines: PriceLineDraft[];
  payment: BackfillPayment | null;
  refund: BackfillRefund | null;
  snapshot: ReservationSnapshotPayload;
  actorType: typeof ACTOR_TYPE.SYSTEM;
}

export const LEGACY_BACKFILL_REASON = "legacy_backfill";

export const legacyKeys = {
  payment: (reservationId: number): string => `payment:legacy:${reservationId}`,
  refund: (reservationId: number): string => `refund:legacy:${reservationId}`,
} as const;

function isoDate(value: string | Date): string {
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nightsBetween(checkin: string, checkout: string): number {
  const start = Date.parse(`${checkin}T00:00:00.000Z`);
  const end = Date.parse(`${checkout}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return 0;
  }
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/** total -> subtotal + commission -> 0 (legacy rows may lack `total`). */
export function legacyTotalCents(row: LegacyReservationRow): Cents {
  const total = parseToCents(row.total);
  if (total !== null) {
    return total;
  }
  return (
    (parseToCents(row.subtotal) ?? 0) + (parseToCents(row.commission) ?? 0)
  );
}

/**
 * Maps legacy payment_status/status to a B3 payment row.
 * - paid / refunded / partially_refunded: money was captured -> paid
 *   (refunds are a separate row, B1 independent states)
 * - pending + cancelled: hold expired/cancelled unpaid -> failed
 * - pending otherwise -> pending_charge
 * External sources (airbnb/booking/vrbo) and 0 € rows get no payment.
 */
export function mapLegacyPayment(
  row: LegacyReservationRow,
  totalCents: Cents,
): BackfillPayment | null {
  if (row.source !== "internal" || totalCents <= 0) {
    return null;
  }
  const captured = ["paid", "refunded", "partially_refunded"].includes(
    row.payment_status,
  );
  let status: PaymentStatus;
  let failureCode: string | null = null;
  if (captured) {
    status = PAYMENT_STATUS.PAID;
  } else if (row.status === "cancelled") {
    status = PAYMENT_STATUS.FAILED;
    failureCode = row.cancel_reason
      ? `legacy:${row.cancel_reason}`
      : "legacy_cancelled";
  } else {
    status = PAYMENT_STATUS.PENDING_CHARGE;
  }
  return {
    status,
    amount_cents: totalCents,
    idempotency_key: legacyKeys.payment(row.id),
    stripe_checkout_session_id: row.stripe_checkout_session_id ?? null,
    stripe_payment_intent_id: row.stripe_payment_intent_id ?? null,
    failure_code: failureCode,
    paid_at: captured
      ? (toDate(row.paid_at) ??
        toDate(row.updated_at) ??
        toDate(row.created_at))
      : null,
  };
}

export function mapLegacyRefund(
  row: LegacyReservationRow,
  totalCents: Cents,
): BackfillRefund | null {
  if (
    row.payment_status !== "refunded" &&
    row.payment_status !== "partially_refunded"
  ) {
    return null;
  }
  const isTotal = row.payment_status === "refunded";
  const amount =
    parseToCents(row.amount_refunded) ?? (isTotal ? totalCents : 0);
  if (amount <= 0) {
    return null;
  }
  return {
    status: isTotal
      ? REFUND_STATUS.TOTAL_COMPLETED
      : REFUND_STATUS.PARTIAL_COMPLETED,
    amount_cents: amount,
    idempotency_key: legacyKeys.refund(row.id),
    stripe_refund_id: row.stripe_refund_id ?? null,
    reason: row.cancel_reason ?? "legacy",
    completed_at:
      toDate(row.cancelled_at) ??
      toDate(row.updated_at) ??
      toDate(row.created_at),
  };
}

interface LegacyBoardSnapshot {
  code?: string;
  name?: string;
  is_included?: boolean;
  price?: number;
  board_amount?: number;
}

function parseBoard(value: unknown): LegacyBoardSnapshot | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "string") {
    try {
      return parseBoard(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  return typeof value === "object" ? (value as LegacyBoardSnapshot) : null;
}

/**
 * Pure mapping legacy reservation -> F1 rows. Single accommodation line with
 * the whole amount (the historical split is not reliable), commission frozen
 * with the env rate in force at backfill time, snapshot v1 'legacy_backfill'.
 */
export function planLegacyBackfill(
  row: LegacyReservationRow,
  defaults: BackfillDefaults,
): LegacyBackfillPlan {
  const rate = normalizeRate(defaults.commissionRate);
  const totalCents = legacyTotalCents(row);
  const checkin = isoDate(row.checkin);
  const checkout = isoDate(row.checkout);
  const nights = nightsBetween(checkin, checkout);
  const board = parseBoard(row.board_snapshot);

  const lines: PriceLineDraft[] = [
    {
      type: PRICE_LINE_TYPE.ACCOMMODATION,
      description: "Alojamiento (importe histórico)",
      quantity: 1,
      unit_amount_cents: totalCents,
      amount_cents: totalCents,
      is_optional: false,
      is_commissionable: true,
      is_penalizable: true,
      metadata: {
        backfill: true,
        nights,
        includes_board: board !== null,
        legacy_subtotal: row.subtotal === null ? null : String(row.subtotal),
        legacy_total: row.total === null ? null : String(row.total),
      },
    },
  ];
  const totals = summarizePriceLines(lines);
  const commissionCents = percentOfCents(totalCents, rate);

  return {
    reservationId: row.id,
    reservation: {
      commission_rate: rate,
      commission_cents: commissionCents,
      total_cents: totalCents,
      currency: defaults.currency,
      timezone: defaults.timezone,
      snapshot_version: 1,
    },
    lines,
    payment: mapLegacyPayment(row, totalCents),
    refund: mapLegacyRefund(row, totalCents),
    snapshot: buildReservationSnapshotPayload({
      stay: {
        site_id: row.site_id,
        checkin,
        checkout,
        nights,
        guests: Number(row.guests),
        pets: Number(row.pets),
      },
      room: {
        id: row.room_id,
        name: null,
        max_guests: null,
        max_pets: null,
        price_per_night_cents: null,
      },
      board: board
        ? {
            id: null,
            code: String(board.code ?? ""),
            name: String(board.name ?? ""),
            is_included: Boolean(board.is_included),
            price_cents: parseToCents(board.price) ?? 0,
            amount_cents: parseToCents(board.board_amount) ?? 0,
          }
        : null,
      currency: defaults.currency,
      lines,
      totals,
      commissionRate: rate,
      commissionCents,
      timezone: defaults.timezone,
      deadlineLocalTime: defaults.deadlineLocalTime,
      source: LEGACY_BACKFILL_REASON,
    }),
    actorType: ACTOR_TYPE.SYSTEM,
  };
}
