import type { ReservationEntity } from "../entities/reservation.entity";

import { defineStateMachine } from "../../payments/domain/state-machine";
import { parseIsoDateAtUtcMidnight } from "./reservation-policy.util";

/**
 * Traveler incidents (F-PV7a, D4). Pure catalog + rules shared by the
 * incident service (validation) and the panel detail (capabilities), so the
 * button the UI shows and what the API accepts never diverge.
 */
export const INCIDENT_TYPE = {
  BEFORE_ARRIVAL: "before_arrival",
  DURING_STAY: "during_stay",
  DOG_ISSUE: "dog_issue",
  CONDITIONS_NOT_RESPECTED: "conditions_not_respected",
  CHARGE_ISSUE: "charge_issue",
  REFUND_ISSUE: "refund_issue",
  /** Created by the system on a force_majeure cancellation (never by the traveler). */
  FORCE_MAJEURE_CANCELLATION: "force_majeure_cancellation",
  /** Opened by the HOST ("No se presentó"), resolved by V4P (punto 6). */
  NO_SHOW: "no_show",
  /**
   * Opened by the HOST ("Comunicar imposibilidad de alojar", 2026-11-15).
   * Never cancels by itself: payout blocked, V4P reviews and either cancels
   * with a 100 % refund (responsible: host) or rejects (stay goes on).
   * Hidden from the traveler while open (V4P contacts the traveler).
   */
  HOST_CANNOT_HOST: "host_cannot_host",
  OTHER: "other",
} as const;

export type IncidentType = (typeof INCIDENT_TYPE)[keyof typeof INCIDENT_TYPE];

export const INCIDENT_TYPES = Object.values(INCIDENT_TYPE);

/** Types the traveler may open from "Tengo un problema" (PDF §8.2). */
export const TRAVELER_INCIDENT_TYPES: readonly IncidentType[] = [
  INCIDENT_TYPE.BEFORE_ARRIVAL,
  INCIDENT_TYPE.DURING_STAY,
  INCIDENT_TYPE.DOG_ISSUE,
  INCIDENT_TYPE.CONDITIONS_NOT_RESPECTED,
  INCIDENT_TYPE.CHARGE_ISSUE,
  INCIDENT_TYPE.REFUND_ISSUE,
  INCIDENT_TYPE.OTHER,
];

/**
 * D7: only these block the host payout of THAT reservation (held -> blocked).
 * before_arrival, refund_issue and other never touch the payout.
 */
export const PAYOUT_BLOCKING_INCIDENT_TYPES: readonly IncidentType[] = [
  INCIDENT_TYPE.DURING_STAY,
  INCIDENT_TYPE.CONDITIONS_NOT_RESPECTED,
  INCIDENT_TYPE.DOG_ISSUE,
  INCIDENT_TYPE.CHARGE_ISSUE,
];

export function isPayoutBlockingIncidentType(type: IncidentType): boolean {
  return PAYOUT_BLOCKING_INCIDENT_TYPES.includes(type);
}

/** UI life cycle (functional labels cv_inc_status_*; never shown raw). */
export const INCIDENT_STATUS = {
  RECEIVED: "received",
  IN_REVIEW: "in_review",
  NEEDS_INFO: "needs_info",
  RESOLVED: "resolved",
} as const;

export type IncidentStatus =
  (typeof INCIDENT_STATUS)[keyof typeof INCIDENT_STATUS];

export const INCIDENT_STATUSES = Object.values(INCIDENT_STATUS);

export const OPEN_INCIDENT_STATUSES: readonly IncidentStatus[] = [
  INCIDENT_STATUS.RECEIVED,
  INCIDENT_STATUS.IN_REVIEW,
  INCIDENT_STATUS.NEEDS_INFO,
];

/**
 * Incidents of these types are internal (host <-> V4P) while V4P reviews
 * them (status in_review): the traveler does not see them. To involve the
 * traveler, V4P moves the incident to needs_info (its note is emailed and the
 * incident becomes visible); the resolution always notifies the traveler.
 */
export const TRAVELER_HIDDEN_IN_REVIEW_TYPES: readonly IncidentType[] = [
  INCIDENT_TYPE.HOST_CANNOT_HOST,
];

export function isHiddenFromTraveler(incident: {
  type: IncidentType;
  status: IncidentStatus;
}): boolean {
  return (
    TRAVELER_HIDDEN_IN_REVIEW_TYPES.includes(incident.type) &&
    incident.status === INCIDENT_STATUS.IN_REVIEW
  );
}

