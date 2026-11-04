import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import {
  CHANGE_REQUEST_STATUS,
  CHANGE_REQUEST_STATUSES,
  CHANGE_REQUEST_TYPES,
  type ChangeRequestStatus,
  type ChangeRequestType,
} from "../utils/reservation-change.util";

/**
 * F-PV7b: "¿Necesitas cambiar tu reserva?". A request never modifies or
 * cancels the reservation; only an accepted proposal does (new snapshot).
 * user_id = v4p_juser_profiles.id WITHOUT FK (legacy table owned by PHP).
 */
@Entity("reservation_change_requests")
@Index("idx_change_requests_reservation", ["reservation_id", "status"])
@Index("idx_change_requests_user", ["user_id"])
export class ReservationChangeRequestEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  reservation_id!: number;

  @Column({ type: "int" })
  user_id!: number;

  @Column({ type: "enum", enum: CHANGE_REQUEST_TYPES })
  type!: ChangeRequestType;

  @Column({ type: "text", nullable: true })
  message!: string | null;

  @Column({
    type: "enum",
    enum: CHANGE_REQUEST_STATUSES,
    default: CHANGE_REQUEST_STATUS.RECEIVED,
  })
  status!: ChangeRequestStatus;

  /** V4P answer shown to the traveler (e.g. why it is not possible). */
  @Column({ type: "text", nullable: true })
  response_note!: string | null;

  @Column({ type: "datetime", nullable: true })
  closed_at!: Date | null;

  @CreateDateColumn({ type: "datetime", precision: 6 })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime", precision: 6 })
  updated_at!: Date;
}
