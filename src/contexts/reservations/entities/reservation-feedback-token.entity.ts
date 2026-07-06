import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity("reservation_feedback_tokens")
@Index("idx_feedback_tokens_reservation", ["reservation_id"])
export class ReservationFeedbackTokenEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  reservation_id!: number;

  @Column({ type: "text" })
  token_hash!: string;

  @Column({ type: "timestamp" })
  expires_at!: Date;

  @Column({ type: "timestamp", nullable: true })
  used_at?: Date;

  @CreateDateColumn()
  created_at!: Date;
}
