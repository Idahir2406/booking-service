import type { EntityManager } from "typeorm";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Like, Repository } from "typeorm";

import { ReservationIncidentEntity } from "../../reservations/entities/reservation-incident.entity";
import { ReservationEventService } from "../../reservations/services/reservation-event.service";
import {
  INCIDENT_STATUS,
  INCIDENT_TYPE,
} from "../../reservations/utils/reservation-incident.util";

export interface ProviderIncidentInput {
  reservationId: number;
  userId: number;
  /**
   * Stable dedupe key ("hotel_cancelled", "reconcile:status:CANCELLED"...).
   * An incident with the same key for the reservation (any status, so a
   * resolved one is not re-opened daily) is never created twice.
   */
  key: string;
  description: string;
}

/** Description prefix that carries the dedupe key. */
export function providerIncidentTag(
  reservationId: number,
  key: string,
): string {
  return `[proveedor:${reservationId}:${key}]`;
}

/**
 * System incidents for V4P (admIncidencias) about provider reservations:
 * hotel cancellations and reconciliation mismatches. Uses the existing
 * `other` type (no enum migration, no payout effect: there is no host payout
 * for provider stays) with status in_review.
 */
@Injectable()
export class ProviderIncidentService {
  constructor(
    @InjectRepository(ReservationIncidentEntity)
    private readonly incidentRepository: Repository<ReservationIncidentEntity>,
    private readonly eventService: ReservationEventService,
  ) {}

  /** Returns the new incident, or null when the same key already exists. */
  async openOnce(
    input: ProviderIncidentInput,
    manager?: EntityManager,
  ): Promise<ReservationIncidentEntity | null> {
    const repository = manager
      ? manager.getRepository(ReservationIncidentEntity)
      : this.incidentRepository;
    const tag = providerIncidentTag(input.reservationId, input.key);
    const existing = await repository.findOne({
      where: {
        reservation_id: input.reservationId,
        description: Like(`${tag}%`),
      },
    });
    if (existing) {
      return null;
    }
    const incident = await repository.save(
      repository.create({
        reservation_id: input.reservationId,
        user_id: input.userId,
        type: INCIDENT_TYPE.OTHER,
        status: INCIDENT_STATUS.IN_REVIEW,
        description: `${tag} ${input.description}`,
        dispute_id: null,
        blocks_payout: false,
        resolution_note: null,
        resolved_at: null,
      }),
    );
    const payload = {
      incident_id: incident.id,
      type: incident.type,
      dispute_id: null,
      blocks_payout: false,
      payout_transition: null,
      source: `provider:${input.key}`,
    };
    await (manager
      ? this.eventService.logEventInTransaction(
          manager,
          input.reservationId,
          "incident_opened",
          payload,
        )
      : this.eventService.logEvent(
          input.reservationId,
          "incident_opened",
          payload,
        ));
    return incident;
  }
}
