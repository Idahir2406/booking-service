import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

export const feedback_type_values = ["review", "report"] as const;
export type FeedbackTypeValue = (typeof feedback_type_values)[number];

@Entity("reservation_guest_feedback")
@Index("idx_guest_feedback_reservation", ["reservation_id"], { unique: true })
export class ReservationGuestFeedbackEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  reservation_id!: number;

  @Column({ type: "enum", enum: feedback_type_values })
  type!: FeedbackTypeValue;

  @Column({ type: "int", nullable: true })
  rating?: number;

  @Column({ type: "text", nullable: true })
  comment?: string;

  @Column({ type: "text", nullable: true })
  report_reason?: string;

  @CreateDateColumn()
  created_at!: Date;
}
