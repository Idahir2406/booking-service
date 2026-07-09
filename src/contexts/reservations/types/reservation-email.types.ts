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
  | "refund_processed_host";

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
  rating?: number;
  refund?: boolean;
}

export interface BuiltReservationEmail {
  to: string;
  subject: string;
  html: string;
  roleLabel: string;
}