export function isOpenIncidentStatus(status: IncidentStatus): boolean {
  return OPEN_INCIDENT_STATUSES.includes(status);
}

const S = INCIDENT_STATUS;

/**
 * V4P moves the incident. Chat (2026-10-25): the traveler may write in any
 * open status; only an answer to needs_info moves it (-> in_review).
 */
export const incidentStateMachine = defineStateMachine<IncidentStatus>({
  name: "incident",
  states: INCIDENT_STATUSES,
  initial: [S.RECEIVED, S.IN_REVIEW],
  transitions: {
    [S.RECEIVED]: [S.IN_REVIEW, S.NEEDS_INFO, S.RESOLVED],
    [S.IN_REVIEW]: [S.NEEDS_INFO, S.RESOLVED],
    [S.NEEDS_INFO]: [S.IN_REVIEW, S.RESOLVED],
    [S.RESOLVED]: [],
  },
});

export const INCIDENT_AUTHOR = {
  TRAVELER: "traveler",
  ADMIN: "admin",
} as const;

export type IncidentAuthor =
  (typeof INCIDENT_AUTHOR)[keyof typeof INCIDENT_AUTHOR];

export const INCIDENT_AUTHORS = Object.values(INCIDENT_AUTHOR);

/** Stable business codes in 4xx bodies (kept by the PHP proxies). */
export const INCIDENT_ERROR = {
  /** Message/attachment on a resolved incident (409). */
  INCIDENT_CLOSED: "incident_closed",
} as const;

/** Human reference used in emails and the panel (#INC-12). */
export function incidentRef(id: number): string {
  return `#INC-${id}`;
}

/** Limits (plan F-PV7a + rate limiting). */
export const INCIDENT_LIMITS = {
  DESCRIPTION_MIN: 20,
  DESCRIPTION_MAX: 2000,
  MESSAGE_MAX: 2000,
  /** D5: max files per incident (5 MB each, enforced by PHP). */
  MAX_ATTACHMENTS: 5,
  MAX_ATTACHMENT_BYTES: 5 * 1024 * 1024,
  /** Anti-spam: total incidents per reservation (open or not). */
  MAX_INCIDENTS_PER_RESERVATION: 10,
  /** Anti-spam: messages in one thread. */
  MAX_MESSAGES_PER_INCIDENT: 50,
  /** Report window after checkout (capabilities.can_report_incident). */
  REPORT_WINDOW_DAYS: 30,
} as const;

/** Same pattern the PHP proxy generates (bin2hex(16 bytes) + fixed extension). */
export const INCIDENT_ATTACHMENT_KEY_PATTERN =
  /^[a-f0-9]{32}\.(?:pdf|jpg|png|webp)$/;

export const INCIDENT_ATTACHMENT_MIMES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export type IncidentReservationInput = Pick<
  ReservationEntity,
  "status" | "payment_status" | "checkout"
>;

/** checkout + REPORT_WINDOW_DAYS still in the future. */
export function isWithinIncidentReportWindow(
  reservation: Pick<ReservationEntity, "checkout">,
  now: Date,
): boolean {
  const checkoutMs = parseIsoDateAtUtcMidnight(reservation.checkout).getTime();
  if (!Number.isFinite(checkoutMs)) {
    return false;
  }
  return (
    checkoutMs + INCIDENT_LIMITS.REPORT_WINDOW_DAYS * DAY_MS > now.getTime()
  );
}

/**
 * Types the traveler can open right now on this reservation:
 * - confirmed / finalized: every traveler type;
 * - cancelled with money involved (not an unpaid checkout): only refund_issue;
 * - pending (unpaid) or out of the 30-day window: none;
 * minus the types that already have an open incident (one open per type).
 */
export function resolveReportableIncidentTypes(
  reservation: IncidentReservationInput,
  openTypes: readonly IncidentType[],
  now: Date,
): IncidentType[] {
  if (!isWithinIncidentReportWindow(reservation, now)) {
    return [];
  }
  let candidates: readonly IncidentType[] = [];
  if (
    reservation.status === "confirmed" ||
    reservation.status === "finalized"
  ) {
    candidates = TRAVELER_INCIDENT_TYPES;
  } else if (
    reservation.status === "cancelled" &&
    reservation.payment_status !== "pending"
  ) {
    candidates = [INCIDENT_TYPE.REFUND_ISSUE];
  }
  return candidates.filter(type => !openTypes.includes(type));
}
