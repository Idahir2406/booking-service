import type {
  AdminChangeRequestDto,
  ChangeOfferQuoteDto,
  CreateChangeProposalDto,
  CreateChangeRequestDto,
  TravelerChangeProposalDto,
  TravelerChangeRequestDto,
  TravelerChangesDto,
  TravelerProposalAcceptResultDto,
  UpdateChangeRequestStatusDto,
} from "../dto/reservation-change.dto";

import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";

import { type Actor, actors } from "../../payments/domain/audit-actor";
import { InvalidTransitionError } from "../../payments/domain/state-machine";
import { SNAPSHOT_REASON } from "../../payments/entities/reservation-snapshot.entity";
import { ReservationEconomicsService } from "../../payments/services/reservation-economics.service";
import { ReservationEntity } from "../entities/reservation.entity";
import { ReservationChangeProposalEntity } from "../entities/reservation-change-proposal.entity";
import { ReservationChangeRequestEntity } from "../entities/reservation-change-request.entity";
import {
  CHANGE_ERROR,
  CHANGE_KIND,
  CHANGE_LIMITS,
  CHANGE_OFFER_STATUS,
  CHANGE_REQUEST_STATUS,
  type ChangeErrorCode,
  changeOfferStateMachine,
  type ChangeOverrides,
  changeRequestStateMachine,
  type ChangeRequestStatus,
  effectiveOfferStatus,
  isChangeEligibleReservation,
  isOpenChangeRequestStatus,
  resolveOfferExpiry,
} from "../utils/reservation-change.util";
import { isDeferredUnpaid } from "../utils/reservation-policy.util";
import {
  type BuiltOffer,
  changeError,
  ReservationChangeApplyService,
} from "./reservation-change-apply.service";
import { ReservationChangeQueryService } from "./reservation-change-query.service";
import { ReservationEventService } from "./reservation-event.service";

/** Result of a transaction that must COMMIT and then report an error. */
interface Deferred<T> {
  value?: T;
  error?: HttpException;
}

/**
 * F-PV7b: change requests ("¿Necesitas cambiar tu reserva?") and V4P change
 * proposals. A request never modifies or cancels the reservation. Accepting
 * a proposal applies it transactionally (rows locked request -> proposal ->
 * reservation) through ReservationChangeApplyService. D8: delta > 0 is never
 * applied in the panel (payment_required); delta < 0 refunds the difference
 * with the existing refund path. D9: proposals only through internal routes.
 */
