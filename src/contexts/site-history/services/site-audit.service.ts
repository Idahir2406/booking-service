import type { Actor } from "@/contexts/payments/domain/audit-actor";

import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import {
  AUDIT_ENTITY,
  AuditLogEntity,
} from "@/contexts/payments/entities/audit-log.entity";
import { toAuditRow } from "@/contexts/payments/services/audit-log.service";

import {
  diffForAudit,
  type FieldDiff,
  type SiteAuditAction,
  type SiteAuditSource,
} from "../utils/site-change.util";

export interface SiteChange {
  siteId: number;
  action: SiteAuditAction;
  actor: Actor;
  source: SiteAuditSource;
  before?: unknown;
  after?: unknown;
  /** Extra context (room id/name, admin name...). Never secrets. */
  metadata?: Record<string, unknown>;
  /** Write even when no field changed (e.g. publish, terms accepted). */
  always?: boolean;
}

/**
 * Writes accommodation changes to audit_log (entity "site"). Best effort:
 * runs after the change committed and never throws, so a failing audit can
 * not break the host's save.
 */
@Injectable()
export class SiteAuditService {
  private readonly logger = new Logger(SiteAuditService.name);

  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly repository: Repository<AuditLogEntity>,
  ) {}

  async record(change: SiteChange): Promise<boolean> {
    try {
      const diff: FieldDiff | null =
        diffForAudit(change.before, change.after) ??
        (change.always ? { before: {}, after: {} } : null);
      if (!diff) {
        return false;
      }
      await this.repository.insert(
        toAuditRow({
          entity: AUDIT_ENTITY.SITE,
          entityId: change.siteId,
          action: change.action,
          actor: change.actor,
          before: diff.before,
          after: diff.after,
          metadata: { source: change.source, ...change.metadata },
        }),
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Could not write site audit ${change.action} for site ${change.siteId}`,
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  /**
   * Reads the state, runs the mutation, reads the state again and records the
   * diff. The mutation result is returned untouched; a failing read only
   * skips the audit.
   */
  async track<T>(
    change: Omit<SiteChange, "before" | "after">,
    read: () => Promise<unknown>,
    mutate: () => Promise<T>,
  ): Promise<T> {
    const before = await this.safeRead(read);
    const result = await mutate();
    const after = await this.safeRead(read);
    if (before !== undefined || after !== undefined) {
      await this.record({ ...change, before, after });
    }
    return result;
  }

  private async safeRead(read: () => Promise<unknown>): Promise<unknown> {
    try {
      return await read();
    } catch {
      return undefined;
    }
  }
}
