import type {
  AddIncidentAttachmentDto,
  AddIncidentMessageDto,
  AdminIncidentDto,
  AdminIncidentStatusResultDto,
  CreateIncidentDto,
  PayoutHoldOutcome,
  TravelerIncidentAttachmentDto,
  TravelerIncidentAttachmentFileDto,
  TravelerIncidentDto,
  TravelerIncidentListDto,
  TravelerIncidentMessageDto,
  UpdateIncidentStatusDto,
} from "../dto/reservation-incident.dto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, In, Repository } from "typeorm";

import { type Actor, actors } from "../../payments/domain/audit-actor";
import { PAYOUT_STATUS } from "../../payments/domain/payout-state-machine";
import {
  InvalidTransitionError,
  TRANSITION_RESULT,
} from "../../payments/domain/state-machine";
import {
  LEDGER_TRANSITION,
  type LedgerTransition,
  ON_INVALID,
} from "../../payments/services/payment-ledger.service";
import { ReservationEconomicsService } from "../../payments/services/reservation-economics.service";
import { PAYOUT_HOLD_OUTCOME } from "../dto/reservation-incident.dto";
import { ReservationEntity } from "../entities/reservation.entity";
import { ReservationDisputeEntity } from "../entities/reservation-dispute.entity";
import { ReservationIncidentEntity } from "../entities/reservation-incident.entity";
import { ReservationIncidentAttachmentEntity } from "../entities/reservation-incident-attachment.entity";
import { ReservationIncidentMessageEntity } from "../entities/reservation-incident-message.entity";
import {
  INCIDENT_MESSAGE_EMAIL,
  INCIDENT_MESSAGE_EVENT,
} from "../types/reservation-email.types";
import {
  adminActorAuditId,
  adminActorPayload,
  type IncidentAdminActor,
} from "../utils/incident-admin.util";
import {
  INCIDENT_AUTHOR,
  INCIDENT_ERROR,
  INCIDENT_LIMITS,
  INCIDENT_STATUS,
  INCIDENT_TYPE,
  type IncidentAuthor,
  incidentStateMachine,
  type IncidentType,
  isOpenIncidentStatus,
  isPayoutBlockingIncidentType,
  OPEN_INCIDENT_STATUSES,
  resolveReportableIncidentTypes,
} from "../utils/reservation-incident.util";
import { ReservationService } from "./reservation.service";
import { ReservationEmailService } from "./reservation-email.service";
import { ReservationEventService } from "./reservation-event.service";
import {
  type IncidentMessageNotification,
  ReservationIncidentNotificationService,
} from "./reservation-incident-notification.service";

export interface ForceMajeureIncidentInput {
  reservationId: number;
  userId: number;
  disputeId: number;
  description: string;
}

interface IncidentChildren {
  messages: ReservationIncidentMessageEntity[];
  attachments: ReservationIncidentAttachmentEntity[];
}

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Traveler incidents (F-PV7a, D4/D5/D7). Every write runs in a transaction
 * with the reservation (create) or the incident (children, status) row locked
 * FOR UPDATE, like the rest of the economics code. Money is only touched
 * through ReservationEconomicsService.transitionPayout (state machine +
 * audit); this service never calls Stripe.
 */
