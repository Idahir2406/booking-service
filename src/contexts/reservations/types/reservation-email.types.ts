export type ReservationEmailType =
  | "payment_confirmed_guest"
  | "payment_confirmed_host"
  | "cancelled_guest_refund"
  | "cancelled_guest_no_refund"
  | "cancelled_host"
  | "finalized_guest_feedback"
  | "finalized_host"
  | "feedback_review_guest"
  | "feedback_review_host"
  | "feedback_report_guest"
  | "feedback_report_host"
  | "feedback_report_admin"
  | "payout_released_host"
  | "payout_released_guest"
  | "payout_failed_host"
  | "payout_failed_admin"
  | "refund_processed_guest"
  | "refund_processed_host"
  | "refund_failed_guest"
  | "refund_failed_host"
  | "refund_failed_admin"
  | "force_majeure_review_admin"
  | "exceptional_refund_review_admin"
  | "incident_opened_admin"
  | "incident_message_admin"
  | "incident_message_traveler"
  | "payment_after_expiry_refund_guest"
  | "payment_after_expiry_refund_admin"
  | "no_show_reported_guest"
  | "no_show_reported_admin"
  | "no_show_confirmed_guest"
  | "no_show_confirmed_host"
  | "no_show_rejected_guest"
  | "no_show_rejected_host";

/**
 * Punto 9: host-level notices (not tied to one reservation): Stripe could not
 * pay the host's bank, or new reservations are paused after
 * payout_failure_days of unresolved payout failures.
 */
export type HostNoticeEmailType =
  | "payout_bank_failed_host"
  | "payout_bank_failed_admin"
  | "payout_blocked_host"
  | "payout_blocked_admin";

export interface HostNoticeEmailPayload {
  host_user_id: number;
  host_email: string;
  site_names: string[];
  admin_email?: string;
  /** "transfer_failed" | "bank_payout_failed". */
  reason?: string | null;
  amount_cents?: number | null;
  currency?: string | null;
  failure_message?: string | null;
  days?: number | null;
  reservation_ids?: number[];
}

/** F2: price line shown in confirmation emails (from the snapshot). */
export interface ReservationEmailPriceLine {
  description: string;
  detail: string | null;
  amount_cents: number;
  is_optional: boolean;
}

/** F2: informative deposit (A26: not charged by V4P). */
export interface ReservationEmailDeposit {
  required: boolean | null;
  amount_cents: number | null;
  message: string | null;
}

export interface ReservationEmailDog {
  name: string | null;
  weight_kg: number;
  size: string | null;
  is_ppp: boolean;
}

export interface ReservationEmailPayload {
  reservation_id: number;
  guest_name?: string;
  guest_email?: string;
  guest_phone?: string;
  checkin?: string;
  checkout?: string;
  guests?: number;
  pets?: number;
  total?: number;
  site_id?: number;
  site_name?: string;
  host_email?: string;
  admin_email?: string;
  cancel_reason?: string;
  feedback_url?: string;
  feedback_deadline_at?: string;
  report_reason?: string;
  comment?: string;
  error_message?: string;
  /** No-show: host note, resolution note and refunded amount. */
  note?: string;
  refund_cents?: number;
  rating?: number;
  refund?: boolean;
  /** F2 confirmation breakdown (only when the reservation has a snapshot). */
  price_lines?: ReservationEmailPriceLine[];
  total_cents?: number;
  deposit?: ReservationEmailDeposit | null;
  dogs?: ReservationEmailDog[];
}

export interface BuiltReservationEmail {
  to: string;
  subject: string;
  html: string;
  roleLabel: string;
  /** Plain-text alternative (incident chat emails). */
  text?: string;
}

/** Recipient-specific templates of the incident chat. */
export const INCIDENT_MESSAGE_EMAIL = {
  ADMIN: "incident_message_admin",
  TRAVELER: "incident_message_traveler",
} as const;

export type IncidentMessageEmailType =
  (typeof INCIDENT_MESSAGE_EMAIL)[keyof typeof INCIDENT_MESSAGE_EMAIL];

/**
 * What produced the email: a chat message (traveler or V4P), the incident
 * creation (traveler copy), a V4P status note (needs_info / in_review) or the
 * resolution note.
 */
export const INCIDENT_MESSAGE_EVENT = {
  OPENED: "opened",
  MESSAGE: "message",
  STATUS_NOTE: "status_note",
  RESOLVED: "resolved",
} as const;

export type IncidentMessageEvent =
  (typeof INCIDENT_MESSAGE_EVENT)[keyof typeof INCIDENT_MESSAGE_EVENT];

/** Payload of the incident chat emails (all user text is escaped by the template). */
export interface IncidentMessageEmailPayload {
  incident_id: number;
  reservation_id: number;
  incident_type: string;
  incident_status: string;
  event: IncidentMessageEvent;
  /** "traveler" | "admin" (who wrote the message). */
  author: string;
  body: string;
  site_name: string | null;
  site_town: string | null;
  checkin: string | null;
  checkout: string | null;
  traveler_name: string | null;
  traveler_email: string;
  admin_email: string;
  /** Backoffice actor that wrote the V4P message (admin copy only). */
  actor_name: string | null;
  panel_url: string;
  admin_url: string;
}