@Injectable()
export class ReservationChangeService {
  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    @InjectRepository(ReservationChangeRequestEntity)
    private readonly requestRepository: Repository<ReservationChangeRequestEntity>,
    @InjectRepository(ReservationChangeProposalEntity)
    private readonly proposalRepository: Repository<ReservationChangeProposalEntity>,
    private readonly query: ReservationChangeQueryService,
    private readonly apply: ReservationChangeApplyService,
    private readonly economics: ReservationEconomicsService,
    private readonly reservationEventService: ReservationEventService,
  ) {}

  // ---------------------------------------------------------------- traveler

  async listForTraveler(
    userId: number,
    reservationId: number,
    now: Date = new Date(),
  ): Promise<TravelerChangesDto> {
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
    return this.query.loadForReservation(reservation, now);
  }

  async createRequest(
    userId: number,
    reservationId: number,
    dto: CreateChangeRequestDto,
    now: Date = new Date(),
  ): Promise<TravelerChangeRequestDto> {
    this.assertUserId(userId);
    const created = await this.transaction(async manager => {
      const reservation = await this.lockReservation(manager, reservationId);
      this.assertTravelerAccess(reservation, userId);
      if (!isChangeEligibleReservation(reservation, now)) {
        throw changeError(
          HttpStatus.CONFLICT,
          CHANGE_ERROR.NOT_ELIGIBLE,
          "This reservation does not accept change requests",
        );
      }
      const repository = manager.getRepository(ReservationChangeRequestEntity);
      const existing = await repository.find({
        where: { reservation_id: reservation.id },
      });
      if (existing.length >= CHANGE_LIMITS.MAX_REQUESTS_PER_RESERVATION) {
        throw new HttpException(
          "Too many change requests for this reservation",
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const open = existing.filter(row =>
        isOpenChangeRequestStatus(row.status),
      );
      if (open.length >= CHANGE_LIMITS.MAX_OPEN_REQUESTS_PER_RESERVATION) {
        throw changeError(
          HttpStatus.CONFLICT,
          CHANGE_ERROR.OPEN_REQUEST_EXISTS,
          "An open change request already exists",
        );
      }
      const request = await repository.save(
        repository.create({
          reservation_id: reservation.id,
          user_id: userId,
          type: dto.type,
          message: dto.message ?? null,
          status: CHANGE_REQUEST_STATUS.RECEIVED,
          response_note: null,
          closed_at: null,
        }),
      );
      await this.reservationEventService.logEventInTransaction(
        manager,
        reservation.id,
        "change_request_created",
        { request_id: request.id, type: request.type },
      );
      return { request, reservation };
    });
    return this.query.loadRequestDto(created.request, created.reservation, now);
  }

  /** Withdraws an open request; a live proposal becomes rejected. */
  async cancelRequest(
    userId: number,
    requestId: number,
    now: Date = new Date(),
  ): Promise<TravelerChangeRequestDto> {
    this.assertUserId(userId);
    const request = await this.transaction(async manager => {
      const row = await this.lockRequest(manager, requestId);
      this.assertRequestOwner(row, userId);
      if (!isOpenChangeRequestStatus(row.status)) {
        throw changeError(
          HttpStatus.CONFLICT,
          CHANGE_ERROR.REQUEST_CLOSED,
          "The change request is already closed",
        );
      }
      const actor = actors.traveler(userId);
      await this.closeLiveProposals(
        manager,
        row,
        CHANGE_OFFER_STATUS.REJECTED,
        "request_cancelled",
        actor,
        now,
      );
      await this.moveRequest(
        manager,
        row,
        CHANGE_REQUEST_STATUS.CANCELLED,
        now,
      );
      await this.reservationEventService.logEventInTransaction(
        manager,
        row.reservation_id,
        "change_request_cancelled",
        { request_id: row.id },
      );
      return row;
    });
    return this.query.loadRequestDto(
      request,
      await this.findReservation(request.reservation_id),
      now,
    );
  }

  /**
   * «Aceptar cambio». Applies the frozen proposal in ONE transaction or not
   * at all. Expired / no longer valid proposals are stored as expired (that
   * write commits) and reported with 410 / 409; the reservation is untouched.
   */
  async acceptProposal(
    userId: number,
    proposalId: number,
    now: Date = new Date(),
  ): Promise<TravelerProposalAcceptResultDto> {
    this.assertUserId(userId);
    const peek = await this.proposalRepository.findOne({
      where: { id: proposalId },
    });
    if (!peek) {
      throw new NotFoundException(`Proposal with id ${proposalId} not found`);
    }
    const actor = actors.traveler(userId);

    const outcome = await this.transaction(
      async (manager): Promise<Deferred<TravelerProposalAcceptResultDto>> => {
        const request = await this.lockRequest(manager, peek.request_id);
        this.assertRequestOwner(request, userId);
        const proposal = await this.lockProposal(manager, proposalId);
        const reservation = await this.lockReservation(
          manager,
          request.reservation_id,
        );
        this.assertTravelerAccess(reservation, userId);

        const closed = await this.checkLiveOrExpire(
          manager,
          request,
          proposal,
          actor,
          now,
        );
        if (closed) {
          return { error: closed };
        }
        if (!isOpenChangeRequestStatus(request.status)) {
          throw changeError(
            HttpStatus.CONFLICT,
            CHANGE_ERROR.REQUEST_CLOSED,
            "The change request is already closed",
          );
        }

        const invalidate = async (
          code: ChangeErrorCode,
          status: HttpStatus,
          message: string,
        ): Promise<Deferred<TravelerProposalAcceptResultDto>> => {
          await this.expireProposal(
            manager,
            request,
            proposal,
            code,
            actor,
            now,
          );
          return { error: changeError(status, code, message) };
        };

        if (!isChangeEligibleReservation(reservation, now)) {
          return invalidate(
            CHANGE_ERROR.NOT_ELIGIBLE,
            HttpStatus.CONFLICT,
            "The reservation can no longer be changed",
          );
        }
        if (
          (reservation.snapshot_version ?? null) !==
          proposal.based_on_snapshot_version
        ) {
          return invalidate(
            CHANGE_ERROR.OFFER_OUTDATED,
            HttpStatus.CONFLICT,
            "The reservation changed after this proposal",
          );
        }
        const delta = Number(proposal.amount_delta_cents);
        this.assertMoneyAllowed(reservation, delta);

        const check = await this.apply.revalidate(
          proposal.after_payload,
          reservation,
        );
        if (!check.ok) {
          return invalidate(
            check.code,
            HttpStatus.CONFLICT,
            "The proposed change is no longer possible",
          );
        }

        let applied;
        try {
          applied = await this.apply.applyInTransaction(manager, reservation, {
            kind: CHANGE_KIND.PROPOSAL,
            offerId: proposal.id,
            requestId: request.id,
            offer: proposal.after_payload,
            amountDeltaCents: delta,
            basedOnSnapshotVersion: proposal.based_on_snapshot_version,
            reason: SNAPSHOT_REASON.CHANGE_ACCEPTED,
            actor,
            now,
          });
        } catch (error) {
          if (this.apply.isUnavailableError(error)) {
            return invalidate(
              CHANGE_ERROR.UNAVAILABLE,
              HttpStatus.CONFLICT,
              "The proposed dates are no longer available",
            );
          }
          throw error;
        }

        changeOfferStateMachine.assertTransition(
          proposal.status,
          CHANGE_OFFER_STATUS.ACCEPTED,
        );
        proposal.status = CHANGE_OFFER_STATUS.ACCEPTED;
        proposal.resulting_snapshot_version = applied.snapshotVersion;
        proposal.responded_at = now;
        await manager
          .getRepository(ReservationChangeProposalEntity)
          .save(proposal);
        await this.moveRequest(
          manager,
          request,
          CHANGE_REQUEST_STATUS.ACCEPTED,
          now,
        );
        await this.auditOffer(
          manager,
          reservation.id,
          "change_proposal.accepted",
          actor,
          {
            proposal_id: proposal.id,
            request_id: request.id,
            amount_delta_cents: delta,
            snapshot_version: applied.snapshotVersion,
            previous_snapshot_version: applied.previousSnapshotVersion,
            refund_cents: applied.refundCents,
          },
        );
        await this.reservationEventService.logEventInTransaction(
          manager,
          reservation.id,
          "change_proposal_accepted",
          { proposal_id: proposal.id, request_id: request.id },
        );
        return {
          value: {
            applied: true,
            snapshot_version: applied.snapshotVersion,
            previous_snapshot_version: applied.previousSnapshotVersion,
            amount_delta_cents: delta,
            refund_cents: applied.refundCents,
            refund_initiated: applied.refundInitiated,
            proposal: this.query.toProposalDto(proposal, false, now),
          },
        };
      },
    );
    if (outcome.error || !outcome.value) {
      throw outcome.error ?? new BadRequestException("Proposal not applied");
    }
    return outcome.value;
  }

  /** «Mantener mi reserva actual»: nothing changes; the request closes. */
  async rejectProposal(
    userId: number,
    proposalId: number,
    now: Date = new Date(),
  ): Promise<TravelerChangeProposalDto> {
    this.assertUserId(userId);
    const peek = await this.proposalRepository.findOne({
      where: { id: proposalId },
    });
    if (!peek) {
      throw new NotFoundException(`Proposal with id ${proposalId} not found`);
    }
    const actor = actors.traveler(userId);
    const outcome = await this.transaction(
      async (manager): Promise<Deferred<TravelerChangeProposalDto>> => {
        const request = await this.lockRequest(manager, peek.request_id);
        this.assertRequestOwner(request, userId);
        const proposal = await this.lockProposal(manager, proposalId);
        const closed = await this.checkLiveOrExpire(
          manager,
          request,
          proposal,
          actor,
          now,
        );
        if (closed) {
          return { error: closed };
        }
        proposal.status = CHANGE_OFFER_STATUS.REJECTED;
        proposal.close_reason = "kept_current";
        proposal.responded_at = now;
        await manager
          .getRepository(ReservationChangeProposalEntity)
          .save(proposal);
        if (isOpenChangeRequestStatus(request.status)) {
          await this.moveRequest(
            manager,
            request,
            CHANGE_REQUEST_STATUS.CANCELLED,
            now,
          );
        }
        await this.auditOffer(
          manager,
          request.reservation_id,
          "change_proposal.rejected",
          actor,
          {
            proposal_id: proposal.id,
            request_id: request.id,
          },
        );
        await this.reservationEventService.logEventInTransaction(
          manager,
          request.reservation_id,
          "change_proposal_rejected",
          { proposal_id: proposal.id, request_id: request.id },
        );
        return { value: this.query.toProposalDto(proposal, false, now) };
      },
    );
    if (outcome.error || !outcome.value) {
      throw outcome.error ?? new BadRequestException("Proposal not rejected");
    }
    return outcome.value;
  }

  // -------------------------------------------------------------- V4P side

  async listForAdmin(openOnly: boolean): Promise<AdminChangeRequestDto[]> {
    return this.query.listForAdmin(openOnly);
  }

  async getForAdmin(requestId: number): Promise<AdminChangeRequestDto> {
    const request = await this.requestRepository.findOne({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException(`Change request ${requestId} not found`);
    }
    const reservation = await this.findReservation(request.reservation_id);
    return {
      ...(await this.query.loadRequestDto(request, reservation, new Date())),
      user_id: request.user_id,
    };
  }

  /** in_review (we are looking at it) or rejected (not possible, + note). */
  async setRequestStatus(
    requestId: number,
    dto: UpdateChangeRequestStatusDto,
    now: Date = new Date(),
  ): Promise<AdminChangeRequestDto> {
    const actor = actors.admin();
    const request = await this.transaction(async manager => {
      const row = await this.lockRequest(manager, requestId);
      const from = row.status;
      try {
        changeRequestStateMachine.assertTransition(from, dto.status);
      } catch (error) {
        if (error instanceof InvalidTransitionError) {
          throw changeError(
            HttpStatus.CONFLICT,
            CHANGE_ERROR.REQUEST_CLOSED,
            error.message,
          );
        }
        throw error;
      }
      if (dto.note !== undefined) {
        row.response_note = dto.note;
      }
      if (dto.status === CHANGE_REQUEST_STATUS.REJECTED) {
        await this.closeLiveProposals(
          manager,
          row,
          CHANGE_OFFER_STATUS.EXPIRED,
          "request_rejected",
          actor,
          now,
        );
      }
      await this.moveRequest(manager, row, dto.status, now);
      await this.reservationEventService.logEventInTransaction(
        manager,
        row.reservation_id,
        "change_request_status_changed",
        { request_id: row.id, from, to: row.status },
      );
      return row;
    });
    const reservation = await this.findReservation(request.reservation_id);
    return {
      ...(await this.query.loadRequestDto(request, reservation, now)),
      user_id: request.user_id,
    };
  }

  /** Dry run: price + validity of a proposal, nothing stored. */
  async quoteProposal(
    requestId: number,
    dto: CreateChangeProposalDto,
  ): Promise<ChangeOfferQuoteDto> {
    const request = await this.requestRepository.findOne({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException(`Change request ${requestId} not found`);
    }
    const reservation = await this.findReservationOrFail(
      request.reservation_id,
    );
    const built = await this.buildProposalOffer(reservation, dto);
    return this.toQuoteDto(built);
  }

  /**
   * V4P proposal for an open request. Priced server-side with the checkout
   * quote engine; frozen until accepted. Replaces a previous live proposal.
   */
  async createProposal(
    requestId: number,
    dto: CreateChangeProposalDto,
    now: Date = new Date(),
  ): Promise<AdminChangeRequestDto> {
    const peek = await this.requestRepository.findOne({
      where: { id: requestId },
    });
    if (!peek) {
      throw new NotFoundException(`Change request ${requestId} not found`);
    }
    const current = await this.findReservationOrFail(peek.reservation_id);
    // Priced OUTSIDE the transaction (no locks held while quoting); the base
    // snapshot version is re-checked under the locks below.
    const built = await this.buildProposalOffer(current, dto);
    if (!built.valid) {
      throw changeError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        built.onlyDogProblems
          ? CHANGE_ERROR.DOGS_INCOMPATIBLE
          : CHANGE_ERROR.INVALID_CHANGE,
        "The proposed change is not valid",
        { errors: built.errors },
      );
    }
    const basedOn = current.snapshot_version ?? null;
    if (basedOn === null) {
      throw changeError(
        HttpStatus.CONFLICT,
        CHANGE_ERROR.SNAPSHOT_REQUIRED,
        "Reservation without snapshot",
      );
    }
    const expiresAt = resolveOfferExpiry(
      now,
      dto.expires_in_hours ?? CHANGE_LIMITS.DEFAULT_OFFER_HOURS,
      current.checkin,
    );
    if (!expiresAt) {
      throw changeError(
        HttpStatus.CONFLICT,
        CHANGE_ERROR.NOT_ELIGIBLE,
        "No time left before check-in",
      );
    }
    const actor = actors.admin();

    const request = await this.transaction(async manager => {
      const row = await this.lockRequest(manager, requestId);
      if (!isOpenChangeRequestStatus(row.status)) {
        throw changeError(
          HttpStatus.CONFLICT,
          CHANGE_ERROR.REQUEST_CLOSED,
          "The change request is already closed",
        );
      }
      const reservation = await this.lockReservation(
        manager,
        row.reservation_id,
      );
      if (!isChangeEligibleReservation(reservation, now)) {
        throw changeError(
          HttpStatus.CONFLICT,
          CHANGE_ERROR.NOT_ELIGIBLE,
          "The reservation can no longer be changed",
        );
      }
      if ((reservation.snapshot_version ?? null) !== basedOn) {
        throw changeError(
          HttpStatus.CONFLICT,
          CHANGE_ERROR.OFFER_OUTDATED,
          "The reservation changed; quote again",
        );
      }
      await this.closeLiveProposals(
        manager,
        row,
        CHANGE_OFFER_STATUS.EXPIRED,
        "superseded",
        actor,
        now,
      );
      const repository = manager.getRepository(ReservationChangeProposalEntity);
      const proposal = await repository.save(
        repository.create({
          request_id: row.id,
          reservation_id: reservation.id,
          before_payload: built.before,
          after_payload: built.after,
          amount_delta_cents: built.amountDeltaCents,
          status: CHANGE_OFFER_STATUS.PENDING_TRAVELER,
          expires_at: expiresAt,
          based_on_snapshot_version: basedOn,
          resulting_snapshot_version: null,
          conditions: dto.conditions ?? null,
          message: dto.message ?? null,
          close_reason: null,
          responded_at: null,
        }),
      );
      await this.moveRequest(
        manager,
        row,
        CHANGE_REQUEST_STATUS.PROPOSAL_SENT,
        now,
      );
      await this.auditOffer(
        manager,
        reservation.id,
        "change_proposal.created",
        actor,
        {
          proposal_id: proposal.id,
          request_id: row.id,
          amount_delta_cents: built.amountDeltaCents,
          based_on_snapshot_version: basedOn,
          expires_at: expiresAt.toISOString(),
        },
      );
      await this.reservationEventService.logEventInTransaction(
        manager,
        reservation.id,
        "change_proposal_created",
        {
          proposal_id: proposal.id,
          request_id: row.id,
          amount_delta_cents: built.amountDeltaCents,
        },
      );
      return row;
    });
    const reservation = await this.findReservation(request.reservation_id);
    return {
      ...(await this.query.loadRequestDto(request, reservation, now)),
      user_id: request.user_id,
    };
  }

  // --------------------------------------------------------------- helpers

  private async buildProposalOffer(
    reservation: ReservationEntity,
    dto: CreateChangeProposalDto,
  ): Promise<BuiltOffer> {
    const snapshot = await this.apply.loadCurrentSnapshot(reservation);
    if (!snapshot) {
      throw changeError(
        HttpStatus.CONFLICT,
        CHANGE_ERROR.SNAPSHOT_REQUIRED,
        "Reservation without snapshot",
      );
    }
    const overrides: ChangeOverrides = {
      checkin: dto.checkin,
      checkout: dto.checkout,
      guests: dto.guests,
      board_option_id: dto.board_option_id,
      dogs: dto.dogs,
      services: dto.services,
      extras: dto.extras,
    };
    return this.apply.buildOffer({
      reservation,
      snapshot,
      overrides,
      adjustmentCents: dto.adjustment_cents,
      adjustmentDescription: dto.adjustment_description,
      source: SNAPSHOT_REASON.CHANGE_ACCEPTED,
      siteNameBefore: null,
      siteNameAfter: null,
    });
  }

  private toQuoteDto(built: BuiltOffer): ChangeOfferQuoteDto {
    const toSummary = this.query.toProposalDto(
      {
        id: 0,
        request_id: 0,
        reservation_id: 0,
        before_payload: built.before,
        after_payload: built.after,
        amount_delta_cents: built.amountDeltaCents,
        status: CHANGE_OFFER_STATUS.PENDING_TRAVELER,
        expires_at: new Date(Date.now() + 60_000),
        based_on_snapshot_version: 0,
        resulting_snapshot_version: null,
        conditions: null,
        message: null,
        close_reason: null,
        responded_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
      false,
      new Date(),
    );
    return {
      valid: built.valid,
      errors: built.errors,
      dogs_compatible: built.dogsCompatible,
      before: toSummary.before,
      after: toSummary.after,
      amount_delta_cents: built.amountDeltaCents,
      acceptable_in_panel: built.valid && built.amountDeltaCents <= 0,
    };
  }

  /**
   * null when the proposal is live. Expired (pending past expires_at) is
   * stored as expired and reported as 410; any other closed state -> 409.
   */
  private async checkLiveOrExpire(
    manager: EntityManager,
    request: ReservationChangeRequestEntity,
    proposal: ReservationChangeProposalEntity,
    actor: Actor,
    now: Date,
  ): Promise<HttpException | null> {
    if (proposal.status !== CHANGE_OFFER_STATUS.PENDING_TRAVELER) {
      return changeError(
        proposal.status === CHANGE_OFFER_STATUS.EXPIRED
          ? HttpStatus.GONE
          : HttpStatus.CONFLICT,
        proposal.status === CHANGE_OFFER_STATUS.EXPIRED
          ? CHANGE_ERROR.OFFER_EXPIRED
          : CHANGE_ERROR.OFFER_CLOSED,
        "This proposal can no longer be answered",
      );
    }
    if (effectiveOfferStatus(proposal, now) === CHANGE_OFFER_STATUS.EXPIRED) {
      await this.expireProposal(
        manager,
        request,
        proposal,
        "expired",
        actor,
        now,
      );
      return changeError(
        HttpStatus.GONE,
        CHANGE_ERROR.OFFER_EXPIRED,
        "This proposal has expired",
      );
    }
    return null;
  }

  /** pending -> expired; the request goes back to in_review for V4P. */
  private async expireProposal(
    manager: EntityManager,
    request: ReservationChangeRequestEntity,
    proposal: ReservationChangeProposalEntity,
    reason: string,
    actor: Actor,
    now: Date,
  ): Promise<void> {
    changeOfferStateMachine.assertTransition(
      proposal.status,
      CHANGE_OFFER_STATUS.EXPIRED,
    );
    proposal.status = CHANGE_OFFER_STATUS.EXPIRED;
    proposal.close_reason = reason;
    await manager.getRepository(ReservationChangeProposalEntity).save(proposal);
    if (request.status === CHANGE_REQUEST_STATUS.PROPOSAL_SENT) {
      await this.moveRequest(
        manager,
        request,
        CHANGE_REQUEST_STATUS.IN_REVIEW,
        now,
      );
    }
    await this.auditOffer(
      manager,
      request.reservation_id,
      "change_proposal.expired",
      actor,
      {
        proposal_id: proposal.id,
        request_id: request.id,
        reason,
      },
    );
  }

  private async closeLiveProposals(
    manager: EntityManager,
    request: ReservationChangeRequestEntity,
    to:
      | typeof CHANGE_OFFER_STATUS.EXPIRED
      | typeof CHANGE_OFFER_STATUS.REJECTED,
    reason: string,
    actor: Actor,
    now: Date,
  ): Promise<void> {
    const repository = manager.getRepository(ReservationChangeProposalEntity);
    const pending = await repository.find({
      where: {
        request_id: request.id,
        status: CHANGE_OFFER_STATUS.PENDING_TRAVELER,
      },
    });
    for (const proposal of pending) {
      proposal.status = to;
      proposal.close_reason = reason;
      if (to === CHANGE_OFFER_STATUS.REJECTED) {
        proposal.responded_at = now;
      }
      await repository.save(proposal);
      await this.auditOffer(
        manager,
        request.reservation_id,
        `change_proposal.${to}`,
        actor,
        {
          proposal_id: proposal.id,
          request_id: request.id,
          reason,
        },
      );
    }
  }

  private async moveRequest(
    manager: EntityManager,
    request: ReservationChangeRequestEntity,
    to: ChangeRequestStatus,
    now: Date,
  ): Promise<void> {
    changeRequestStateMachine.assertTransition(request.status, to);
    request.status = to;
    if (!isOpenChangeRequestStatus(to)) {
      request.closed_at = now;
    }
    await manager.getRepository(ReservationChangeRequestEntity).save(request);
  }

  /** D8: delta > 0 never in the panel; delta < 0 needs a refundable payment. */
  private assertMoneyAllowed(
    reservation: ReservationEntity,
    delta: number,
  ): void {
    if (delta > 0) {
      throw changeError(
        HttpStatus.CONFLICT,
        CHANGE_ERROR.PAYMENT_REQUIRED,
        "This change needs an extra payment; V4P will contact the traveler",
      );
    }
    if (
      delta < 0 &&
      // Fase 4: unpaid deferred charge -> the lower total is just charged later.
      !isDeferredUnpaid(reservation) &&
      (!reservation.stripe_payment_intent_id ||
        reservation.payout_status === "released")
    ) {
      throw changeError(
        HttpStatus.CONFLICT,
        CHANGE_ERROR.REFUND_NOT_POSSIBLE,
        "The difference cannot be refunded automatically",
      );
    }
  }

  private async auditOffer(
    manager: EntityManager,
    reservationId: number,
    action: string,
    actor: Actor,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.economics.auditReservationChange(
      manager,
      reservationId,
      action,
      actor,
      null,
      null,
      metadata,
    );
  }

  private transaction<T>(
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.reservationRepository.manager.transaction(work);
  }

  private async findReservation(id: number): Promise<ReservationEntity | null> {
    return this.reservationRepository.findOne({ where: { id } });
  }

  private async findReservationOrFail(id: number): Promise<ReservationEntity> {
    const reservation = await this.findReservation(id);
    if (!reservation) {
      throw new NotFoundException(`Reservation with id ${id} not found`);
    }
    return reservation;
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

  private async lockRequest(
    manager: EntityManager,
    id: number,
  ): Promise<ReservationChangeRequestEntity> {
    const row = await manager
      .getRepository(ReservationChangeRequestEntity)
      .findOne({ where: { id }, lock: { mode: "pessimistic_write" } });
    if (!row) {
      throw new NotFoundException(`Change request ${id} not found`);
    }
    return row;
  }

  private async lockProposal(
    manager: EntityManager,
    id: number,
  ): Promise<ReservationChangeProposalEntity> {
    const row = await manager
      .getRepository(ReservationChangeProposalEntity)
      .findOne({ where: { id }, lock: { mode: "pessimistic_write" } });
    if (!row) {
      throw new NotFoundException(`Proposal with id ${id} not found`);
    }
    return row;
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

  private assertRequestOwner(
    request: ReservationChangeRequestEntity,
    userId: number,
  ): void {
    if (userId < 1 || request.user_id !== userId) {
      throw new ForbiddenException("Change request access denied");
    }
  }
}
