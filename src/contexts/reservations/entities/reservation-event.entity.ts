import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity("reservation_events")
@Index("idx_reservation_events_reservation", ["reservation_id"])
export class ReservationEventEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  reservation_id!: number;

  @Column({ type: "text" })
  event_type!: string;

  @Column({ type: "jsonb", nullable: true })
  payload?: Record<string, unknown>;

  @CreateDateColumn()
  created_at!: Date;
}
