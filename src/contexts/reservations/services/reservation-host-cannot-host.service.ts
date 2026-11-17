import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, In, Repository } from "typeorm";

import { actors } from "../../payments/domain/audit-actor";
import { PAYOUT_STATUS } from "../../payments/domain/payout-state-machine";
import { REFUND_RESPONSIBLE } from "../../payments/domain/refund-state-machine";
import { ReservationEconomicsService } from "../../payments/services/reservation-economics.service";
import { ReservationEntity } from "../entities/reservation.entity";
import { ReservationDisputeEntity } from "../entities/reservation-dispute.entity";
import { ReservationIncidentEntity } from "../entities/reservation-incident.entity";
import {
  canReportHostCannotHost,
  HOST_CANNOT_HOST_CANCEL_REASON,
  HOST_CANNOT_HOST_DECISION,
  HOST_CANNOT_HOST_REASON_LABEL,
  type HostCannotHostDecision,
  type HostCannotHostReason,
} from "../utils/host-cannot-host.util";
import {
  adminActorAuditId,
  type IncidentAdminActor,
} from "../utils/incident-admin.util";
import { remainingPaidCents } from "../utils/refund-policy.util";
import {
  INCIDENT_STATUS,
  INCIDENT_TYPE,
  OPEN_INCIDENT_STATUSES,
} from "../utils/reservation-incident.util";
import { isDeferredUnpaid } from "../utils/reservation-policy.util";
import { ReservationService } from "./reservation.service";
import { ReservationEmailService } from "./reservation-email.service";
import { ReservationEventService } from "./reservation-event.service";
import { ReservationPayoutService } from "./reservation-payout.service";

const TEXT_MAX = 2000;

function cleanText(value: string | undefined | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text.slice(0, TEXT_MAX);
}

export interface ReportHostCannotHostResult {
  reservation_id: number;
  incident_id: number;
  payout_status: string | null;
}

export interface ResolveHostCannotHostResult {
  incident_id: number;
  reservation_id: number;
  decision: HostCannotHostDecision;
  refund_cents: number;
  reservation_status: string;
  payout_status: string | null;
}

/**
 * "Comunicar imposibilidad de alojar" (2026-11-15). The host action NEVER
 * cancels a confirmed reservation by itself:
 * 1. Host reports it: incident `host_cannot_host` (in_review, hidden from the
 *    traveler), dispute opened, payout of THIS reservation -> blocked, email
 *    to V4P + acknowledgement to the host. The reservation stays confirmed.
 * 2. V4P reviews in admino. It may contact the traveler (needs_info) or offer
 *    an alternative (ReservationAlternativeService, linked by incident_id).
 * 3. V4P resolves:
 *    - approve: reservation cancelled, 100 % of what remains paid is refunded
 *      (responsible: host), nights released; traveler + host emailed.
 *    - reject: payout blocked -> held, stay goes on; host emailed.
 */
