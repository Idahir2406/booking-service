import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

/**
 * Stripe payout.failed on a host (connected) account: the bank rejected the
 * payout of the host's Stripe balance. Resolved by payout.paid on the same
 * account (punto 9).
 */
@Entity("host_payout_failures")
@Index("uq_host_payout_failures_payout", ["stripe_payout_id"], {
  unique: true,
})
@Index("idx_host_payout_failures_account", ["stripe_account_id", "resolved_at"])
@Index("idx_host_payout_failures_user", ["user_id", "resolved_at"])
export class HostPayoutFailureEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "varchar", length: 255 })
  stripe_account_id!: string;

  @Column({ type: "int", nullable: true })
  user_id?: number | null;

  @Column({ type: "varchar", length: 255 })
  stripe_payout_id!: string;

  @Column({ type: "int", default: 0 })
  amount_cents!: number;

  @Column({ type: "char", length: 3, default: "eur" })
  currency!: string;

  @Column({ type: "varchar", length: 128, nullable: true })
  failure_code?: string | null;

  @Column({ type: "text", nullable: true })
  failure_message?: string | null;

  @Column({ type: "datetime" })
  failed_at!: Date;

  @Column({ type: "datetime", nullable: true })
  escalated_at?: Date | null;

  @Column({ type: "datetime", nullable: true })
  resolved_at?: Date | null;

  @CreateDateColumn({ type: "datetime", precision: 6 })
  created_at!: Date;
}
