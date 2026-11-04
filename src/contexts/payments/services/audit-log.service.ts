import type { Actor } from "../domain/audit-actor";

import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

import { AuditLogEntity } from "../entities/audit-log.entity";

export interface AuditEntry {
  entity: string;
  entityId: number | string;
  action: string;
  actor: Actor;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export function toAuditRow(
  entry: AuditEntry,
): QueryDeepPartialEntity<AuditLogEntity> {
  const row: Partial<AuditLogEntity> = {
    entity: entry.entity,
    entity_id: String(entry.entityId),
    action: entry.action,
    actor_type: entry.actor.type,
    actor_id: entry.actor.id,
    before: entry.before ?? null,
    after: entry.after ?? null,
    metadata: entry.metadata ?? null,
  };
  // JSON columns: TypeORM's deep-partial typing does not model them.
  return row as QueryDeepPartialEntity<AuditLogEntity>;
}

/**
 * Append-only audit log (B1/B14). Only INSERTs: there is intentionally no
 * update/delete method. Use `record(manager, ...)` inside the transaction
 * that performs the change (commits/rolls back together); use
 * `recordDetached` for things that must survive a rollback (rejected
 * transitions, failed payouts).
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly repository: Repository<AuditLogEntity>,
  ) {}

  async record(manager: EntityManager, entry: AuditEntry): Promise<void> {
    const repository = manager.getRepository(AuditLogEntity);
    await repository.insert(toAuditRow(entry));
  }

  /** Own connection, never throws (best effort, outside any transaction). */
  async recordDetached(entry: AuditEntry): Promise<void> {
    try {
      await this.repository.insert(toAuditRow(entry));
    } catch (error) {
      this.logger.warn(
        `Could not write audit ${entry.entity}#${String(entry.entityId)} ${entry.action}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
