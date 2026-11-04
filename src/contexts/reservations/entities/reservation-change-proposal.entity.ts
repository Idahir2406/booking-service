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
 * F-PV7b: V4P proposal answering a change request (D9: internal route only).
 * before/after are frozen at creation; accepting never reprices. Applying it
 * writes snapshot version n+1 (resulting_snapshot_version) linked to
 * based_on_snapshot_version; older snapshot rows are never touched.
 */
@Entity("reservation_change_proposals")
@Index("idx_change_proposals_request", ["request_id", "status"])
@Index("idx_change_proposals_reservation", ["reservation_id", "status"])
export class ReservationChangeProposalEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  request_id!: number;

  @Column({ type: "int" })
  reservation_id!: number;

  @Column({ type: "json" })
  before_payload!: ChangeBasePayload;

  @Column({ type: "json" })
  after_payload!: ChangeOfferPayload;

  /** after.total_cents - before.total_cents (D8: > 0 not acceptable in V1). */
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

  @Column({ type: "int" })
  based_on_snapshot_version!: number;

  @Column({ type: "int", nullable: true })
  resulting_snapshot_version!: number | null;

  /** Applicable conditions shown with the proposal. */
  @Column({ type: "text", nullable: true })
  conditions!: string | null;

  @Column({ type: "text", nullable: true })
  message!: string | null;

  /** Why it ended expired (expired | unavailable | outdated | ...). */
  @Column({ type: "varchar", length: 64, nullable: true })
  close_reason!: string | null;

  @Column({ type: "datetime", nullable: true })
  responded_at!: Date | null;

  @CreateDateColumn({ type: "datetime", precision: 6 })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime", precision: 6 })
  updated_at!: Date;
}
