import type {
  ChangeBasePayload,
  ChangeOfferPayload,
} from "../utils/reservation-change.util";

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import {
  CHANGE_OFFER_STATUS,
  CHANGE_OFFER_STATUSES,
  type ChangeOfferStatus,
} from "../utils/reservation-change.util";

/**
 * F-PV7b (PDF §10): the host cannot provide the stay; V4P presents an
 * alternative (other unit/site/dates). Never unilateral: only the traveler's
 * «Aceptar alternativa» applies it. Must be compatible with the declared dogs.
 */
@Entity("reservation_alternatives")
@Index("idx_alternatives_reservation", ["reservation_id", "status"])
export class ReservationAlternativeEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  reservation_id!: number;

  /** Incident that triggered it (§10 "handled as incident"), optional. */
  @Column({ type: "int", nullable: true })
  incident_id!: number | null;

  @Column({ type: "json" })
  before_payload!: ChangeBasePayload;

  @Column({ type: "json" })
  proposal_payload!: ChangeOfferPayload;

  @Column({ type: "int" })
  amount_delta_cents!: number;

  @Column({
    type: "enum",
    enum: CHANGE_OFFER_STATUSES,
    default: CHANGE_OFFER_STATUS.PENDING_TRAVELER,
  })
  status!: ChangeOfferStatus;

  @Column({ type: "datetime" })
  expires_at!: Date;

  @Column({ type: "boolean", nullable: true })
  compatible_with_dogs!: boolean | null;

  @Column({ type: "int" })
  based_on_snapshot_version!: number;

  @Column({ type: "int", nullable: true })
  resulting_snapshot_version!: number | null;

  @Column({ type: "text", nullable: true })
  conditions!: string | null;

  @Column({ type: "text", nullable: true })
  message!: string | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  close_reason!: string | null;

  @Column({ type: "datetime", nullable: true })
  responded_at!: Date | null;

  @CreateDateColumn({ type: "datetime", precision: 6 })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime", precision: 6 })
  updated_at!: Date;
}
