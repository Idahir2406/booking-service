import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

import { ACTOR_TYPES, type ActorType } from "../domain/audit-actor";

export const AUDIT_ENTITY = {
  RESERVATION: "reservation",
  PAYMENT: "payment",
  REFUND: "refund",
  PAYOUT: "payout",
  PRICE_LINE: "price_line",
  SNAPSHOT: "snapshot",
  DISPUTE: "dispute",
  PLATFORM_SETTING: "platform_setting",
} as const;

export type AuditEntityName = (typeof AUDIT_ENTITY)[keyof typeof AUDIT_ENTITY];

/** Append-only audit trail (B1/B14). No update/delete path exists in code. */
@Entity("audit_log")
@Index("idx_audit_log_entity", ["entity", "entity_id"])
@Index("idx_audit_log_created_at", ["created_at"])
export class AuditLogEntity {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id!: string;

  @Column({ type: "varchar", length: 32 })
  entity!: string;

  @Column({ type: "varchar", length: 64 })
  entity_id!: string;

  @Column({ type: "varchar", length: 64 })
  action!: string;

  @Column({ type: "enum", enum: ACTOR_TYPES })
  actor_type!: ActorType;

  @Column({ type: "varchar", length: 64, nullable: true })
  actor_id?: string | null;

  @Column({ type: "json", nullable: true })
  before?: Record<string, unknown> | null;

  @Column({ type: "json", nullable: true })
  after?: Record<string, unknown> | null;

  @Column({ type: "json", nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn({ type: "datetime", precision: 6 })
  created_at!: Date;
}
