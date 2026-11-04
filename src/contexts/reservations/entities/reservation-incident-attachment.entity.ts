import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

import {
  INCIDENT_AUTHOR,
  INCIDENT_AUTHORS,
  type IncidentAuthor,
} from "../utils/reservation-incident.util";

/**
 * F-PV7a (D5): metadata of a file kept by PHP outside the public web root.
 * storage_key is the random file name only (never a path); the file is served
 * by the PHP proxy after this API confirms ownership.
 */
@Entity("reservation_incident_attachments")
@Index("idx_incident_attachments_incident", ["incident_id"])
@Index("uq_incident_attachments_storage_key", ["storage_key"], {
  unique: true,
})
export class ReservationIncidentAttachmentEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  incident_id!: number;

  @Column({ type: "varchar", length: 128 })
  storage_key!: string;

  @Column({ type: "varchar", length: 255 })
  original_name!: string;

  @Column({ type: "varchar", length: 64 })
  mime!: string;

  @Column({ type: "int" })
  size_bytes!: number;

  @Column({
    type: "enum",
    enum: INCIDENT_AUTHORS,
    default: INCIDENT_AUTHOR.TRAVELER,
  })
  uploaded_by!: IncidentAuthor;

  @CreateDateColumn({ type: "datetime", precision: 6 })
  created_at!: Date;
}
