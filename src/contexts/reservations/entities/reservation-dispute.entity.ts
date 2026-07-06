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

@Entity("reservation_disputes")
@Index("idx_disputes_reservation", ["reservation_id"])
export class ReservationDisputeEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  reservation_id!: number;

  @Column({ type: "enum", enum: dispute_status_values, default: "open" })
  status!: DisputeStatusValue;

  @Column({ type: "text", nullable: true })
  guest_report?: string;

  @Column({ type: "text", nullable: true })
  admin_notes?: string;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
