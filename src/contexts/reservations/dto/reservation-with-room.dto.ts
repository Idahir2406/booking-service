export interface ReservationWithRoomName {
  id: number;
  site_id: number;
  room_id: string;
  room_name: string | null;
  source: string;
  external_reservation_id?: string;
  user_id: number;
  guest_name?: string;
  guest_email?: string;
  guest_phone?: string;
  guest_notes?: string;
  checkin: string;
  checkout: string;
  guests: number;
  pets: number;
  subtotal: number | null;
  commission: number | null;
  total: number | null;
  status: string;
  payment_status: string;
  expiration_date: Date;
  stripe_checkout_session_id?: string;
  stripe_payment_intent_id?: string;
  paid_at?: Date;
  created_at: Date;
  updated_at: Date;
}
