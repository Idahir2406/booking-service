import type {
  PaymentStatusValue,
  StatusValue,
} from "../entities/reservation.entity";

/**
 * Traveler-facing summary for the post-checkout success page. Only returned
 * when the caller proves possession of the Stripe Checkout Session id
 * (?session_id=cs_...), and without guest PII or host/payout data (F0).
 */
export class ReservationPublicSummaryDto {
  id!: number;
  code!: string;
  status!: StatusValue;
  payment_status!: PaymentStatusValue;
  checkin!: string;
  checkout!: string;
  total!: number | null;
}
