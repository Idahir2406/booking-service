import type { Actor } from "../domain/audit-actor";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";

import {
  type PriceLineDraft,
  type PriceLinesSummary,
  summarizePriceLines,
  validatePriceLine,
} from "../domain/price-lines";
import { AUDIT_ENTITY } from "../entities/audit-log.entity";
import { ReservationPriceLineEntity } from "../entities/reservation-price-line.entity";
import { AuditLogService } from "./audit-log.service";

/**
 * Immutable price lines. Only INSERT: an adjustment is a new line
 * (negative allowed for discount/adjustment), never an UPDATE.
 */
@Injectable()
export class PriceLinesService {
  constructor(
    @InjectRepository(ReservationPriceLineEntity)
    private readonly repository: Repository<ReservationPriceLineEntity>,
    private readonly auditLogService: AuditLogService,
  ) {}

  async addLines(
    manager: EntityManager,
    reservationId: number,
    lines: readonly PriceLineDraft[],
    currency: string,
    actor: Actor,
    action = "price_lines.added",
  ): Promise<ReservationPriceLineEntity[]> {
    if (lines.length === 0) {
      return [];
    }
    for (const line of lines) {
      validatePriceLine(line);
    }
    const repository = manager.getRepository(ReservationPriceLineEntity);
    const rows = lines.map(line =>
      repository.create({
        reservation_id: reservationId,
        type: line.type,
        description: line.description.slice(0, 255),
        quantity: line.quantity,
        unit_amount_cents: line.unit_amount_cents,
        amount_cents: line.amount_cents,
        currency,
        is_optional: line.is_optional,
        is_commissionable: line.is_commissionable,
        is_penalizable: line.is_penalizable,
        metadata: line.metadata ?? null,
        created_by_type: actor.type,
        created_by_id: actor.id,
      }),
    );
    const saved = await repository.save(rows);
    await this.auditLogService.record(manager, {
      entity: AUDIT_ENTITY.PRICE_LINE,
      entityId: reservationId,
      action,
      actor,
      after: {
        lines: lines.map(line => ({
          type: line.type,
          amount_cents: line.amount_cents,
        })),
        totals: { ...summarizePriceLines(lines) },
      },
    });
    return saved;
  }

  async findByReservation(
    reservationId: number,
    manager?: EntityManager,
  ): Promise<ReservationPriceLineEntity[]> {
    const repository = manager
      ? manager.getRepository(ReservationPriceLineEntity)
      : this.repository;
    return repository.find({
      where: { reservation_id: reservationId },
      order: { id: "ASC" },
    });
  }

  async summarize(
    reservationId: number,
    manager?: EntityManager,
  ): Promise<PriceLinesSummary> {
    return summarizePriceLines(
      await this.findByReservation(reservationId, manager),
    );
  }
}
