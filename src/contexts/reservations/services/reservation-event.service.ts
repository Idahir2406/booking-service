import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { ReservationEventEntity } from "../entities/reservation-event.entity";

@Injectable()
export class ReservationEventService {
  private readonly logger = new Logger(ReservationEventService.name);

  constructor(
    @InjectRepository(ReservationEventEntity)
    private readonly eventRepository: Repository<ReservationEventEntity>,
  ) {}

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
}
