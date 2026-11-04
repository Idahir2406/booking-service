import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

export const SNAPSHOT_REASON = {
  CHECKOUT: "checkout",
  MANUAL_CREATE: "manual_create",
  LEGACY_BACKFILL: "legacy_backfill",
  /** F-PV7b (D-15): accepted change proposal (varchar column, no migration). */
  CHANGE_ACCEPTED: "change_accepted",
  /** F-PV7b: accepted accommodation alternative (PDF §10). */
  ALTERNATIVE_ACCEPTED: "alternative_accepted",
} as const;

export type SnapshotReason =
  (typeof SNAPSHOT_REASON)[keyof typeof SNAPSHOT_REASON];

/**
 * Economic/contractual snapshot (A10/B2). Append-only: a change creates
 * version n+1, the previous versions are never rewritten.
 */
@Entity("reservation_snapshots")
@Index("uq_reservation_snapshots_version", ["reservation_id", "version"], {
  unique: true,
})
export class ReservationSnapshotEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  reservation_id!: number;

  @Column({ type: "int" })
  version!: number;

  @Column({ type: "varchar", length: 64 })
  reason!: string;

  @Column({ type: "json" })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ type: "datetime", precision: 6 })
  created_at!: Date;
}
