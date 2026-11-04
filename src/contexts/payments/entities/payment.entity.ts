import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import {
  PAYMENT_STATUSES,
  PAYMENT_TYPES,
  type PaymentStatus,
  type PaymentType,
} from "../domain/payment-state-machine";

/**
 * Charge to the traveler (B2/B3). Status only changes through
 * paymentStateMachine (PaymentLedgerService); every change is audited.
 */
@Entity("payments")
@Index("idx_payments_reservation", ["reservation_id"])
@Index("uq_payments_idempotency_key", ["idempotency_key"], { unique: true })
@Index("idx_payments_payment_intent", ["stripe_payment_intent_id"])
@Index("idx_payments_checkout_session", ["stripe_checkout_session_id"])
export class PaymentEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  reservation_id!: number;

  @Column({ type: "enum", enum: PAYMENT_TYPES, default: "charge" })
  type!: PaymentType;

  @Column({ type: "enum", enum: PAYMENT_STATUSES })
  status!: PaymentStatus;

  @Column({ type: "int" })
  amount_cents!: number;

  @Column({ type: "char", length: 3, default: "eur" })
  currency!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  stripe_checkout_session_id?: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  stripe_payment_intent_id?: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  stripe_charge_id?: string | null;

  @Column({ type: "varchar", length: 255 })
  idempotency_key!: string;

  @Column({ type: "varchar", length: 128, nullable: true })
  failure_code?: string | null;

  @Column({ type: "text", nullable: true })
  failure_message?: string | null;

  @Column({ type: "int", default: 0 })
  attempts!: number;

  @Column({ type: "datetime", nullable: true })
  paid_at?: Date | null;

  @CreateDateColumn({ type: "datetime", precision: 6 })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime", precision: 6 })
  updated_at!: Date;
}
