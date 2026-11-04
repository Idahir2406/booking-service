import type {
  AdminChangeRequestDto,
  TravelerAlternativeDto,
  TravelerChangeProposalDto,
  TravelerChangeRequestDto,
  TravelerChangesDto,
} from "../dto/reservation-change.dto";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";

import { ReservationEntity } from "../entities/reservation.entity";
import { ReservationAlternativeEntity } from "../entities/reservation-alternative.entity";
import { ReservationChangeProposalEntity } from "../entities/reservation-change-proposal.entity";
import { ReservationChangeRequestEntity } from "../entities/reservation-change-request.entity";
import {
  CHANGE_OFFER_STATUS,
  CHANGE_REQUEST_STATUS,
  CHANGE_REQUEST_TYPES,
  effectiveOfferStatus,
  isChangeEligibleReservation,
  isLiveOffer,
  isOpenChangeRequestStatus,
  OPEN_CHANGE_REQUEST_STATUSES,
  summarizeSnapshotForTraveler,
} from "../utils/reservation-change.util";

export interface PendingOfferFlags {
  has_pending_change_proposal: boolean;
  has_pending_alternative: boolean;
}

/** Newest first, stable (created_at can tie within the same millisecond). */
function newestFirst<T extends { id: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.id - a.id);
}

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * F-PV7b read side (no writes, no transactions): traveler DTOs of change
 * requests / proposals / alternatives, panel capability and home alert
 * flags. Expired offers are shown as expired without writing (a GET never
 * has side effects); the write paths persist the expiry.
 */
@Injectable()
export class ReservationChangeQueryService {
  constructor(
    @InjectRepository(ReservationChangeRequestEntity)
    private readonly requestRepository: Repository<ReservationChangeRequestEntity>,
    @InjectRepository(ReservationChangeProposalEntity)
    private readonly proposalRepository: Repository<ReservationChangeProposalEntity>,
    @InjectRepository(ReservationAlternativeEntity)
    private readonly alternativeRepository: Repository<ReservationAlternativeEntity>,
  ) {}

  /** Caller already checked ownership. */
  async loadForReservation(
    reservation: ReservationEntity,
    now: Date = new Date(),
  ): Promise<TravelerChangesDto> {
    const [requests, proposals, alternatives] = await Promise.all([
      this.requestRepository.find({
        where: { reservation_id: reservation.id },
        order: { created_at: "DESC" },
      }),
      this.proposalRepository.find({
        where: { reservation_id: reservation.id },
        order: { created_at: "DESC" },
      }),
      this.alternativeRepository.find({
        where: { reservation_id: reservation.id },
        order: { created_at: "DESC" },
      }),
    ]);
    const eligible = isChangeEligibleReservation(reservation, now);
    const hasOpen = requests.some(row => isOpenChangeRequestStatus(row.status));
    return {
      requests: newestFirst(requests).map(row =>
        this.toRequestDto(
          row,
          proposals.filter(proposal => proposal.request_id === row.id),
          eligible,
          now,
        ),
      ),
      alternatives: newestFirst(alternatives).map(row =>
        this.toAlternativeDto(row, eligible, now),
      ),
      can_request_change: eligible && !hasOpen,
      change_types: [...CHANGE_REQUEST_TYPES],
    };
  }

  /** Panel capability without loading the payloads. */
  async canRequestChange(
    reservation: ReservationEntity,
    now: Date,
  ): Promise<boolean> {
    if (!isChangeEligibleReservation(reservation, now)) {
      return false;
    }
    const open = await this.requestRepository.count({
      where: {
        reservation_id: reservation.id,
        status: In([...OPEN_CHANGE_REQUEST_STATUSES]),
      },
    });
    return open === 0;
  }

  /** Home alerts: live (pending, not expired) offers per reservation. */
  async findPendingOfferFlags(
    reservationIds: number[],
    now: Date,
  ): Promise<Map<number, PendingOfferFlags>> {
    const flags = new Map<number, PendingOfferFlags>();
    if (reservationIds.length === 0) {
      return flags;
    }
    const where = {
      reservation_id: In(reservationIds),
      status: CHANGE_OFFER_STATUS.PENDING_TRAVELER,
    };
    const [proposals, alternatives] = await Promise.all([
      this.proposalRepository.find({ where }),
      this.alternativeRepository.find({ where }),
    ]);
    const get = (id: number): PendingOfferFlags => {
      let entry = flags.get(id);
      if (!entry) {
        entry = {
          has_pending_change_proposal: false,
          has_pending_alternative: false,
        };
        flags.set(id, entry);
      }
      return entry;
    };
    for (const row of proposals) {
      if (isLiveOffer(row, now)) {
        get(row.reservation_id).has_pending_change_proposal = true;
      }
    }
    for (const row of alternatives) {
      if (isLiveOffer(row, now)) {
        get(row.reservation_id).has_pending_alternative = true;
      }
    }
    return flags;
  }

