import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import { ACTOR_TYPES, type ActorType } from "../domain/audit-actor";
import {
  REFUND_RESPONSIBLES,
  REFUND_STATUSES,
  type RefundResponsible,
  type RefundStatus,
} from "../domain/refund-state-machine";

/**
 * Refund operation (B2/B4). Completion is driven by Stripe webhooks
 * (refund.created / refund.updated / refund.failed), never assumed.
 */
@Entity("refunds")
@Index("idx_refunds_reservation", ["reservation_id"])
@Index("idx_refunds_payment", ["payment_id"])
@Index("uq_refunds_idempotency_key", ["idempotency_key"], { unique: true })
@Index("uq_refunds_stripe_refund", ["stripe_refund_id"], { unique: true })
export class RefundEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  reservation_id!: number;

  @Column({ type: "int", nullable: true })
  payment_id?: number | null;

  @Column({ type: "enum", enum: REFUND_STATUSES })
  status!: RefundStatus;

  @Column({ type: "int" })
  amount_cents!: number;

  @Column({ type: "char", length: 3, default: "eur" })
  currency!: string;

  @Column({ type: "varchar", length: 128, nullable: true })
  reason?: string | null;

  @Column({ type: "enum", enum: ACTOR_TYPES, nullable: true })
  requested_by_type?: ActorType | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  requested_by_id?: string | null;

  @Column({ type: "enum", enum: ACTOR_TYPES, nullable: true })
  approved_by_type?: ActorType | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  approved_by_id?: string | null;

  @Column({ type: "enum", enum: REFUND_RESPONSIBLES, nullable: true })
  responsible?: RefundResponsible | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  stripe_refund_id?: string | null;

  @Column({ type: "varchar", length: 255 })
  idempotency_key!: string;

  @Column({ type: "text", nullable: true })
  failure_reason?: string | null;

  @Column({ type: "datetime", nullable: true })
  completed_at?: Date | null;

  @CreateDateColumn({ type: "datetime", precision: 6 })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime", precision: 6 })
  updated_at!: Date;
}