@Injectable()
export class ReservationHostCannotHostService {
  private readonly logger = new Logger(ReservationHostCannotHostService.name);

  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    private readonly economics: ReservationEconomicsService,
    private readonly reservationService: ReservationService,
    private readonly payoutService: ReservationPayoutService,
    private readonly eventService: ReservationEventService,
    private readonly emailService: ReservationEmailService,
  ) {}

  async reportByHost(
    reservationId: number,
    siteId: number | undefined,
    reason: HostCannotHostReason,
    description: string | undefined,
    now: Date = new Date(),
  ): Promise<ReportHostCannotHostResult> {
    const detail = cleanText(description);
    const outcome = await this.reservationRepository.manager.transaction(
      async manager => {
        const reservation = await this.lockReservation(manager, reservationId);
        if (!siteId || siteId !== reservation.site_id) {
          throw new ForbiddenException("Site access denied");
        }
        if (await this.findOpen(manager, reservation.id)) {
          throw new ConflictException("host_cannot_host_already_reported");
        }
        if (!canReportHostCannotHost(reservation, now)) {
          throw new BadRequestException("host_cannot_host_not_allowed");
        }

        const label = HOST_CANNOT_HOST_REASON_LABEL[reason];
        const description = detail
          ? `El alojamiento comunica que no puede alojar esta reserva. Motivo: ${label}. Detalle: ${detail}`
          : `El alojamiento comunica que no puede alojar esta reserva. Motivo: ${label}.`;

        const disputes = manager.getRepository(ReservationDisputeEntity);
        const dispute = await disputes.save(
          disputes.create({
            reservation_id: reservation.id,
            source: "guest_report",
            status: "open",
            guest_report: JSON.stringify({
              type: INCIDENT_TYPE.HOST_CANNOT_HOST,
              reason,
              note: detail,
            }),
          }),
        );
        const incidents = manager.getRepository(ReservationIncidentEntity);
        const incident = await incidents.save(
          incidents.create({
            reservation_id: reservation.id,
            user_id: reservation.user_id,
            type: INCIDENT_TYPE.HOST_CANNOT_HOST,
            status: INCIDENT_STATUS.IN_REVIEW,
            description,
            dispute_id: dispute.id,
            blocks_payout: true,
            resolution_note: null,
            resolved_at: null,
          }),
        );

        await this.economics.transitionPayout(
          manager,
          reservation,
          PAYOUT_STATUS.BLOCKED,
          actors.host(siteId),
          {
            metadata: {
              trigger: INCIDENT_TYPE.HOST_CANNOT_HOST,
              incident_id: incident.id,
              dispute_id: dispute.id,
            },
          },
        );
        const saved = await manager
          .getRepository(ReservationEntity)
          .save(reservation);
        await this.eventService.logEventInTransaction(
          manager,
          reservation.id,
          "host_cannot_host_reported",
          {
            incident_id: incident.id,
            dispute_id: dispute.id,
            reason,
            note: detail,
            by: "host",
            site_id: siteId,
          },
        );
        return { reservation: saved, incident, label };
      },
    );

    const note = detail ? `${outcome.label}. ${detail}` : outcome.label;
    await this.notify(outcome.reservation, [
      ["host_cannot_host_admin", { note }],
      ["host_cannot_host_host", { note }],
    ]);

    return {
      reservation_id: outcome.reservation.id,
      incident_id: outcome.incident.id,
      payout_status: outcome.reservation.payout_status ?? null,
    };
  }

  async resolveByAdmin(
    incidentId: number,
    decision: HostCannotHostDecision,
    note: string | null | undefined,
    actor: IncidentAdminActor | null,
    now: Date = new Date(),
  ): Promise<ResolveHostCannotHostResult> {
    const resolutionNote = cleanText(note);
    const adminActor = actors.admin(adminActorAuditId(actor));
    const approve = decision === HOST_CANNOT_HOST_DECISION.APPROVE;

    const outcome = await this.reservationRepository.manager.transaction(
      async manager => {
        const incidents = manager.getRepository(ReservationIncidentEntity);
        const incident = await incidents.findOne({
          where: { id: incidentId },
          lock: { mode: "pessimistic_write" },
        });
        if (!incident) {
          throw new NotFoundException(`Incident ${incidentId} not found`);
        }
        if (incident.type !== INCIDENT_TYPE.HOST_CANNOT_HOST) {
          throw new BadRequestException("incident_not_host_cannot_host");
        }
        if (!OPEN_INCIDENT_STATUSES.includes(incident.status)) {
          throw new ConflictException("incident_already_resolved");
        }
        const reservation = await this.lockReservation(
          manager,
          incident.reservation_id,
        );
        if (approve && reservation.status !== "confirmed") {
          throw new ConflictException("reservation_not_confirmed");
        }

        let refundCents = 0;
        if (approve) {
          const paidSomething =
            !isDeferredUnpaid(reservation) &&
            (reservation.payment_status === "paid" ||
              reservation.payment_status === "partially_refunded");
          refundCents = paidSomething ? remainingPaidCents(reservation) : 0;
          if (refundCents > 0) {
            await this.payoutService.refundInTransaction(
              manager,
              reservation,
              refundCents,
              HOST_CANNOT_HOST_CANCEL_REASON,
              {
                requestedBy: adminActor,
                approvedBy: adminActor,
                responsible: REFUND_RESPONSIBLE.HOST,
              },
            );
          }
        }

        const disputes = manager.getRepository(ReservationDisputeEntity);
        if (incident.dispute_id) {
          await disputes.update(
            { id: incident.dispute_id, status: "open" },
            {
              status: approve ? "resolved_refund" : "resolved_release",
              closed_at: now,
            },
          );
        }
        if (!approve) {
          const otherOpen = await disputes.count({
            where: { reservation_id: reservation.id, status: "open" },
          });
          if (
            otherOpen === 0 &&
            reservation.payout_status === PAYOUT_STATUS.BLOCKED
          ) {
            await this.economics.transitionPayout(
              manager,
              reservation,
              PAYOUT_STATUS.HELD,
              adminActor,
              {
                metadata: {
                  trigger: "host_cannot_host_rejected",
                  incident_id: incident.id,
                  ...(actor?.name ? { actor_name: actor.name } : {}),
                },
              },
            );
          }
        }

        if (approve) {
          reservation.status = "cancelled";
          reservation.cancelled_at = now;
          reservation.cancel_reason = HOST_CANNOT_HOST_CANCEL_REASON;
          reservation.refund_on_cancel = refundCents > 0;
          await this.economics.auditReservationChange(
            manager,
            reservation.id,
            "reservation.cancelled_host_cannot_host",
            adminActor,
            { status: "confirmed" },
            { status: "cancelled", refund_cents: refundCents },
          );
        }

        incident.status = INCIDENT_STATUS.RESOLVED;
        incident.blocks_payout = false;
        incident.resolution_note = resolutionNote;
        incident.resolved_at = now;
        await incidents.save(incident);

        const saved = await manager
          .getRepository(ReservationEntity)
          .save(reservation);
        if (approve) {
          await this.reservationService.releaseAvailabilityForReservation(
            saved,
            manager,
          );
        }
        await this.eventService.logEventInTransaction(
          manager,
          reservation.id,
          approve ? "host_cannot_host_approved" : "host_cannot_host_rejected",
          {
            incident_id: incident.id,
            refund_cents: refundCents,
            note: resolutionNote,
            ...(actor ? { actor: { id: actor.id, name: actor.name } } : {}),
          },
        );
        if (approve) {
          await this.eventService.logEventInTransaction(
            manager,
            reservation.id,
            "cancelled",
            {
              by: "admin",
              reason: HOST_CANNOT_HOST_CANCEL_REASON,
              refund_cents: refundCents,
              incident_id: incident.id,
            },
          );
        }
        return { reservation: saved, incident, refundCents };
      },
    );

    const extras = {
      note: resolutionNote ?? undefined,
      refund_cents: outcome.refundCents,
    };
    await this.notify(
      outcome.reservation,
      approve
        ? [
            ["host_cannot_host_cancelled_guest", extras],
            ["host_cannot_host_cancelled_host", extras],
          ]
        : [["host_cannot_host_rejected_host", extras]],
    );

    return {
      incident_id: outcome.incident.id,
      reservation_id: outcome.reservation.id,
      decision,
      refund_cents: outcome.refundCents,
      reservation_status: outcome.reservation.status,
      payout_status: outcome.reservation.payout_status ?? null,
    };
  }

  /** Reservation ids (of the list) with an open host_cannot_host request. */
  async findOpenReservationIds(reservationIds: number[]): Promise<Set<number>> {
    if (reservationIds.length === 0) {
      return new Set();
    }
    const rows = await this.reservationRepository.manager
      .getRepository(ReservationIncidentEntity)
      .find({
        where: {
          reservation_id: In(reservationIds),
          type: INCIDENT_TYPE.HOST_CANNOT_HOST,
          status: In([...OPEN_INCIDENT_STATUSES]),
        },
        select: { reservation_id: true },
      });
    return new Set(rows.map(row => row.reservation_id));
  }

  private async findOpen(
    manager: EntityManager,
    reservationId: number,
  ): Promise<ReservationIncidentEntity | null> {
    return manager.getRepository(ReservationIncidentEntity).findOne({
      where: {
        reservation_id: reservationId,
        type: INCIDENT_TYPE.HOST_CANNOT_HOST,
        status: In([...OPEN_INCIDENT_STATUSES]),
      },
    });
  }

  private async lockReservation(
    manager: EntityManager,
    id: number,
  ): Promise<ReservationEntity> {
    const reservation = await manager
      .getRepository(ReservationEntity)
      .findOne({ where: { id }, lock: { mode: "pessimistic_write" } });
    if (!reservation) {
      throw new NotFoundException(`Reservation with id ${id} not found`);
    }
    return reservation;
  }

  /** After commit; email failures never undo the decision. */
  private async notify(
    reservation: ReservationEntity,
    emails: [
      Parameters<ReservationEmailService["sendReservationEmail"]>[0],
      Record<string, unknown>,
    ][],
  ): Promise<void> {
    try {
      const site = await this.reservationService.getSiteById(
        reservation.site_id,
      );
      for (const [type, extras] of emails) {
        await this.emailService.sendReservationEmail(
          type,
          reservation,
          site,
          extras,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Host-cannot-host emails failed for reservation ${reservation.id}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