@Injectable()
export class ReservationIncidentService {
  private readonly logger = new Logger(ReservationIncidentService.name);

  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    @InjectRepository(ReservationIncidentEntity)
    private readonly incidentRepository: Repository<ReservationIncidentEntity>,
    @InjectRepository(ReservationIncidentAttachmentEntity)
    private readonly attachmentRepository: Repository<ReservationIncidentAttachmentEntity>,
    @InjectRepository(ReservationIncidentMessageEntity)
    private readonly messageRepository: Repository<ReservationIncidentMessageEntity>,
    private readonly economics: ReservationEconomicsService,
    private readonly reservationEventService: ReservationEventService,
    private readonly reservationEmailService: ReservationEmailService,
    private readonly reservationService: ReservationService,
    private readonly notifications: ReservationIncidentNotificationService,
  ) {}

  // ---------------------------------------------------------------- traveler

  async createForTraveler(
    userId: number,
    reservationId: number,
    dto: CreateIncidentDto,
    now: Date = new Date(),
  ): Promise<TravelerIncidentDto> {
    this.assertUserId(userId);
    const outcome = await this.reservationRepository.manager.transaction(
      async manager => {
        const reservation = await this.lockReservation(manager, reservationId);
        this.assertTravelerAccess(reservation, userId);

        const repository = manager.getRepository(ReservationIncidentEntity);
        const existing = await repository.find({
          where: { reservation_id: reservation.id },
        });
        if (existing.length >= INCIDENT_LIMITS.MAX_INCIDENTS_PER_RESERVATION) {
          throw new HttpException(
            "Too many incidents for this reservation",
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        const openTypes = existing
          .filter(row => isOpenIncidentStatus(row.status))
          .map(row => row.type);
        if (openTypes.includes(dto.type)) {
          throw new ConflictException(
            "An open incident of this type already exists",
          );
        }
        const reportable = resolveReportableIncidentTypes(
          reservation,
          openTypes,
          now,
        );
        if (!reportable.includes(dto.type)) {
          throw new BadRequestException(
            "This incident type cannot be reported for this reservation",
          );
        }

        const actor = actors.traveler(userId);
        const incident = await repository.save(
          repository.create({
            reservation_id: reservation.id,
            user_id: userId,
            type: dto.type,
            status: INCIDENT_STATUS.RECEIVED,
            description: dto.description,
            dispute_id: null,
            blocks_payout: false,
            resolution_note: null,
            resolved_at: null,
          }),
        );

        let payoutTransition: LedgerTransition | null = null;
        if (isPayoutBlockingIncidentType(dto.type)) {
          const dispute = await this.openIncidentDispute(
            manager,
            reservation.id,
            incident,
          );
          incident.dispute_id = dispute.id;
          payoutTransition = await this.blockPayout(
            manager,
            reservation,
            incident,
            actor,
          );
          incident.blocks_payout =
            payoutTransition === LEDGER_TRANSITION.CHANGED ||
            payoutTransition === LEDGER_TRANSITION.NOOP;
          await repository.save(incident);
        }

        await this.reservationEventService.logEventInTransaction(
          manager,
          reservation.id,
          "incident_opened",
          {
            incident_id: incident.id,
            type: incident.type,
            dispute_id: incident.dispute_id,
            blocks_payout: incident.blocks_payout,
            payout_transition: payoutTransition,
          },
        );
        return { reservation, incident };
      },
    );

    await this.notifyAdmin(outcome.reservation, outcome.incident);
    await this.notifyMessage({
      incident: outcome.incident,
      author: INCIDENT_AUTHOR.TRAVELER,
      body: outcome.incident.description,
      event: INCIDENT_MESSAGE_EVENT.OPENED,
      recipients: [INCIDENT_MESSAGE_EMAIL.TRAVELER],
    });
    return this.toTravelerDto(outcome.incident, {
      messages: [],
      attachments: [],
    });
  }

  async listForTraveler(
    userId: number,
    reservationId: number,
  ): Promise<TravelerIncidentListDto> {
    this.assertUserId(userId);
    const reservation = await this.reservationRepository.findOne({
      where: { id: reservationId },
    });
    if (!reservation) {
      throw new NotFoundException(
        `Reservation with id ${reservationId} not found`,
      );
    }
    this.assertTravelerAccess(reservation, userId);
    return { items: await this.listDtosForReservation(reservation.id) };
  }

  async addAttachment(
    userId: number,
    incidentId: number,
    dto: AddIncidentAttachmentDto,
  ): Promise<TravelerIncidentAttachmentDto> {
    this.assertUserId(userId);
    return this.reservationRepository.manager.transaction(async manager => {
      const incident = await this.lockIncident(manager, incidentId);
      this.assertIncidentOwner(incident, userId);
      this.assertIncidentOpen(incident);

      const repository = manager.getRepository(
        ReservationIncidentAttachmentEntity,
      );
      const sameKey = await repository.findOne({
        where: { storage_key: dto.storage_key },
      });
      if (sameKey) {
        // Idempotent retry of the same upload; a key never moves incidents.
        if (sameKey.incident_id !== incident.id) {
          throw new ConflictException("Attachment key already in use");
        }
        return this.toAttachmentDto(sameKey);
      }
      const count = await repository.count({
        where: { incident_id: incident.id },
      });
      if (count >= INCIDENT_LIMITS.MAX_ATTACHMENTS) {
        throw new ConflictException(
          `An incident accepts at most ${INCIDENT_LIMITS.MAX_ATTACHMENTS} attachments`,
        );
      }
      const saved = await repository.save(
        repository.create({
          incident_id: incident.id,
          storage_key: dto.storage_key,
          original_name: dto.original_name.slice(0, 255),
          mime: dto.mime,
          size_bytes: dto.size_bytes,
          uploaded_by: INCIDENT_AUTHOR.TRAVELER,
        }),
      );
      await this.reservationEventService.logEventInTransaction(
        manager,
        incident.reservation_id,
        "incident_attachment_added",
        { incident_id: incident.id, attachment_id: saved.id, mime: dto.mime },
      );
      return this.toAttachmentDto(saved);
    });
  }

  /**
   * Traveler chat message, allowed in any open status (received, in_review,
   * needs_info; resolved → 409 incident_closed). Only an answer to
   * "needs_info" moves it back to in_review. Emails admin + traveler copy
   * after commit (best effort).
   */
  async addTravelerMessage(
    userId: number,
    incidentId: number,
    dto: AddIncidentMessageDto,
  ): Promise<TravelerIncidentDto> {
    this.assertUserId(userId);
    const { incident, message } =
      await this.reservationRepository.manager.transaction(async manager => {
        const row = await this.lockIncident(manager, incidentId);
        this.assertIncidentOwner(row, userId);
        this.assertIncidentOpen(row);
        const saved = await this.saveMessage(
          manager,
          row,
          INCIDENT_AUTHOR.TRAVELER,
          dto.body,
        );

        const from = row.status;
        if (from === INCIDENT_STATUS.NEEDS_INFO) {
          incidentStateMachine.assertTransition(
            from,
            INCIDENT_STATUS.IN_REVIEW,
          );
          row.status = INCIDENT_STATUS.IN_REVIEW;
          await manager.getRepository(ReservationIncidentEntity).save(row);
        }
        await this.reservationEventService.logEventInTransaction(
          manager,
          row.reservation_id,
          "incident_message_traveler",
          { incident_id: row.id, from, to: row.status, message_id: saved.id },
        );
        return { incident: row, message: saved };
      });
    await this.notifyMessage({
      incident,
      author: INCIDENT_AUTHOR.TRAVELER,
      body: message.body,
      event: INCIDENT_MESSAGE_EVENT.MESSAGE,
    });
    return this.toTravelerDto(incident, await this.loadChildren(incident.id));
  }

  /**
   * Full thread of one incident for the "Incidencias" tab. Ownership by the
   * reservation (reservations.user_id), like every traveler route: missing
   * incident/reservation → 404, someone else's → 403.
   */
  async getForTraveler(
    userId: number,
    incidentId: number,
  ): Promise<{
    incident: TravelerIncidentDto;
    reservation: ReservationEntity;
  }> {
    this.assertUserId(userId);
    const incident = await this.incidentRepository.findOne({
      where: { id: incidentId },
    });
    if (!incident) {
      throw new NotFoundException(`Incident with id ${incidentId} not found`);
    }
    const reservation = await this.reservationRepository.findOne({
      where: { id: incident.reservation_id },
    });
    if (!reservation) {
      throw new NotFoundException(
        `Reservation with id ${incident.reservation_id} not found`,
      );
    }
    if (reservation.user_id !== userId) {
      throw new ForbiddenException("Incident access denied");
    }
    return {
      incident: this.toTravelerDto(
        incident,
        await this.loadChildren(incident.id),
      ),
      reservation,
    };
  }

  /** Metadata for the PHP proxy to serve the private file (ownership here). */
  async getAttachmentFile(
    userId: number,
    incidentId: number,
    attachmentId: number,
  ): Promise<TravelerIncidentAttachmentFileDto> {
    this.assertUserId(userId);
    const incident = await this.incidentRepository.findOne({
      where: { id: incidentId },
    });
    if (!incident) {
      throw new NotFoundException(`Incident with id ${incidentId} not found`);
    }
    this.assertIncidentOwner(incident, userId);
    const attachment = await this.attachmentRepository.findOne({
      where: { id: attachmentId, incident_id: incident.id },
    });
    if (!attachment) {
      throw new NotFoundException(
        `Attachment with id ${attachmentId} not found`,
      );
    }
    return {
      id: attachment.id,
      incident_id: incident.id,
      storage_key: attachment.storage_key,
      original_name: attachment.original_name,
      mime: attachment.mime,
      size_bytes: attachment.size_bytes,
    };
  }

  // ---------------------------------------------------- panel integration

  /** Open incident types per reservation (status util + capabilities). */
  async findOpenTypesByReservation(
    reservationIds: number[],
  ): Promise<Map<number, IncidentType[]>> {
    const result = new Map<number, IncidentType[]>();
    if (reservationIds.length === 0) {
      return result;
    }
    const rows = await this.incidentRepository.find({
      where: {
        reservation_id: In(reservationIds),
        status: In([...OPEN_INCIDENT_STATUSES]),
      },
    });
    for (const row of rows) {
      const list = result.get(row.reservation_id) ?? [];
      list.push(row.type);
      result.set(row.reservation_id, list);
    }
    return result;
  }

  /** Traveler DTOs of one reservation (caller already checked ownership). */
  async listDtosForReservation(
    reservationId: number,
  ): Promise<TravelerIncidentDto[]> {
    const incidents = await this.incidentRepository.find({
      where: { reservation_id: reservationId },
      order: { created_at: "DESC" },
    });
    if (incidents.length === 0) {
      return [];
    }
    const ids = incidents.map(row => row.id);
    const [messages, attachments] = await Promise.all([
      this.messageRepository.find({
        where: { incident_id: In(ids) },
        order: { created_at: "ASC" },
      }),
      this.attachmentRepository.find({
        where: { incident_id: In(ids) },
        order: { created_at: "ASC" },
      }),
    ]);
    return incidents.map(incident =>
      this.toTravelerDto(incident, {
        messages: messages.filter(row => row.incident_id === incident.id),
        attachments: attachments.filter(row => row.incident_id === incident.id),
      }),
    );
  }

  /**
   * F-PV7a: cancelByTraveler (force_majeure) links its dispute to an incident
   * so attachments and "Pendiente de revisión V4P" use the same UI. Runs in
   * the caller's transaction; no extra payout change (the reservation is
   * cancelled and the refund stays pending).
   */
  async openForceMajeureIncidentInTransaction(
    manager: EntityManager,
    input: ForceMajeureIncidentInput,
  ): Promise<ReservationIncidentEntity> {
    const repository = manager.getRepository(ReservationIncidentEntity);
    const incident = await repository.save(
      repository.create({
        reservation_id: input.reservationId,
        user_id: input.userId,
        type: INCIDENT_TYPE.FORCE_MAJEURE_CANCELLATION,
        status: INCIDENT_STATUS.IN_REVIEW,
        description: input.description,
        dispute_id: input.disputeId,
        blocks_payout: false,
        resolution_note: null,
        resolved_at: null,
      }),
    );
    await this.reservationEventService.logEventInTransaction(
      manager,
      input.reservationId,
      "incident_opened",
      {
        incident_id: incident.id,
        type: incident.type,
        dispute_id: input.disputeId,
        blocks_payout: false,
        payout_transition: null,
      },
    );
    return incident;
  }

  // -------------------------------------------------------------- V4P side

  /**
   * Internal (V4P): move the incident. resolved never releases money by
   * itself; with release_hold the linked dispute is closed and the payout
   * goes blocked -> held only if no other open dispute holds it (same rule as
   * charge.dispute.closed won). Same status = idempotent (release_hold can be
   * sent again on an already resolved incident to unblock later).
   * actor (backoffice): admino user from x-actor-* headers; recorded in the
   * reservation event, the payout audit row and linked to the note message.
   * null keeps the legacy behaviour (anonymous "v4p" admin).
   */
  async updateStatus(
    incidentId: number,
    dto: UpdateIncidentStatusDto,
    now: Date = new Date(),
    actor: IncidentAdminActor | null = null,
  ): Promise<AdminIncidentStatusResultDto> {
    if (dto.release_hold && dto.status !== INCIDENT_STATUS.RESOLVED) {
      throw new BadRequestException(
        "release_hold is only allowed with status resolved",
      );
    }
    const outcome = await this.reservationRepository.manager.transaction(
      async manager => {
        const incident = await this.lockIncident(manager, incidentId);
        const reservation = await this.lockReservation(
          manager,
          incident.reservation_id,
        );
        const from = incident.status;
        const to = dto.status;
        // Punto 6: a no-show moves money (refund per policy); it is closed
        // only through POST /incidents/:id/no-show/resolve.
        if (
          incident.type === INCIDENT_TYPE.NO_SHOW &&
          (to === INCIDENT_STATUS.RESOLVED || dto.release_hold)
        ) {
          throw new BadRequestException("no_show_requires_no_show_resolve");
        }
        let changed: boolean;
        try {
          changed =
            incidentStateMachine.assertTransition(from, to) ===
            TRANSITION_RESULT.CHANGED;
        } catch (error) {
          if (error instanceof InvalidTransitionError) {
            throw new ConflictException(error.message);
          }
          throw error;
        }

        const note = dto.note && dto.note !== "" ? dto.note : null;
        if (changed) {
          incident.status = to;
          if (to === INCIDENT_STATUS.RESOLVED) {
            incident.resolved_at = now;
            incident.resolution_note = note;
          }
          await manager.getRepository(ReservationIncidentEntity).save(incident);
        }
        let noteMessageId: number | null = null;
        if (note && to !== INCIDENT_STATUS.RESOLVED) {
          const message = await this.saveMessage(
            manager,
            incident,
            INCIDENT_AUTHOR.ADMIN,
            note,
          );
          noteMessageId = message.id;
        }

        let payoutHold: PayoutHoldOutcome = PAYOUT_HOLD_OUTCOME.NOT_REQUESTED;
        if (dto.release_hold) {
          payoutHold = await this.releaseHold(
            manager,
            reservation,
            incident,
            actor,
          );
        }

        await this.reservationEventService.logEventInTransaction(
          manager,
          reservation.id,
          "incident_status_changed",
          {
            incident_id: incident.id,
            from,
            to,
            changed,
            release_hold: dto.release_hold ?? false,
            payout_hold: payoutHold,
            ...(noteMessageId === null ? {} : { message_id: noteMessageId }),
            ...adminActorPayload(actor),
          },
        );
        return { incident, reservation, payoutHold, note, changed };
      },
    );

    // A note the traveler sees (V4P message or resolution note) is a chat
    // message too: email traveler + admin copy (best effort, after commit).
    if (outcome.note) {
      const resolvedNow = dto.status === INCIDENT_STATUS.RESOLVED;
      if (!resolvedNow || outcome.changed) {
        await this.notifyMessage({
          incident: outcome.incident,
          author: INCIDENT_AUTHOR.ADMIN,
          body: outcome.note,
          event: resolvedNow
            ? INCIDENT_MESSAGE_EVENT.RESOLVED
            : INCIDENT_MESSAGE_EVENT.STATUS_NOTE,
          actorName: actor?.name ?? null,
        });
      }
    }

    return {
      incident: this.toAdminDto(
        outcome.incident,
        await this.loadChildren(outcome.incident.id),
      ),
      payout_hold: outcome.payoutHold,
      payout_status: outcome.reservation.payout_status ?? null,
    };
  }

  /**
   * Internal (V4P): message shown to the traveler in the incident thread
   * (any open status). Emails the traveler + admin copy after commit.
   */
  async addAdminMessage(
    incidentId: number,
    dto: AddIncidentMessageDto,
    actor: IncidentAdminActor | null = null,
  ): Promise<AdminIncidentDto> {
    const incident = await this.reservationRepository.manager.transaction(
      async manager => {
        const row = await this.lockIncident(manager, incidentId);
        this.assertIncidentOpen(row);
        const message = await this.saveMessage(
          manager,
          row,
          INCIDENT_AUTHOR.ADMIN,
          dto.body,
        );
        await this.reservationEventService.logEventInTransaction(
          manager,
          row.reservation_id,
          "incident_message_admin",
          {
            incident_id: row.id,
            message_id: message.id,
            ...adminActorPayload(actor),
          },
        );
        return { row, message };
      },
    );
    await this.notifyMessage({
      incident: incident.row,
      author: INCIDENT_AUTHOR.ADMIN,
      body: incident.message.body,
      event: INCIDENT_MESSAGE_EVENT.MESSAGE,
      actorName: actor?.name ?? null,
    });
    return this.toAdminDto(
      incident.row,
      await this.loadChildren(incident.row.id),
    );
  }

  // --------------------------------------------------------------- helpers

  /**
   * D7: held -> blocked through the payout state machine. null payout (never
   * paid) is left alone; blocked = NOOP (idempotent); released is final, so
   * the transition is rejected, audited (payout.transition_rejected) and
   * ignored instead of failing the traveler's report (A21 debt, out of scope).
   */
  private async blockPayout(
    manager: EntityManager,
    reservation: ReservationEntity,
    incident: ReservationIncidentEntity,
    actor: Actor,
  ): Promise<LedgerTransition | null> {
    if (!reservation.payout_status) {
      return null;
    }
    const transition = await this.economics.transitionPayout(
      manager,
      reservation,
      PAYOUT_STATUS.BLOCKED,
      actor,
      {
        onInvalid: ON_INVALID.IGNORE,
        metadata: {
          trigger: "traveler_incident",
          incident_id: incident.id,
          incident_type: incident.type,
          dispute_id: incident.dispute_id,
        },
      },
    );
    if (transition === LEDGER_TRANSITION.CHANGED) {
      await manager.getRepository(ReservationEntity).save(reservation);
    }
    return transition;
  }

  private async releaseHold(
    manager: EntityManager,
    reservation: ReservationEntity,
    incident: ReservationIncidentEntity,
    actor: IncidentAdminActor | null,
  ): Promise<PayoutHoldOutcome> {
    const disputes = manager.getRepository(ReservationDisputeEntity);
    if (incident.dispute_id) {
      const dispute = await disputes.findOne({
        where: { id: incident.dispute_id },
      });
      if (dispute && dispute.status === "open") {
        dispute.status = "resolved_release";
        dispute.closed_at = new Date();
        await disputes.save(dispute);
      }
    }
    if (!incident.blocks_payout) {
      return PAYOUT_HOLD_OUTCOME.NOT_BLOCKED;
    }
    incident.blocks_payout = false;
    await manager.getRepository(ReservationIncidentEntity).save(incident);

    if (reservation.payout_status !== PAYOUT_STATUS.BLOCKED) {
      return PAYOUT_HOLD_OUTCOME.NOT_BLOCKED;
    }
    const otherOpen = await disputes.count({
      where: { reservation_id: reservation.id, status: "open" },
    });
    if (otherOpen > 0) {
      return PAYOUT_HOLD_OUTCOME.STILL_BLOCKED;
    }
    await this.economics.transitionPayout(
      manager,
      reservation,
      PAYOUT_STATUS.HELD,
      actors.admin(adminActorAuditId(actor)),
      {
        metadata: {
          trigger: "incident_resolved",
          incident_id: incident.id,
          dispute_id: incident.dispute_id,
          ...(actor?.name ? { actor_name: actor.name } : {}),
        },
      },
    );
    await manager.getRepository(ReservationEntity).save(reservation);
    return PAYOUT_HOLD_OUTCOME.UNBLOCKED;
  }

  private async openIncidentDispute(
    manager: EntityManager,
    reservationId: number,
    incident: ReservationIncidentEntity,
  ): Promise<ReservationDisputeEntity> {
    const repository = manager.getRepository(ReservationDisputeEntity);
    return repository.save(
      repository.create({
        reservation_id: reservationId,
        source: "guest_report",
        status: "open",
        guest_report: JSON.stringify({
          type: "traveler_incident",
          incident_id: incident.id,
          incident_type: incident.type,
          description: incident.description,
        }),
      }),
    );
  }

  private async saveMessage(
    manager: EntityManager,
    incident: ReservationIncidentEntity,
    author: IncidentAuthor,
    body: string,
  ): Promise<ReservationIncidentMessageEntity> {
    const repository = manager.getRepository(ReservationIncidentMessageEntity);
    const count = await repository.count({
      where: { incident_id: incident.id },
    });
    if (count >= INCIDENT_LIMITS.MAX_MESSAGES_PER_INCIDENT) {
      throw new HttpException(
        "Too many messages for this incident",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return repository.save(
      repository.create({
        incident_id: incident.id,
        author_type: author,
        body: body.slice(0, INCIDENT_LIMITS.MESSAGE_MAX),
      }),
    );
  }

  private async notifyAdmin(
    reservation: ReservationEntity,
    incident: ReservationIncidentEntity,
  ): Promise<void> {
    try {
      const site = await this.reservationService.getSiteById(
        reservation.site_id,
      );
      await this.reservationEmailService.sendIncidentAdminEmail(
        reservation,
        site,
        incident.type,
        incident.description,
        incident.blocks_payout,
      );
    } catch (error) {
      // The incident is committed; the email is best effort.
      this.logger.error(
        `Incident admin email failed for incident ${incident.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Chat emails; the notifier never throws, this guard is belt and braces. */
  private async notifyMessage(
    input: IncidentMessageNotification,
  ): Promise<void> {
    try {
      await this.notifications.notifyMessage(input);
    } catch (error) {
      this.logger.error(
        `Incident message email failed for incident ${input.incident.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
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

  private async lockIncident(
    manager: EntityManager,
    id: number,
  ): Promise<ReservationIncidentEntity> {
    const incident = await manager
      .getRepository(ReservationIncidentEntity)
      .findOne({ where: { id }, lock: { mode: "pessimistic_write" } });
    if (!incident) {
      throw new NotFoundException(`Incident with id ${id} not found`);
    }
    return incident;
  }

  private assertUserId(userId: number): void {
    if (!Number.isInteger(userId) || userId < 1) {
      throw new BadRequestException("Invalid traveler user_id");
    }
  }

  /** Same rule and message as ReservationRefundService.assertTravelerAccess. */
  private assertTravelerAccess(
    reservation: ReservationEntity,
    userId: number,
  ): void {
    if (userId < 1 || reservation.user_id !== userId) {
      throw new ForbiddenException("Reservation access denied");
    }
  }

  private assertIncidentOwner(
    incident: ReservationIncidentEntity,
    userId: number,
  ): void {
    if (userId < 1 || incident.user_id !== userId) {
      throw new ForbiddenException("Incident access denied");
    }
  }

  private assertIncidentOpen(incident: ReservationIncidentEntity): void {
    if (!isOpenIncidentStatus(incident.status)) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        code: INCIDENT_ERROR.INCIDENT_CLOSED,
        message: "Incident is already resolved",
      });
    }
  }

  private async loadChildren(incidentId: number): Promise<IncidentChildren> {
    const [messages, attachments] = await Promise.all([
      this.messageRepository.find({
        where: { incident_id: incidentId },
        order: { created_at: "ASC" },
      }),
      this.attachmentRepository.find({
        where: { incident_id: incidentId },
        order: { created_at: "ASC" },
      }),
    ]);
    return { messages, attachments };
  }

  private toMessageDto(
    row: ReservationIncidentMessageEntity,
  ): TravelerIncidentMessageDto {
    return {
      id: row.id,
      author_type: row.author_type,
      body: row.body,
      created_at: iso(row.created_at) ?? "",
    };
  }

  private toAttachmentDto(
    row: ReservationIncidentAttachmentEntity,
  ): TravelerIncidentAttachmentDto {
    return {
      id: row.id,
      original_name: row.original_name,
      mime: row.mime,
      size_bytes: Number(row.size_bytes),
      uploaded_by: row.uploaded_by,
      created_at: iso(row.created_at) ?? "",
    };
  }

  private toTravelerDto(
    incident: ReservationIncidentEntity,
    children: IncidentChildren,
  ): TravelerIncidentDto {
    const open = isOpenIncidentStatus(incident.status);
    return {
      id: incident.id,
      reservation_id: incident.reservation_id,
      type: incident.type,
      status: incident.status,
      description: incident.description,
      blocks_payout: Boolean(incident.blocks_payout),
      resolution_note: incident.resolution_note ?? null,
      resolved_at: iso(incident.resolved_at),
      created_at: iso(incident.created_at) ?? "",
      updated_at: iso(incident.updated_at) ?? "",
      // Chat: the traveler can write while the incident is open.
      can_reply: open,
      can_attach:
        open && children.attachments.length < INCIDENT_LIMITS.MAX_ATTACHMENTS,
      messages: children.messages.map(row => this.toMessageDto(row)),
      attachments: children.attachments.map(row => this.toAttachmentDto(row)),
    };
  }

  private toAdminDto(
    incident: ReservationIncidentEntity,
    children: IncidentChildren,
  ): AdminIncidentDto {
    return {
      ...this.toTravelerDto(incident, children),
      user_id: incident.user_id,
      dispute_id: incident.dispute_id ?? null,
    };
  }
}
