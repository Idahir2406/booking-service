import type { ReservationSnapshotPayload } from "../../payments/domain/reservation-snapshot";

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
import { ReservationSnapshotService } from "../../payments/services/reservation-snapshot.service";
import { ReservationEntity } from "../entities/reservation.entity";
import { ReservationDisputeEntity } from "../entities/reservation-dispute.entity";
import { ReservationIncidentEntity } from "../entities/reservation-incident.entity";
import {
  adminActorAuditId,
  type IncidentAdminActor,
} from "../utils/incident-admin.util";
import {
  INCIDENT_STATUS,
  INCIDENT_TYPE,
  OPEN_INCIDENT_STATUSES,
} from "../utils/reservation-incident.util";
import { computeReservationPolicyCapabilities } from "../utils/reservation-policy.util";
import {
  type ReservationNoShowQuote,
  resolveNoShowQuote,
} from "../utils/refund-policy.util";
import { ReservationService } from "./reservation.service";
import { ReservationEmailService } from "./reservation-email.service";
import { ReservationEventService } from "./reservation-event.service";
import { ReservationPayoutService } from "./reservation-payout.service";

export const NO_SHOW_DECISION = {
  CONFIRM: "confirm",
  REJECT: "reject",
} as const;

export type NoShowDecision =
  (typeof NO_SHOW_DECISION)[keyof typeof NO_SHOW_DECISION];

export const NO_SHOW_REFUND_REASON = "no_show";

const NOTE_MAX = 1000;

export interface ReportNoShowResult {
  reservation_id: number;
  incident_id: number;
  payout_status: string | null;
}

export interface ResolveNoShowResult {
  incident_id: number;
  reservation_id: number;
  decision: NoShowDecision;
  refund_cents: number;
  refund_id: string | null;
  reservation_status: string;
  payout_status: string | null;
}

function cleanNote(note: string | undefined | null): string | null {
  const value = String(note ?? "").trim();
  return value === "" ? null : value.slice(0, NOTE_MAX);
}

/**
 * Punto 6 del contrato (no-show), decision "anfitrión marca + V4P revisa":
 * 1. The host reports "No se presentó" from the check-in day: a `no_show`
 *    incident is opened with a guest_report dispute and the payout of THAT
 *    reservation goes held -> blocked (no other reservation is touched).
 * 2. The traveler is emailed and can answer in the incident chat.
 * 3. V4P resolves in admino:
 *    - confirm: refund per the frozen no-show policy (quoteNoShow), payout
 *      blocked -> held, reservation finalized with an immediate feedback
 *      deadline so the 15-min cron transfers the rest to the host;
 *    - reject: payout blocked -> held, reservation stays confirmed.
 */
