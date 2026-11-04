import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import {
  INCIDENT_STATUS,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  type IncidentStatus,
  type IncidentType,
} from "../utils/reservation-incident.util";

/**
 * F-PV7a (D4): traveler incident ("Tengo un problema"). UI life cycle only;
 * money is held through the linked reservation_disputes row + payout_status
 * (blocks_payout = this incident asked for the held -> blocked transition).
 * user_id = v4p_juser_profiles.id WITHOUT FK (legacy table owned by PHP).
 */
@Entity("reservation_incidents")
@Index("idx_incidents_reservation", ["reservation_id", "status"])
@Index("idx_incidents_user", ["user_id", "created_at"])
@Index("idx_incidents_dispute", ["dispute_id"])
export class ReservationIncidentEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  reservation_id!: number;

  @Column({ type: "int" })
  user_id!: number;

  @Column({ type: "enum", enum: INCIDENT_TYPES })
  type!: IncidentType;

  @Column({
    type: "enum",
    enum: INCIDENT_STATUSES,
    default: INCIDENT_STATUS.RECEIVED,
  })
  status!: IncidentStatus;

  @Column({ type: "text" })
  description!: string;

  @Column({ type: "int", nullable: true })
  dispute_id!: number | null;

  @Column({ type: "boolean", default: false })
  blocks_payout!: boolean;

  @Column({ type: "text", nullable: true })
  resolution_note!: string | null;

  @Column({ type: "datetime", nullable: true })
  resolved_at!: Date | null;

  @CreateDateColumn({ type: "datetime", precision: 6 })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime", precision: 6 })
  updated_at!: Date;
}
