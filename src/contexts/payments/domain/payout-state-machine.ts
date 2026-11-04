import { defineStateMachine } from "./state-machine";

/**
 * Legacy reservations.payout_status (read by PHP), the subset of B5 used
 * today. Mapping to B5:
 *   held     -> NO_DISPONIBLE / DISPONIBLE (depends on dates, see deriveLiquidationStatus)
 *   blocked  -> BLOQUEADA_INCIDENCIA
 *   released -> LIQUIDADA
 */
export const PAYOUT_STATUS = {
  HELD: "held",
  BLOCKED: "blocked",
  RELEASED: "released",
} as const;

export type PayoutStatus = (typeof PAYOUT_STATUS)[keyof typeof PAYOUT_STATUS];

const P = PAYOUT_STATUS;

/**
 * - held -> released:      transfer sent (cron / review).
 * - held <-> blocked:      Stripe dispute / guest report; unblocked when won.
 * - blocked -> released:   ONLY for transfer.created sync (the transfer
 *                          existed before the block; Stripe is the truth).
 * - released is final:     a dispute after release does not move it (A21 debt, F4).
 */
export const payoutStateMachine = defineStateMachine<PayoutStatus>({
  name: "payout",
  states: Object.values(PAYOUT_STATUS),
  initial: [P.HELD],
  transitions: {
    [P.HELD]: [P.RELEASED, P.BLOCKED],
    [P.BLOCKED]: [P.HELD, P.RELEASED],
    [P.RELEASED]: [],
  },
});

/** B5 · Estados de liquidación (full set; batches/weekly settlement in F4). */
export const LIQUIDATION_STATUS = {
  NOT_AVAILABLE: "not_available",
  BLOCKED_INCIDENT: "blocked_incident",
  AVAILABLE: "available",
  INCLUDED_IN_SETTLEMENT: "included_in_settlement",
  PROCESSING: "processing",
  SETTLED: "settled",
  FAILED: "failed",
} as const;

export type LiquidationStatus =
  (typeof LIQUIDATION_STATUS)[keyof typeof LIQUIDATION_STATUS];

const L = LIQUIDATION_STATUS;

export const liquidationStateMachine = defineStateMachine<LiquidationStatus>({
  name: "liquidation",
  states: Object.values(LIQUIDATION_STATUS),
  initial: [L.NOT_AVAILABLE],
  transitions: {
    [L.NOT_AVAILABLE]: [L.AVAILABLE, L.BLOCKED_INCIDENT],
    [L.BLOCKED_INCIDENT]: [L.NOT_AVAILABLE, L.AVAILABLE],
    [L.AVAILABLE]: [L.BLOCKED_INCIDENT, L.INCLUDED_IN_SETTLEMENT, L.PROCESSING],
    [L.INCLUDED_IN_SETTLEMENT]: [L.PROCESSING, L.BLOCKED_INCIDENT],
    [L.PROCESSING]: [L.SETTLED, L.FAILED],
    [L.FAILED]: [L.PROCESSING, L.BLOCKED_INCIDENT],
    [L.SETTLED]: [],
  },
});

export interface LiquidationInput {
  status: string;
  payout_status?: string | null;
  feedback_deadline_at?: Date | string | null;
  /** True when the last release attempt failed and no transfer exists. */
  last_release_failed?: boolean;
}

/**
 * Read-only B5 view of a reservation for panels/backoffice. "Available" today
 * = finalized and the feedback window (FEEDBACK_PAYOUT_DELAY_HOURS) is over.
 */
export function deriveLiquidationStatus(
  reservation: LiquidationInput,
  now: Date = new Date(),
): LiquidationStatus {
  if (reservation.payout_status === P.RELEASED) {
    return L.SETTLED;
  }
  if (reservation.payout_status === P.BLOCKED) {
    return L.BLOCKED_INCIDENT;
  }
  if (reservation.payout_status !== P.HELD) {
    return L.NOT_AVAILABLE;
  }
  if (reservation.last_release_failed) {
    return L.FAILED;
  }
  const deadline = reservation.feedback_deadline_at
    ? new Date(reservation.feedback_deadline_at).getTime()
    : Number.NaN;
  if (
    reservation.status === "finalized" &&
    Number.isFinite(deadline) &&
    deadline <= now.getTime()
  ) {
    return L.AVAILABLE;
  }
  return L.NOT_AVAILABLE;
}
