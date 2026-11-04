import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

import {
  INCIDENT_AUTHORS,
  type IncidentAuthor,
} from "../utils/reservation-incident.util";

/** F-PV7a: thread "Necesitamos información" (admin) <-> answer (traveler). */
@Entity("reservation_incident_messages")
@Index("idx_incident_messages_incident", ["incident_id"])
export class ReservationIncidentMessageEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  incident_id!: number;

  @Column({ type: "enum", enum: INCIDENT_AUTHORS })
  author_type!: IncidentAuthor;

  @Column({ type: "text" })
  body!: string;

  @CreateDateColumn({ type: "datetime", precision: 6 })
  created_at!: Date;
}
