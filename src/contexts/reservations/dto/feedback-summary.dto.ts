export interface FeedbackSummaryDto {
  reservation_id: number;
  code: string;
  site_name: string;
  checkin: string;
  checkout: string;
  guest_name: string | null;
  status: string;
  payout_status: string | null;
  feedback_deadline_at: string | null;
  already_submitted: boolean;
  token_expired: boolean;
}
