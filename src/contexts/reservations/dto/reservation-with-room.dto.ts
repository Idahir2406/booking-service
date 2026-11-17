import type { ReservationBoardSnapshot } from "../entities/reservation.entity";
import type { ReservationPolicyCapabilities } from "../utils/reservation-policy.util";

export interface ReservationWithRoomName extends ReservationPolicyCapabilities {
  id: number;
  site_id: number;
  room_id: number;
  room_name: string | null;
  source: string;
  external_reservation_id?: string;
  user_id: number;
  guest_name?: string;
  guest_email?: string;
  guest_phone?: string;
  guest_notes?: string;
  /** Cribs requested by the traveler (0 = none). */
  cribs?: number;
  /** Traveler's estimated arrival ("HH:MM:SS"), optional. */
  arrival_time?: string | null;
  /** Site check-out time frozen at booking ("HH:MM:SS"). */
  checkout_until?: string | null;
  checkin: string;
  checkout: string;
  guests: number;
  pets: number;
  board_option_id?: number;
  board_snapshot?: ReservationBoardSnapshot | null;
  extras_snapshot?: unknown;
  subtotal: number | null;
  commission: number | null;
  total: number | null;
  nights?: number;
  base_subtotal?: number | null;
  status: string;
  payment_status: string;
  payout_status?: string | null;
  finalized_at?: Date | null;
  feedback_deadline_at?: Date | null;
  payout_released_at?: Date | null;
  cancelled_at?: Date | null;
  cancel_reason?: string | null;
  refund_on_cancel?: boolean | null;
  expiration_date: Date;
  stripe_checkout_session_id?: string;
  stripe_payment_intent_id?: string;
  stripe_transfer_id?: string | null;
  paid_at?: Date;
  created_at: Date;
  updated_at: Date;
  /** Host may "Comunicar imposibilidad de alojar" (no open request, before check-out). */
  can_report_cannot_host: boolean;
  /** An imposibilidad de alojar request is under V4P review. */
  cannot_host_pending: boolean;
}
