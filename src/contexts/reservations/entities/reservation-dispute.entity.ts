import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export const dispute_status_values = [
  "open",
  "resolved_release",
  "resolved_refund",
] as const;
export type DisputeStatusValue = (typeof dispute_status_values)[number];

/** guest_report = feedback "report" flow; stripe = chargeback (charge.dispute.*). */
export const dispute_source_values = ["guest_report", "stripe"] as const;
export type DisputeSourceValue = (typeof dispute_source_values)[number];

@Entity("reservation_disputes")
@Index("idx_disputes_reservation", ["reservation_id"])
@Index("uq_disputes_stripe_dispute", ["stripe_dispute_id"], { unique: true })
export class ReservationDisputeEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  reservation_id!: number;

  @Column({ type: "enum", enum: dispute_status_values, default: "open" })
  status!: DisputeStatusValue;

  @Column({
    type: "enum",
    enum: dispute_source_values,
    default: "guest_report",
  })
  source!: DisputeSourceValue;

  @Column({ type: "varchar", length: 255, nullable: true })
  stripe_dispute_id?: string | null;

  /** Raw Stripe dispute status (needs_response, won, lost, ...). */
  @Column({ type: "varchar", length: 64, nullable: true })
  stripe_status?: string | null;

  @Column({ type: "datetime", nullable: true })
  closed_at?: Date | null;

  @Column({ type: "text", nullable: true })
  guest_report?: string;

  @Column({ type: "text", nullable: true })
  admin_notes?: string;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
