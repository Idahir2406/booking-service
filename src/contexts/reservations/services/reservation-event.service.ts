import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, MoreThanOrEqual, Repository } from "typeorm";

import { ReservationEventEntity } from "../entities/reservation-event.entity";

@Injectable()
export class ReservationEventService {
  private readonly logger = new Logger(ReservationEventService.name);

  constructor(
    @InjectRepository(ReservationEventEntity)
    private readonly eventRepository: Repository<ReservationEventEntity>,
  ) {}

  /** Best-effort audit log outside a transaction (never throws). */
  async logEvent(
    reservationId: number,
    eventType: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const event = this.eventRepository.create({
        reservation_id: reservationId,
        event_type: eventType,
        payload,
      });
      await this.eventRepository.save(event);
    } catch (error) {
      this.logger.warn(
        `Failed to log event ${eventType} for reservation ${reservationId}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Audit event written inside the caller's transaction: it commits/rolls
   * back together with the money-moving change it describes (F0).
   */
  async logEventInTransaction(
    manager: EntityManager,
    reservationId: number,
    eventType: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    const repository = manager.getRepository(ReservationEventEntity);
    await repository.save(
      repository.create({
        reservation_id: reservationId,
        event_type: eventType,
        payload,
      }),
    );
  }

  async hasRecentEvent(
    reservationId: number,
    eventType: string,
    since: Date,
  ): Promise<boolean> {
    const count = await this.eventRepository.count({
      where: {
        reservation_id: reservationId,
        event_type: eventType,
        created_at: MoreThanOrEqual(since),
      },
    });
    return count > 0;
  }
}
