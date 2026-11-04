import type { Actor } from "../domain/audit-actor";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";

import { ReservationEntity } from "../../reservations/entities/reservation.entity";
import { actors } from "../domain/audit-actor";
import { AUDIT_ENTITY } from "../entities/audit-log.entity";
import { ReservationSnapshotEntity } from "../entities/reservation-snapshot.entity";
import { AuditLogService } from "./audit-log.service";

const MAX_VERSION_RETRIES = 3;

function isDuplicateKeyError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const errno = (error as { errno?: number } | null)?.errno;
  return code === "ER_DUP_ENTRY" || errno === 1062;
}

/**
 * Append-only reservation snapshots (A10). `createSnapshot` computes
 * version = MAX(version) + 1 and INSERTs; the unique
 * (reservation_id, version) index turns a concurrent writer into a retry,
 * never an overwrite. There is no update method on purpose.
 */
@Injectable()
export class ReservationSnapshotService {
  constructor(
    @InjectRepository(ReservationSnapshotEntity)
    private readonly repository: Repository<ReservationSnapshotEntity>,
    private readonly auditLogService: AuditLogService,
  ) {}

  async createSnapshot(
    reservationId: number,
    reason: string,
    payload: Record<string, unknown>,
    manager?: EntityManager,
    actor: Actor = actors.system(),
  ): Promise<ReservationSnapshotEntity> {
    if (manager) {
      return this.insertNextVersion(
        manager,
        reservationId,
        reason,
        payload,
        actor,
      );
    }
    return this.repository.manager.transaction(tx =>
      this.insertNextVersion(tx, reservationId, reason, payload, actor),
    );
  }

  async findLatest(
    reservationId: number,
    manager?: EntityManager,
  ): Promise<ReservationSnapshotEntity | null> {
    const repository = manager
      ? manager.getRepository(ReservationSnapshotEntity)
      : this.repository;
    return repository.findOne({
      where: { reservation_id: reservationId },
      order: { version: "DESC" },
    });
  }

  async findVersion(
    reservationId: number,
    version: number,
  ): Promise<ReservationSnapshotEntity | null> {
    return this.repository.findOne({
      where: { reservation_id: reservationId, version },
    });
  }

  private async insertNextVersion(
    manager: EntityManager,
    reservationId: number,
    reason: string,
    payload: Record<string, unknown>,
    actor: Actor,
  ): Promise<ReservationSnapshotEntity> {
    const repository = manager.getRepository(ReservationSnapshotEntity);
    for (let attempt = 1; ; attempt += 1) {
      const current =
        (await repository.maximum("version", {
          reservation_id: reservationId,
        })) ?? 0;
      const version = Number(current) + 1;
      try {
        const row = repository.create({
          reservation_id: reservationId,
          version,
          reason,
          payload,
        });
        const saved = await repository.save(row);
        await manager
          .getRepository(ReservationEntity)
          .update({ id: reservationId }, { snapshot_version: version });
        await this.auditLogService.record(manager, {
          entity: AUDIT_ENTITY.SNAPSHOT,
          entityId: reservationId,
          action: "snapshot.created",
          actor,
          after: { version, reason },
        });
        return saved;
      } catch (error) {
        if (!isDuplicateKeyError(error) || attempt >= MAX_VERSION_RETRIES) {
          throw error;
        }
      }
    }
  }
}
