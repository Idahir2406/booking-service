import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import {
  AUDIT_ENTITY,
  AuditLogEntity,
} from "../../payments/entities/audit-log.entity";
import { ReservationEntity } from "../entities/reservation.entity";
import { ReservationEventEntity } from "../entities/reservation-event.entity";
import {
  buildReservationHistory,
  type HistoryAudience,
  type ReservationHistoryItem,
} from "../utils/reservation-history.util";

export interface ReservationHistoryDto {
  reservation_id: number;
  items: ReservationHistoryItem[];
}

/** Read-only activity history (host tab Reservas + admino). */
@Injectable()
export class ReservationHistoryService {
  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    @InjectRepository(ReservationEventEntity)
    private readonly eventRepository: Repository<ReservationEventEntity>,
  ) {}

  async getForHost(
    reservationId: number,
    siteId: number | undefined,
  ): Promise<ReservationHistoryDto> {
    const reservation = await this.findOrFail(reservationId);
    if (!siteId || siteId !== reservation.site_id) {
      throw new ForbiddenException("Site access denied");
    }
    return this.build(reservation.id, "host");
  }

  async getForAdmin(reservationId: number): Promise<ReservationHistoryDto> {
    const reservation = await this.findOrFail(reservationId);
    return this.build(reservation.id, "admin");
  }

  private async build(
    reservationId: number,
    audience: HistoryAudience,
  ): Promise<ReservationHistoryDto> {
    const [events, audits] = await Promise.all([
      this.eventRepository.find({
        where: { reservation_id: reservationId },
        order: { created_at: "ASC", id: "ASC" },
      }),
      this.reservationRepository.manager.getRepository(AuditLogEntity).find({
        where: {
          entity: AUDIT_ENTITY.RESERVATION,
          entity_id: String(reservationId),
          action: "reservation.created",
        },
      }),
    ]);
    return {
      reservation_id: reservationId,
      items: buildReservationHistory(events, audits, audience),
    };
  }

  private async findOrFail(id: number): Promise<ReservationEntity> {
    const reservation = await this.reservationRepository.findOne({
      where: { id },
    });
    if (!reservation) {
      throw new NotFoundException(`Reservation with id ${id} not found`);
    }
    return reservation;
  }
}