  async loadRequestDto(
    request: ReservationChangeRequestEntity,
    reservation: ReservationEntity | null,
    now: Date,
  ): Promise<TravelerChangeRequestDto> {
    const proposals = await this.proposalRepository.find({
      where: { request_id: request.id },
      order: { created_at: "DESC" },
    });
    return this.toRequestDto(
      request,
      proposals,
      reservation ? isChangeEligibleReservation(reservation, now) : false,
      now,
    );
  }

  async listForAdmin(openOnly: boolean): Promise<AdminChangeRequestDto[]> {
    const requests = await this.requestRepository.find({
      where: openOnly
        ? { status: In([...OPEN_CHANGE_REQUEST_STATUSES]) }
        : undefined,
      order: { created_at: "DESC" },
      take: 100,
    });
    const now = new Date();
    return requests.map(row => ({
      ...this.toRequestDto(row, [], false, now),
      user_id: row.user_id,
    }));
  }

  toRequestDto(
    row: ReservationChangeRequestEntity,
    proposals: ReservationChangeProposalEntity[],
    reservationEligible: boolean,
    now: Date,
  ): TravelerChangeRequestDto {
    const open = isOpenChangeRequestStatus(row.status);
    const proposalDtos = newestFirst(proposals).map(proposal =>
      this.toProposalDto(proposal, open && reservationEligible, now),
    );
    const hasLive = proposals.some(proposal => isLiveOffer(proposal, now));
    const status =
      row.status === CHANGE_REQUEST_STATUS.PROPOSAL_SENT && !hasLive
        ? CHANGE_REQUEST_STATUS.IN_REVIEW
        : row.status;
    return {
      id: row.id,
      reservation_id: row.reservation_id,
      type: row.type,
      message: row.message ?? null,
      status,
      response_note: row.response_note ?? null,
      created_at: iso(row.created_at) ?? "",
      updated_at: iso(row.updated_at) ?? "",
      can_cancel: open,
      proposals: proposalDtos,
    };
  }

  toProposalDto(
    row: ReservationChangeProposalEntity,
    acceptable: boolean,
    now: Date,
  ): TravelerChangeProposalDto {
    const status = effectiveOfferStatus(row, now);
    const live = status === CHANGE_OFFER_STATUS.PENDING_TRAVELER;
    const delta = Number(row.amount_delta_cents);
    const before = summarizeSnapshotForTraveler(
      row.before_payload.snapshot,
      row.before_payload.site_name,
    );
    const after = summarizeSnapshotForTraveler(
      row.after_payload.snapshot,
      row.after_payload.site_name,
    );
    return {
      id: row.id,
      request_id: row.request_id,
      status,
      before,
      after,
      previous_total_cents: before.total_cents,
      new_total_cents: after.total_cents,
      amount_delta_cents: delta,
      currency: after.currency,
      conditions: row.conditions ?? null,
      message: row.message ?? null,
      expires_at: iso(row.expires_at) ?? "",
      responded_at: iso(row.responded_at),
      requires_payment: delta > 0,
      refund_cents: delta < 0 ? -delta : 0,
      can_accept: live && acceptable && delta <= 0,
      can_reject: live,
    };
  }

  toAlternativeDto(
    row: ReservationAlternativeEntity,
    reservationEligible: boolean,
    now: Date,
  ): TravelerAlternativeDto {
    const status = effectiveOfferStatus(row, now);
    const live = status === CHANGE_OFFER_STATUS.PENDING_TRAVELER;
    const delta = Number(row.amount_delta_cents);
    const before = summarizeSnapshotForTraveler(
      row.before_payload.snapshot,
      row.before_payload.site_name,
    );
    const after = summarizeSnapshotForTraveler(
      row.proposal_payload.snapshot,
      row.proposal_payload.site_name,
    );
    const compatible =
      row.compatible_with_dogs === null ||
      row.compatible_with_dogs === undefined
        ? null
        : Boolean(row.compatible_with_dogs);
    return {
      id: row.id,
      reservation_id: row.reservation_id,
      status,
      before,
      after,
      previous_total_cents: before.total_cents,
      new_total_cents: after.total_cents,
      amount_delta_cents: delta,
      currency: after.currency,
      compatible_with_dogs: compatible,
      conditions: row.conditions ?? null,
      message: row.message ?? null,
      expires_at: iso(row.expires_at) ?? "",
      responded_at: iso(row.responded_at),
      requires_payment: delta > 0,
      refund_cents: delta < 0 ? -delta : 0,
      can_accept:
        live && reservationEligible && delta <= 0 && compatible === true,
      can_reject: live,
    };
  }
}
