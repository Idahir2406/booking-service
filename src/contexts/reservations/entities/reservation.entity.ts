import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import { decimalTransformer } from "../../payments/entities/decimal.transformer";

export interface ReservationBoardSnapshot {
  code: string;
  name: string;
  description: string | null;
  is_included: boolean;
  price: number;
  board_amount: number;
}

export const source_values = ["internal", "airbnb", "booking", "vrbo"] as const;
export type SourceValue = (typeof source_values)[number];
export const status_values = [
  "pending",
  "confirmed",
  "cancelled",
  "finalized",
] as const;
export type StatusValue = (typeof status_values)[number];
export const payment_status_values = [
  "pending",
  "paid",
  "refunded",
  "partially_refunded",
] as const;
export type PaymentStatusValue = (typeof payment_status_values)[number];
export const charge_mode_values = ["immediate", "flexible"] as const;
export type ChargeModeValue = (typeof charge_mode_values)[number];
export const payout_status_values = ["held", "released", "blocked"] as const;
export type PayoutStatusValue = (typeof payout_status_values)[number];

@Entity("reservations")
@Index("idx_reservations_site_room", ["site_id", "room_id"])
@Index("idx_reservations_user_checkin", ["user_id", "checkin"])
@Index("idx_reservations_deferred_charge", [
  "charge_mode",
  "payment_status",
  "charge_at",
])
export class ReservationEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  site_id!: number;

  @Column({ type: "int" })
  room_id!: number;

  @Column({ type: "int", nullable: true })
  board_option_id?: number;

  @Column({ type: "json", nullable: true })
  board_snapshot?: ReservationBoardSnapshot;

  @Column({ type: "json", nullable: true })
  extras_snapshot?: unknown;

  @Column({ type: "enum", enum: source_values })
  source!: SourceValue;

  @Column({ type: "text", nullable: true })
  external_reservation_id?: string;

  @Column({ type: "int" })
  user_id!: number;

  @Column({ type: "text", nullable: true })
  guest_name?: string;

  @Column({ type: "text", nullable: true })
  guest_email?: string;

  @Column({ type: "text", nullable: true })
  guest_phone?: string;

  @Column({ type: "text", nullable: true })
  guest_notes?: string;

  @Column({ type: "date" })
  checkin!: string;

  @Column({ type: "date" })
  checkout!: string;

  @Column({ type: "int" })
  guests!: number;

  @Column({ type: "int" })
  pets!: number;

  @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
  subtotal!: number;

  @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
  commission!: number;

  @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
  total!: number;

  @Column({ type: "enum", enum: status_values })
  status!: StatusValue;

  @Column({ type: "enum", enum: payment_status_values })
  payment_status!: PaymentStatusValue;

  /**
   * When the traveler is charged. `immediate` blocks inventory only after
   * Stripe confirms. `flexible` (Fase 4): Checkout in `setup` mode saves the
   * card, the reservation is confirmed (nights blocked) and the cron charges
   * it off-session at `charge_at`.
   */
  @Column({ type: "enum", enum: charge_mode_values, default: "immediate" })
  charge_mode!: ChargeModeValue;

  /** Fase 4: Stripe customer that owns the saved card (flexible). */
  @Column({ type: "varchar", length: 255, nullable: true })
  stripe_customer_id?: string | null;

  /** Fase 4: card saved by the setup session, charged off-session. */
  @Column({ type: "varchar", length: 255, nullable: true })
  stripe_payment_method_id?: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  stripe_setup_intent_id?: string | null;

  /** Fase 4: instant of the deferred charge (UTC). null = immediate. */
  @Column({ type: "datetime", nullable: true })
  charge_at?: Date | null;

  /**
   * Fase 4: the off-session charge failed; the traveler can pay until then.
   * Past it the reservation is cancelled (deferred_charge_unpaid).
   */
  @Column({ type: "datetime", nullable: true })
  regularization_deadline_at?: Date | null;

  @Column({
    type: "enum",
    enum: payout_status_values,
    nullable: true,
  })
  payout_status?: PayoutStatusValue;

  @Column({ type: "timestamp", nullable: true })
  finalized_at?: Date;

  @Column({ type: "timestamp", nullable: true })
  feedback_deadline_at?: Date;

  @Column({ type: "timestamp", nullable: true })
  payout_released_at?: Date;

  @Column({ type: "text", nullable: true })
  stripe_transfer_id?: string;

  @Column({ type: "text", nullable: true })
  stripe_refund_id?: string;

  /** Number of refunds WE created; drives the idempotency key refund:{id}:{n}. */
  @Column({ type: "int", default: 0 })
  refund_seq!: number;

  /** Amount refunded according to Stripe (charge.amount_refunded / 100). */
  @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
  amount_refunded?: number | null;

  @Column({ type: "timestamp", nullable: true })
  cancelled_at?: Date | null;

  @Column({ type: "text", nullable: true })
  cancel_reason?: string | null;

  @Column({ type: "boolean", nullable: true })
  refund_on_cancel?: boolean;

  @Column({ type: "timestamp" })
  expiration_date!: Date;

  @Column({ type: "text", nullable: true })
  stripe_checkout_session_id?: string;

  @Column({ type: "text", nullable: true })
  stripe_payment_intent_id?: string;

  @Column({ type: "timestamp", nullable: true })
  paid_at?: Date;

  // --- F1 economic model (frozen at creation; see payments context) ---------
  // NOTE: `commission` above is the legacy traveler-side surcharge (always 0,
  // part of the charged amount). `commission_*` below is the V4P platform fee
  // retained from the host payout (A2), frozen when the reservation is created.

  /** Platform commission rate frozen at creation (0.1200 = 12 %). */
  @Column({
    type: "decimal",
    precision: 5,
    scale: 4,
    nullable: true,
    transformer: decimalTransformer,
  })
  commission_rate?: number | null;

  /** Platform fee in cents frozen at creation (F1: round(rate x total)). */
  @Column({ type: "int", nullable: true })
  commission_cents?: number | null;

  /** Amount charged to the traveler, in cents (mirror of `total`). */
  @Column({ type: "int", nullable: true })
  total_cents?: number | null;

  @Column({ type: "char", length: 3, nullable: true })
  currency?: string | null;

  /** Latest reservation_snapshots.version for this reservation. */
  @Column({ type: "int", nullable: true })
  snapshot_version?: number | null;

  /** Cribs requested by the traveler (0 = none). */
  @Column({ type: "smallint", default: 0 })
  cribs?: number;

  /** Traveler's estimated arrival time ("HH:MM:SS", local), optional. */
  @Column({ type: "time", nullable: true })
  arrival_time?: string | null;

  /**
   * Site check-out time frozen at booking (also in snapshot.schedule); used
   * by the finalize window (reservation-policy.util).
   */
  @Column({ type: "time", nullable: true })
  checkout_until?: string | null;

  /** Timezone applicable to deadlines (A6/A10). */
  @Column({ type: "varchar", length: 64, nullable: true })
  timezone?: string | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