@Injectable()
export class ReservationNoShowService {
  private readonly logger = new Logger(ReservationNoShowService.name);

  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    @InjectRepository(ReservationIncidentEntity)
    private readonly incidentRepository: Repository<ReservationIncidentEntity>,
    private readonly economics: ReservationEconomicsService,
    private readonly snapshots: ReservationSnapshotService,
    private readonly reservationService: ReservationService,
    private readonly payoutService: ReservationPayoutService,
    private readonly eventService: ReservationEventService,
    private readonly emailService: ReservationEmailService,
  ) {}

  async reportByHost(
    reservationId: number,
    siteId: number | undefined,
    note?: string | null,
    now: Date = new Date(),
  ): Promise<ReportNoShowResult> {
    const hostNote = cleanNote(note);
    const outcome = await this.reservationRepository.manager.transaction(
      async manager => {
        const reservation = await this.lockReservation(manager, reservationId);
        if (!siteId || siteId !== reservation.site_id) {
          throw new ForbiddenException("Site access denied");
        }
        const open = await this.findOpenNoShow(manager, reservation.id);
        if (open) {
          throw new ConflictException("no_show_already_reported");
        }
        if (!computeReservationPolicyCapabilities(reservation, now).can_report_no_show) {
          throw new BadRequestException("no_show_not_allowed");
        }

        const description = hostNote
          ? `El alojamiento indica que el viajero no se presentó. Nota del alojamiento: ${hostNote}`
          : "El alojamiento indica que el viajero no se presentó.";
        const disputes = manager.getRepository(ReservationDisputeEntity);
        const dispute = await disputes.save(
          disputes.create({
            reservation_id: reservation.id,
            source: "guest_report",
            status: "open",
            guest_report: JSON.stringify({
              type: "host_no_show",
              note: hostNote,
            }),
          }),
        );
        const incidents = manager.getRepository(ReservationIncidentEntity);
        const incident = await incidents.save(
          incidents.create({
            reservation_id: reservation.id,
            user_id: reservation.user_id,
            type: INCIDENT_TYPE.NO_SHOW,
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
              trigger: "host_no_show",
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
          "no_show_reported",
          { incident_id: incident.id, dispute_id: dispute.id, note: hostNote },
        );
        return { reservation: saved, incident };
      },
    );

    await this.notify(outcome.reservation, [
      ["no_show_reported_guest", { note: hostNote ?? undefined }],
      ["no_show_reported_admin", { note: hostNote ?? undefined }],
    ]);

    return {
      reservation_id: outcome.reservation.id,
      incident_id: outcome.incident.id,
      payout_status: outcome.reservation.payout_status ?? null,
    };
  }

  /** Admino preview: what a confirmation would refund / transfer. */
  async quoteForReservation(
    reservation: ReservationEntity,
  ): Promise<ReservationNoShowQuote & { host_amount_cents: number }> {
    const snapshot = await this.loadSnapshot(reservation);
    const quote = resolveNoShowQuote(reservation, snapshot);
    const refundedAfter =
      Math.round(Number(reservation.amount_refunded ?? 0) * 100) +
      quote.refund_cents;
    const fee = this.economics.computePlatformFee(reservation, refundedAfter);
    return { ...quote, host_amount_cents: fee.hostAmountCents };
  }

  async resolveByAdmin(
    incidentId: number,
    decision: NoShowDecision,
    note: string | null | undefined,
    actor: IncidentAdminActor | null,
    now: Date = new Date(),
  ): Promise<ResolveNoShowResult> {
    const resolutionNote = cleanNote(note);
    const adminActor = actors.admin(adminActorAuditId(actor));

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
        if (incident.type !== INCIDENT_TYPE.NO_SHOW) {
          throw new BadRequestException("incident_not_no_show");
        }
        if (!OPEN_INCIDENT_STATUSES.includes(incident.status)) {
          throw new ConflictException("incident_already_resolved");
        }
        const reservation = await this.lockReservation(
          manager,
          incident.reservation_id,
        );

        let refundCents = 0;
        let refundId: string | null = null;
        if (decision === NO_SHOW_DECISION.CONFIRM) {
          const snapshot = await this.loadSnapshot(reservation, manager);
          const quote = resolveNoShowQuote(reservation, snapshot);
          if (quote.refund_cents > 0) {
            const refund = await this.payoutService.refundInTransaction(
              manager,
              reservation,
              quote.refund_cents,
              NO_SHOW_REFUND_REASON,
              {
                requestedBy: adminActor,
                approvedBy: adminActor,
                responsible: REFUND_RESPONSIBLE.TRAVELER,
              },
            );
            refundCents = quote.refund_cents;
            refundId = refund.refundId;
          }
        }

        const disputes = manager.getRepository(ReservationDisputeEntity);
        if (incident.dispute_id) {
          await disputes.update(
            { id: incident.dispute_id, status: "open" },
            {
              status:
                decision === NO_SHOW_DECISION.CONFIRM
                  ? "resolved_refund"
                  : "resolved_release",
              closed_at: now,
            },
          );
        }
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
                trigger: `no_show_${decision}`,
                incident_id: incident.id,
                ...(actor?.name ? { actor_name: actor.name } : {}),
              },
            },
          );
        }

        if (
          decision === NO_SHOW_DECISION.CONFIRM &&
          reservation.status === "confirmed"
        ) {
          reservation.status = "finalized";
          reservation.finalized_at = now;
          // No stay to review: the cron may transfer the rest right away.
          reservation.feedback_deadline_at = now;
        }

        incident.status = INCIDENT_STATUS.RESOLVED;
        incident.blocks_payout = false;
        incident.resolution_note = resolutionNote;
        incident.resolved_at = now;
        await incidents.save(incident);

        const saved = await manager
          .getRepository(ReservationEntity)
          .save(reservation);
        if (decision === NO_SHOW_DECISION.CONFIRM) {
          await this.reservationService.releaseRemainingAvailabilityForReservation(
            saved,
            manager,
          );
        }
        await this.eventService.logEventInTransaction(
          manager,
          reservation.id,
          `no_show_${decision === NO_SHOW_DECISION.CONFIRM ? "confirmed" : "rejected"}`,
          {
            incident_id: incident.id,
            refund_cents: refundCents,
            refund_id: refundId,
            ...(actor ? { actor: { id: actor.id, name: actor.name } } : {}),
          },
        );
        return { reservation: saved, incident, refundCents, refundId };
      },
    );

    const extras = {
      note: resolutionNote ?? undefined,
      refund_cents: outcome.refundCents,
    };
    await this.notify(
      outcome.reservation,
      decision === NO_SHOW_DECISION.CONFIRM
        ? [
            ["no_show_confirmed_guest", extras],
            ["no_show_confirmed_host", extras],
          ]
        : [
            ["no_show_rejected_guest", extras],
            ["no_show_rejected_host", extras],
          ],
    );

    return {
      incident_id: outcome.incident.id,
      reservation_id: outcome.reservation.id,
      decision,
      refund_cents: outcome.refundCents,
      refund_id: outcome.refundId,
      reservation_status: outcome.reservation.status,
      payout_status: outcome.reservation.payout_status ?? null,
    };
  }

  private async findOpenNoShow(
    manager: EntityManager,
    reservationId: number,
  ): Promise<ReservationIncidentEntity | null> {
    return manager.getRepository(ReservationIncidentEntity).findOne({
      where: {
        reservation_id: reservationId,
        type: INCIDENT_TYPE.NO_SHOW,
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

  /** Frozen snapshot version, else the latest (same rule as the cancellation flow). */
  private async loadSnapshot(
    reservation: ReservationEntity,
    manager?: EntityManager,
  ): Promise<ReservationSnapshotPayload | null> {
    const version = reservation.snapshot_version ?? 1;
    const row = await this.snapshots.findVersion(reservation.id, version);
    if (row?.payload) {
      return row.payload as ReservationSnapshotPayload;
    }
    const latest = await this.snapshots.findLatest(reservation.id, manager);
    return (latest?.payload as ReservationSnapshotPayload | undefined) ?? null;
  }

  /** After commit; email failures never undo the decision. */
  private async notify(
    reservation: ReservationEntity,
    emails: [Parameters<ReservationEmailService["sendReservationEmail"]>[0], Record<string, unknown>][],
  ): Promise<void> {
    try {
      const site = await this.reservationService.getSiteById(reservation.site_id);
      for (const [type, extras] of emails) {
        await this.emailService.sendReservationEmail(type, reservation, site, extras);
      }
    } catch (error) {
      this.logger.warn(
        `No-show emails failed for reservation ${reservation.id}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

