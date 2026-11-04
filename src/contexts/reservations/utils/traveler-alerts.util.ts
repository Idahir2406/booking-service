import type { TravelerCancellationQuote } from "./refund-policy.util";

import {
  TRAVELER_STATUS,
  type TravelerStatus,
} from "./traveler-panel-status.util";

/**
 * Traveler home alerts (F-PV6, handoff §7). Pure: no I/O and no clock, `now`
 * is injected. Never produces debt / "update payment method" alerts (plan §6).
 */
export const TRAVELER_ALERT = {
  FREE_CANCEL_ENDING: "free_cancel_ending",
  INCIDENT_REVIEW: "incident_review",
  /** F-PV7b: live (pending, not expired) reservation_change_proposals row. */
  CHANGE_PROPOSAL_PENDING: "change_proposal_pending",
  /** F-PV7b: live (pending, not expired) reservation_alternatives row. */
  ALTERNATIVE_PENDING: "alternative_pending",
} as const;

export type TravelerAlertType =
  (typeof TRAVELER_ALERT)[keyof typeof TRAVELER_ALERT];

/** D10: warn when the free-cancellation deadline is at most 72 h away. */
export const FREE_CANCEL_ALERT_HOURS = 72;

const HOUR_MS = 60 * 60 * 1000;

/** Display order on the home: money-related deadline first. */
const ALERT_PRIORITY: Record<TravelerAlertType, number> = {
  [TRAVELER_ALERT.FREE_CANCEL_ENDING]: 0,
  [TRAVELER_ALERT.INCIDENT_REVIEW]: 1,
  [TRAVELER_ALERT.CHANGE_PROPOSAL_PENDING]: 2,
  [TRAVELER_ALERT.ALTERNATIVE_PENDING]: 3,
};

/** Subset of the F-PV4 resolver output the alert needs (same source as preview/cancel). */
export type TravelerFreeCancelWindow = Pick<
  TravelerCancellationQuote,
  "can_cancel" | "within_free_period" | "deadline_iso"
>;

export interface TravelerAlertCandidate {
  reservation_id: number;
  code: string;
  site_name: string | null;
  /** From mapTravelerFacingStatus (single status mapping, F-PV1). */
  status: TravelerStatus;
  /** refunds.status = pending: awaiting V4P review (force_majeure cancellation). */
  has_pending_refund: boolean;
  /** F-PV7a: open reservation_incidents (e.g. refund_issue on a cancelled booking). */
  has_open_incident?: boolean;
  /** resolveTravelerCancellationQuote output; null when not computed (not confirmed). */
  free_cancel: TravelerFreeCancelWindow | null;
  /** F-PV7b: a change proposal waits for «Aceptar cambio» / «Mantener». */
  has_pending_change_proposal: boolean;
  /** F-PV7b: an accommodation alternative waits for the traveler. */
  has_pending_alternative: boolean;
}

export interface TravelerAlertsInput {
  reservations: readonly TravelerAlertCandidate[];
}

export interface TravelerAlertDto {
  type: TravelerAlertType;
  reservation_id: number;
  code: string;
  site_name: string | null;
  /** Free-cancellation deadline (ISO, UTC) for FREE_CANCEL_ENDING; null otherwise. */
  deadline_iso: string | null;
}

/**
 * FREE_CANCEL_ENDING: traveler-facing status `confirmed` (paid, no incident),
 * the resolver says it can be cancelled and is inside the free period, and the
 * frozen deadline is in the future and at most FREE_CANCEL_ALERT_HOURS away.
 */
export function isFreeCancelEnding(
  candidate: Pick<TravelerAlertCandidate, "status" | "free_cancel">,
  now: Date,
): boolean {
  const freeCancel = candidate.free_cancel;
  if (candidate.status !== TRAVELER_STATUS.CONFIRMED || !freeCancel) {
    return false;
  }
  if (
    !freeCancel.can_cancel ||
    !freeCancel.within_free_period ||
    !freeCancel.deadline_iso
  ) {
    return false;
  }
  const deadlineMs = new Date(freeCancel.deadline_iso).getTime();
  if (!Number.isFinite(deadlineMs)) {
    return false;
  }
  const remainingMs = deadlineMs - now.getTime();
  return remainingMs > 0 && remainingMs <= FREE_CANCEL_ALERT_HOURS * HOUR_MS;
}

/**
 * INCIDENT_REVIEW: status `incident_review` (open dispute or pending refund,
 * same rule as the card badge). A cancelled reservation keeps the `cancelled`
 * badge (status util order) but still alerts while its refund waits for V4P
 * review (force_majeure), which is the only pending thing left for the traveler.
 */
export function isIncidentInReview(
  candidate: Pick<
    TravelerAlertCandidate,
    "status" | "has_pending_refund" | "has_open_incident"
  >,
): boolean {
  if (candidate.status === TRAVELER_STATUS.INCIDENT_REVIEW) {
    return true;
  }
  return (
    candidate.status === TRAVELER_STATUS.CANCELLED &&
    (candidate.has_pending_refund || candidate.has_open_incident === true)
  );
}

export function buildTravelerAlerts(
  input: TravelerAlertsInput,
  now: Date,
): TravelerAlertDto[] {
  const alerts: TravelerAlertDto[] = [];
  for (const candidate of input.reservations) {
    const base = {
      reservation_id: candidate.reservation_id,
      code: candidate.code,
      site_name: candidate.site_name,
    };
    const deadlineIso = candidate.free_cancel?.deadline_iso ?? null;
    if (deadlineIso && isFreeCancelEnding(candidate, now)) {
      alerts.push({
        ...base,
        type: TRAVELER_ALERT.FREE_CANCEL_ENDING,
        deadline_iso: new Date(deadlineIso).toISOString(),
      });
    }
    if (isIncidentInReview(candidate)) {
      alerts.push({
        ...base,
        type: TRAVELER_ALERT.INCIDENT_REVIEW,
        deadline_iso: null,
      });
    }
    if (candidate.status === TRAVELER_STATUS.CANCELLED) {
      continue;
    }
    if (candidate.has_pending_change_proposal) {
      alerts.push({
        ...base,
        type: TRAVELER_ALERT.CHANGE_PROPOSAL_PENDING,
        deadline_iso: null,
      });
    }
    if (candidate.has_pending_alternative) {
      alerts.push({
        ...base,
        type: TRAVELER_ALERT.ALTERNATIVE_PENDING,
        deadline_iso: null,
      });
    }
  }
  return alerts.sort(compareAlerts);
}

function compareAlerts(a: TravelerAlertDto, b: TravelerAlertDto): number {
  const byType = ALERT_PRIORITY[a.type] - ALERT_PRIORITY[b.type];
  if (byType !== 0) {
    return byType;
  }
  if (a.deadline_iso && b.deadline_iso && a.deadline_iso !== b.deadline_iso) {
    return a.deadline_iso < b.deadline_iso ? -1 : 1;
  }
  return a.reservation_id - b.reservation_id;
}
