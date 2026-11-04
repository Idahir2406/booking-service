import type {
  ChangeOfferQuoteDto,
  CreateAlternativeDto,
  TravelerAlternativeAcceptResultDto,
  TravelerAlternativeDto,
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
import { SNAPSHOT_REASON } from "../../payments/entities/reservation-snapshot.entity";
import { ReservationEconomicsService } from "../../payments/services/reservation-economics.service";
import { ReservationEntity } from "../entities/reservation.entity";
import { ReservationAlternativeEntity } from "../entities/reservation-alternative.entity";
import { ReservationIncidentEntity } from "../entities/reservation-incident.entity";
import {
  CHANGE_ERROR,
  CHANGE_KIND,
  CHANGE_LIMITS,
  CHANGE_OFFER_STATUS,
  type ChangeErrorCode,
  changeOfferStateMachine,
  effectiveOfferStatus,
  isChangeEligibleReservation,
  resolveOfferExpiry,
  summarizeSnapshotForTraveler,
} from "../utils/reservation-change.util";
import { ReservationService } from "./reservation.service";
import {
  type BuiltOffer,
  changeError,
  ReservationChangeApplyService,
} from "./reservation-change-apply.service";
import { ReservationChangeQueryService } from "./reservation-change-query.service";
import { ReservationEventService } from "./reservation-event.service";

interface Deferred<T> {
  value?: T;
  error?: HttpException;
}

/**
 * F-PV7b (PDF §10): the host cannot provide the stay and V4P presents an
 * alternative (other unit, site or dates) through an internal route (D9).
 * Never unilateral: only «Aceptar alternativa» applies it, and only when it
 * is compatible with the dogs declared in the snapshot (re-checked at accept
 * time). Same money rules as proposals (D8). Rows locked reservation ->
 * alternative.
 */
@Injectable()
export class ReservationAlternativeService {
  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    @InjectRepository(ReservationAlternativeEntity)
    private readonly alternativeRepository: Repository<ReservationAlternativeEntity>,
    private readonly query: ReservationChangeQueryService,
    private readonly apply: ReservationChangeApplyService,
    private readonly economics: ReservationEconomicsService,
    private readonly reservationEventService: ReservationEventService,
    private readonly reservationService: ReservationService,
  ) {}

  // -------------------------------------------------------------- V4P side

  async quote(
    reservationId: number,
    dto: CreateAlternativeDto,
  ): Promise<ChangeOfferQuoteDto> {
    const reservation = await this.findReservationOrFail(reservationId);
    const built = await this.buildAlternative(reservation, dto);
    const before = summarizeSnapshotForTraveler(
      built.before.snapshot,
      built.before.site_name,
    );
    const after = summarizeSnapshotForTraveler(
      built.after.snapshot,
      built.after.site_name,
    );
    return {
      valid: built.valid,
      errors: built.errors,
      dogs_compatible: built.dogsCompatible,
      before,
      after,
      amount_delta_cents: built.amountDeltaCents,
      acceptable_in_panel: built.valid && built.amountDeltaCents <= 0,
    };
  }

  async create(
    reservationId: number,
    dto: CreateAlternativeDto,
    now: Date = new Date(),
  ): Promise<TravelerAlternativeDto> {
    const current = await this.findReservationOrFail(reservationId);
    if (!isChangeEligibleReservation(current, now)) {
      throw changeError(
        HttpStatus.CONFLICT,
        CHANGE_ERROR.NOT_ELIGIBLE,
        "The reservation can no longer be changed",
      );
    }
    const built = await this.buildAlternative(current, dto);
    if (!built.valid) {
      throw changeError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        built.onlyDogProblems
          ? CHANGE_ERROR.DOGS_INCOMPATIBLE
          : CHANGE_ERROR.INVALID_CHANGE,
        "The alternative is not valid for this reservation",
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

    const saved = await this.reservationRepository.manager.transaction(
      async manager => {
        const reservation = await this.lockReservation(manager, reservationId);
        if ((reservation.snapshot_version ?? null) !== basedOn) {
          throw changeError(
            HttpStatus.CONFLICT,
            CHANGE_ERROR.OFFER_OUTDATED,
            "The reservation changed; quote again",
          );
        }
        if (dto.incident_id !== undefined) {
          const incident = await manager
            .getRepository(ReservationIncidentEntity)
            .findOne({ where: { id: dto.incident_id } });
          if (incident?.reservation_id !== reservation.id) {
            throw new BadRequestException(
              "incident_id does not belong to this reservation",
            );
          }
        }
        const repository = manager.getRepository(ReservationAlternativeEntity);
        const pending = await repository.find({
          where: {
            reservation_id: reservation.id,
            status: CHANGE_OFFER_STATUS.PENDING_TRAVELER,
          },
        });
        for (const previous of pending) {
          previous.status = CHANGE_OFFER_STATUS.EXPIRED;
          previous.close_reason = "superseded";
          await repository.save(previous);
          await this.audit(
            manager,
            reservation.id,
            "alternative.expired",
            actor,
            {
              alternative_id: previous.id,
              reason: "superseded",
            },
          );
        }
        const row = await repository.save(
          repository.create({
            reservation_id: reservation.id,
            incident_id: dto.incident_id ?? null,
            before_payload: built.before,
            proposal_payload: built.after,
            amount_delta_cents: built.amountDeltaCents,
            status: CHANGE_OFFER_STATUS.PENDING_TRAVELER,
            expires_at: expiresAt,
            // The engine validated the declared dogs (valid quote); no dogs
            // declared = nothing to be incompatible with.
            compatible_with_dogs: built.dogsCompatible ?? true,
            based_on_snapshot_version: basedOn,
            resulting_snapshot_version: null,
            conditions: dto.conditions ?? null,
            message: dto.message ?? null,
            close_reason: null,
            responded_at: null,
          }),
        );
        await this.audit(
          manager,
          reservation.id,
          "alternative.created",
          actor,
          {
            alternative_id: row.id,
            site_id: built.after.target.site_id,
            room_id: built.after.target.room_id,
            amount_delta_cents: built.amountDeltaCents,
            based_on_snapshot_version: basedOn,
            incident_id: row.incident_id,
          },
        );
        await this.reservationEventService.logEventInTransaction(
          manager,
          reservation.id,
          "alternative_created",
          {
            alternative_id: row.id,
            amount_delta_cents: built.amountDeltaCents,
          },
        );
        return row;
      },
    );
    return this.query.toAlternativeDto(saved, true, now);
  }

  // ---------------------------------------------------------------- traveler

  /** «Aceptar alternativa». Same transactional apply as a change proposal. */
  async accept(
    userId: number,
    alternativeId: number,
    now: Date = new Date(),
  ): Promise<TravelerAlternativeAcceptResultDto> {
    this.assertUserId(userId);
    const peek = await this.findAlternativeOrFail(alternativeId);
    const actor = actors.traveler(userId);
    const outcome = await this.reservationRepository.manager.transaction(
      async (
        manager,
      ): Promise<Deferred<TravelerAlternativeAcceptResultDto>> => {
        const reservation = await this.lockReservation(
          manager,
          peek.reservation_id,
        );
        this.assertTravelerAccess(reservation, userId);
        const alternative = await this.lockAlternative(manager, alternativeId);
        const closed = await this.checkLiveOrExpire(
          manager,
          alternative,
          actor,
          now,
        );
        if (closed) {
          return { error: closed };
        }
        const invalidate = async (
          code: ChangeErrorCode,
          status: HttpStatus,
          message: string,
        ): Promise<Deferred<TravelerAlternativeAcceptResultDto>> => {
          await this.expire(manager, alternative, code, actor);
          return { error: changeError(status, code, message) };
        };
        if (alternative.compatible_with_dogs !== true) {
          throw changeError(
            HttpStatus.BAD_REQUEST,
            CHANGE_ERROR.DOGS_INCOMPATIBLE,
            "The alternative is not compatible with the declared dogs",
          );
        }
        if (!isChangeEligibleReservation(reservation, now)) {
          return invalidate(
            CHANGE_ERROR.NOT_ELIGIBLE,
            HttpStatus.CONFLICT,
            "The reservation can no longer be changed",
          );
        }
        if (
          (reservation.snapshot_version ?? null) !==
          alternative.based_on_snapshot_version
        ) {
          return invalidate(
            CHANGE_ERROR.OFFER_OUTDATED,
            HttpStatus.CONFLICT,
            "The reservation changed after this alternative",
          );
        }
        const delta = Number(alternative.amount_delta_cents);
        if (delta > 0) {
          throw changeError(
            HttpStatus.CONFLICT,
            CHANGE_ERROR.PAYMENT_REQUIRED,
            "This alternative needs an extra payment; V4P will contact the traveler",
          );
        }
        if (
          delta < 0 &&
          (!reservation.stripe_payment_intent_id ||
            reservation.payout_status === "released")
        ) {
          throw changeError(
            HttpStatus.CONFLICT,
            CHANGE_ERROR.REFUND_NOT_POSSIBLE,
            "The difference cannot be refunded automatically",
          );
        }
        const check = await this.apply.revalidate(
          alternative.proposal_payload,
          reservation,
        );
        if (!check.ok) {
          return invalidate(
            check.code,
            check.code === CHANGE_ERROR.DOGS_INCOMPATIBLE
              ? HttpStatus.BAD_REQUEST
              : HttpStatus.CONFLICT,
            "The alternative is no longer possible",
          );
        }
        let applied;
        try {
          applied = await this.apply.applyInTransaction(manager, reservation, {
            kind: CHANGE_KIND.ALTERNATIVE,
            offerId: alternative.id,
            requestId: null,
            offer: alternative.proposal_payload,
            amountDeltaCents: delta,
            basedOnSnapshotVersion: alternative.based_on_snapshot_version,
            reason: SNAPSHOT_REASON.ALTERNATIVE_ACCEPTED,
            actor,
            now,
          });
        } catch (error) {
          if (this.apply.isUnavailableError(error)) {
            return invalidate(
              CHANGE_ERROR.UNAVAILABLE,
              HttpStatus.CONFLICT,
              "The alternative is no longer available",
            );
          }
          throw error;
        }
        changeOfferStateMachine.assertTransition(
          alternative.status,
          CHANGE_OFFER_STATUS.ACCEPTED,
        );
        alternative.status = CHANGE_OFFER_STATUS.ACCEPTED;
        alternative.resulting_snapshot_version = applied.snapshotVersion;
        alternative.responded_at = now;
        await manager
          .getRepository(ReservationAlternativeEntity)
          .save(alternative);
        await this.audit(
          manager,
          reservation.id,
          "alternative.accepted",
          actor,
          {
            alternative_id: alternative.id,
            amount_delta_cents: delta,
            snapshot_version: applied.snapshotVersion,
            previous_snapshot_version: applied.previousSnapshotVersion,
            refund_cents: applied.refundCents,
          },
        );
        await this.reservationEventService.logEventInTransaction(
          manager,
          reservation.id,
          "alternative_accepted",
          { alternative_id: alternative.id },
        );
        return {
          value: {
            applied: true,
            snapshot_version: applied.snapshotVersion,
            previous_snapshot_version: applied.previousSnapshotVersion,
            amount_delta_cents: delta,
            refund_cents: applied.refundCents,
            refund_initiated: applied.refundInitiated,
            alternative: this.query.toAlternativeDto(alternative, false, now),
          },
        };
      },
    );
    if (outcome.error || !outcome.value) {
      throw outcome.error ?? new BadRequestException("Alternative not applied");
    }
    return outcome.value;
  }

  /** «No aceptar»: the reservation stays exactly as it is. */
  async reject(
    userId: number,
    alternativeId: number,
    now: Date = new Date(),
  ): Promise<TravelerAlternativeDto> {
    this.assertUserId(userId);
    const peek = await this.findAlternativeOrFail(alternativeId);
    const actor = actors.traveler(userId);
    const outcome = await this.reservationRepository.manager.transaction(
      async (manager): Promise<Deferred<TravelerAlternativeDto>> => {
        const reservation = await this.lockReservation(
          manager,
          peek.reservation_id,
        );
        this.assertTravelerAccess(reservation, userId);
        const alternative = await this.lockAlternative(manager, alternativeId);
        const closed = await this.checkLiveOrExpire(
          manager,
          alternative,
          actor,
          now,
        );
        if (closed) {
          return { error: closed };
        }
        alternative.status = CHANGE_OFFER_STATUS.REJECTED;
        alternative.close_reason = "declined";
        alternative.responded_at = now;
        await manager
          .getRepository(ReservationAlternativeEntity)
          .save(alternative);
        await this.audit(
          manager,
          reservation.id,
          "alternative.rejected",
          actor,
          {
            alternative_id: alternative.id,
          },
        );
        await this.reservationEventService.logEventInTransaction(
          manager,
          reservation.id,
          "alternative_rejected",
          { alternative_id: alternative.id },
        );
        return { value: this.query.toAlternativeDto(alternative, false, now) };
      },
    );
    if (outcome.error || !outcome.value) {
      throw (
        outcome.error ?? new BadRequestException("Alternative not rejected")
      );
    }
    return outcome.value;
  }

  // --------------------------------------------------------------- helpers

  private async buildAlternative(
    reservation: ReservationEntity,
    dto: CreateAlternativeDto,
  ): Promise<BuiltOffer> {
    const snapshot = await this.apply.loadCurrentSnapshot(reservation);
    if (!snapshot) {
      throw changeError(
        HttpStatus.CONFLICT,
        CHANGE_ERROR.SNAPSHOT_REQUIRED,
        "Reservation without snapshot",
      );
    }
    // 404 when the alternative site does not exist; the current one may be
    // missing in legacy data (name only).
    const afterSite = await this.reservationService.getSiteById(dto.site_id);
    let beforeName: string | null = null;
    try {
      beforeName =
        (await this.reservationService.getSiteById(reservation.site_id)).name ??
        null;
    } catch {
      beforeName = null;
    }
    return this.apply.buildOffer({
      reservation,
      snapshot,
      overrides: {
        site_id: dto.site_id,
        room_id: dto.room_id,
        checkin: dto.checkin,
        checkout: dto.checkout,
        guests: dto.guests,
        board_option_id: dto.board_option_id,
        services: dto.services,
        extras: dto.extras,
      },
      adjustmentCents: dto.adjustment_cents,
      adjustmentDescription: dto.adjustment_description,
      source: SNAPSHOT_REASON.ALTERNATIVE_ACCEPTED,
      siteNameBefore: beforeName,
      siteNameAfter: afterSite.name ?? null,
    });
  }

  private async checkLiveOrExpire(
    manager: EntityManager,
    alternative: ReservationAlternativeEntity,
    actor: Actor,
    now: Date,
  ): Promise<HttpException | null> {
    if (alternative.status !== CHANGE_OFFER_STATUS.PENDING_TRAVELER) {
      const expired = alternative.status === CHANGE_OFFER_STATUS.EXPIRED;
      return changeError(
        expired ? HttpStatus.GONE : HttpStatus.CONFLICT,
        expired ? CHANGE_ERROR.OFFER_EXPIRED : CHANGE_ERROR.OFFER_CLOSED,
        "This alternative can no longer be answered",
      );
    }
    if (
      effectiveOfferStatus(alternative, now) === CHANGE_OFFER_STATUS.EXPIRED
    ) {
      await this.expire(manager, alternative, "expired", actor);
      return changeError(
        HttpStatus.GONE,
        CHANGE_ERROR.OFFER_EXPIRED,
        "This alternative has expired",
      );
    }
    return null;
  }

  private async expire(
    manager: EntityManager,
    alternative: ReservationAlternativeEntity,
    reason: string,
    actor: Actor,
  ): Promise<void> {
    changeOfferStateMachine.assertTransition(
      alternative.status,
      CHANGE_OFFER_STATUS.EXPIRED,
    );
    alternative.status = CHANGE_OFFER_STATUS.EXPIRED;
    alternative.close_reason = reason;
    await manager.getRepository(ReservationAlternativeEntity).save(alternative);
    await this.audit(
      manager,
      alternative.reservation_id,
      "alternative.expired",
      actor,
      {
        alternative_id: alternative.id,
        reason,
      },
    );
  }

  private async audit(
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

  private async findReservationOrFail(id: number): Promise<ReservationEntity> {
    const reservation = await this.reservationRepository.findOne({
      where: { id },
    });
    if (!reservation) {
      throw new NotFoundException(`Reservation with id ${id} not found`);
    }
    return reservation;
  }

  private async findAlternativeOrFail(
    id: number,
  ): Promise<ReservationAlternativeEntity> {
    const row = await this.alternativeRepository.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException(`Alternative with id ${id} not found`);
    }
    return row;
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

  private async lockAlternative(
    manager: EntityManager,
    id: number,
  ): Promise<ReservationAlternativeEntity> {
    const row = await manager
      .getRepository(ReservationAlternativeEntity)
      .findOne({ where: { id }, lock: { mode: "pessimistic_write" } });
    if (!row) {
      throw new NotFoundException(`Alternative with id ${id} not found`);
    }
    return row;
  }

  private assertUserId(userId: number): void {
    if (!Number.isInteger(userId) || userId < 1) {
      throw new BadRequestException("Invalid traveler user_id");
    }
  }

  private assertTravelerAccess(
    reservation: ReservationEntity,
    userId: number,
  ): void {
    if (userId < 1 || reservation.user_id !== userId) {
      throw new ForbiddenException("Reservation access denied");
    }
  }
}
