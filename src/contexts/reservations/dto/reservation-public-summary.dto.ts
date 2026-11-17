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
  /**
   * Fase 5: cancellation policy text frozen in the snapshot (structured
   * policies only; null for legacy reservations).
   */
  policy_text!: string | null;
  /** Fase 5: "immediate" (legacy / charged now) or "flexible" (deferred). */
  charge_mode!: "immediate" | "flexible";
  /** Fase 5: deferred charge instant while nothing has been charged yet. */
  charge_at_iso!: string | null;
  /** Fase 5: site timezone used to show charge_at_iso. */
  timezone!: string | null;
}
