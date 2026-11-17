import type {
  TravelerCapabilitiesDto,
  TravelerDashboardDto,
  TravelerDogSummaryDto,
  TravelerFeedbackSummaryDto,
  TravelerPaymentDto,
  TravelerPolicyDto,
  TravelerPriceLineDto,
  TravelerRefundDto,
  TravelerReservationCardDto,
  TravelerReservationDetailDto,
  TravelerReservationDogDto,
  TravelerReservationListDto,
} from "../dto/traveler-panel.dto";

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";

import {
  type PriceLineDraft,
  summarizePriceLines,
} from "../../payments/domain/price-lines";
import {
  CURRENT_REFUND_RULE,
  type ReservationSnapshotPayload,
  type SnapshotCompatibility,
  type SnapshotDeposit,
  type SnapshotDog,
  type SnapshotDogPolicy,
  type SnapshotSchedule,
  type SnapshotSelectedExtra,
  type SnapshotSelectedService,
  type SnapshotStay,
} from "../../payments/domain/reservation-snapshot";
import { PaymentEntity } from "../../payments/entities/payment.entity";
import { RefundEntity } from "../../payments/entities/refund.entity";
import { ReservationSnapshotEntity } from "../../payments/entities/reservation-snapshot.entity";
import { PriceLinesService } from "../../payments/services/price-lines.service";
import { ReservationSnapshotService } from "../../payments/services/reservation-snapshot.service";
import { envs } from "../../shared/configs/envs";
import { MysqlService } from "../../shared/services/mysql.service";
import { formatScheduleText } from "../../site-wizard/utils/site-schedule.utils";
import { TravelerDogsService } from "../../traveler-dogs/services/traveler-dogs.service";
import { ReservationEntity } from "../entities/reservation.entity";
import { ReservationDisputeEntity } from "../entities/reservation-dispute.entity";
import { ReservationGuestFeedbackEntity } from "../entities/reservation-guest-feedback.entity";
import { isPartiallyRefundedByChangeOnly } from "../utils/change-refund.util";
import {
  resolveSnapshotRefundDeadlineIso,
  resolveTravelerCancellationQuote,
  TRAVELER_CANCELLATION_REASON,
  travelerPolicyAllowsCancel,
} from "../utils/refund-policy.util";
import { expectedChargeCents } from "../utils/reservation-amount.util";
import {
  type IncidentType,
  resolveReportableIncidentTypes,
} from "../utils/reservation-incident.util";
import { parseIsoDateAtUtcMidnight } from "../utils/reservation-policy.util";
import {
  buildTravelerAlerts,
  type TravelerAlertCandidate,
} from "../utils/traveler-alerts.util";
import {
  composeSiteAddress,
  resolveDogsCompatible,
} from "../utils/traveler-detail.util";
import {
  isAbandonedPendingCheckout,
  mapPaymentLabelKey,
  mapRefundLabelKey,
  mapTravelerFacingStatus,
  resolveTravelerPayability,
  resolveTravelerTab,
  TRAVELER_STATUS,
  TRAVELER_TAB,
  type TravelerStatusResult,
  type TravelerTab,
} from "../utils/traveler-panel-status.util";
import { ReservationChangeQueryService } from "./reservation-change-query.service";
import { ReservationIncidentService } from "./reservation-incident.service";

/** Legacy site data for the card (jsites1 + first jsites2 row). */
interface TravelerSiteRow {
  id: number;
  name: string | null;
  alias_l1: string | null;
  poblacio: string | null;
  provincia: string | null;
  image1: string | null;
}

interface CardFlags {
  has_open_dispute: boolean;
  has_pending_refund: boolean;
  /** F-PV7a: open reservation_incidents (received/in_review/needs_info). */
  open_incident_types: IncidentType[];
  /** F-PV7b: partially_refunded only by accepted-change adjustments. */
  partial_refund_from_change: boolean;
}

const NO_FLAGS: CardFlags = {
  has_open_dispute: false,
  has_pending_refund: false,
  open_incident_types: [],
  partial_refund_from_change: false,
};

interface DashboardDogs {
  dogs: TravelerDogSummaryDto[];
  available: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Legacy text columns store "" for missing values. */
function nonEmpty(value: string | null | undefined): string | null {
  return value === null || value === undefined || value === "" ? null : value;
}

/**
 * Read-only traveler panel (F-PV1). Ownership is `reservations.user_id`;
 * the PHP proxy sets user_id from the session. Detail data always comes
 * from the frozen snapshot, never from live host policy.
 */
@Injectable()
export class TravelerReservationPanelService {
  private readonly logger = new Logger(TravelerReservationPanelService.name);

  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    @InjectRepository(ReservationDisputeEntity)
    private readonly disputeRepository: Repository<ReservationDisputeEntity>,
    @InjectRepository(RefundEntity)
    private readonly refundRepository: Repository<RefundEntity>,
    @InjectRepository(PaymentEntity)
    private readonly paymentRepository: Repository<PaymentEntity>,
    @InjectRepository(ReservationSnapshotEntity)
    private readonly snapshotRepository: Repository<ReservationSnapshotEntity>,
    @InjectRepository(ReservationGuestFeedbackEntity)
    private readonly feedbackRepository: Repository<ReservationGuestFeedbackEntity>,
    private readonly snapshots: ReservationSnapshotService,
    private readonly priceLines: PriceLinesService,
    private readonly mysqlService: MysqlService,
    private readonly travelerDogs: TravelerDogsService,
    private readonly incidents: ReservationIncidentService,
    private readonly changes: ReservationChangeQueryService,
  ) {}

  async listForTraveler(
    userId: number,
    tab: TravelerTab,
    limit = 20,
    offset = 0,
  ): Promise<TravelerReservationListDto> {
    this.assertTravelerUserId(userId);
    const now = new Date();
    const rows = await this.loadVisibleRows(userId, now);
    const filtered = this.filterTab(rows, tab, now);

    const page = filtered.slice(offset, offset + limit);
    const ids = page.map(row => row.id);
    const [flags, sites, snapshotsById] = await Promise.all([
      this.loadCardFlags(page),
      this.loadSitesByIds([...new Set(page.map(row => row.site_id))]),
      this.loadSnapshotsByReservation(page),
    ]);

    return {
      items: page.map(row =>
        this.buildCard(
          row,
          snapshotsById.get(row.id) ?? null,
          sites.get(row.site_id) ?? null,
          flags.get(row.id) ?? NO_FLAGS,
          now,
        ),
      ),
      total: filtered.length,
      limit,
      offset,
    };
  }

  async getDetailForTraveler(
    userId: number,
    reservationId: number,
  ): Promise<TravelerReservationDetailDto> {
    const reservation = await this.reservationRepository.findOne({
      where: { id: reservationId },
    });
    if (!reservation) {
      throw new NotFoundException(
        `Reservation with id ${reservationId} not found`,
      );
    }
    if (userId < 1 || reservation.user_id !== userId) {
      throw new ForbiddenException("Reservation access denied");
    }

    const now = new Date();
    const [
      snapshot,
      flags,
      sites,
      payments,
      refunds,
      feedback,
      incidents,
      changes,
    ] = await Promise.all([
      this.loadSnapshotPayload(reservation),
      this.loadCardFlags([reservation]),
      this.loadSitesByIds([reservation.site_id]),
      this.paymentRepository.find({
        where: { reservation_id: reservation.id },
        order: { created_at: "ASC" },
      }),
      this.refundRepository.find({
        where: { reservation_id: reservation.id },
        order: { created_at: "ASC" },
      }),
      this.feedbackRepository.findOne({
        where: { reservation_id: reservation.id },
      }),
      this.incidents.listDtosForReservation(reservation.id),
      this.changes.loadForReservation(reservation, now),
    ]);

    const detailFlags = flags.get(reservation.id) ?? NO_FLAGS;
    const card = this.buildCard(
      reservation,
      snapshot,
      sites.get(reservation.site_id) ?? null,
      detailFlags,
      now,
    );

    const lines: PriceLineDraft[] = snapshot
      ? snapshot.price_lines
      : await this.priceLines.findByReservation(reservation.id);
    const dogs = this.snapshotList<SnapshotDog>(snapshot, "dogs");
    const compatibility = this.snapshotField<SnapshotCompatibility>(
      snapshot,
      "compatibility",
    );
    const site = sites.get(reservation.site_id) ?? null;

    return {
      card,
      stay: snapshot?.stay ?? this.buildLegacyStay(reservation),
      room: snapshot?.room ?? null,
      board: snapshot?.board ?? null,
      dogs: dogs.map(dog => this.toDetailDog(dog)),
      dog_policy: this.snapshotField<SnapshotDogPolicy>(snapshot, "dog_policy"),
      compatibility,
      deposit: this.snapshotField<SnapshotDeposit>(snapshot, "deposit"),
      services: this.snapshotList<SnapshotSelectedService>(
        snapshot,
        "services",
      ),
      extras: this.snapshotList<SnapshotSelectedExtra>(snapshot, "extras"),
      price_lines: lines.map(line => this.toPriceLineDto(line)),
      totals: snapshot?.totals ?? summarizePriceLines(lines),
      policy: this.buildPolicy(reservation, snapshot),
      payments: payments.map(payment => this.toPaymentDto(payment)),
      refunds: refunds.map(refund => this.toRefundDto(refund)),
      capabilities: this.buildCapabilities(
        reservation,
        !!feedback,
        detailFlags,
        now,
        changes.can_request_change,
      ),
      snapshot_version: snapshot ? (reservation.snapshot_version ?? 1) : null,
      incidents,
      site_address: site
        ? composeSiteAddress({ town: site.poblacio, province: site.provincia })
        : null,
      cribs: reservation.cribs ?? 0,
      schedule_text: formatScheduleText(
        this.snapshotField<SnapshotSchedule>(snapshot, "schedule"),
        reservation.arrival_time ?? null,
      ),
      dogs_compatible: resolveDogsCompatible(
        compatibility,
        dogs.length > 0 ? dogs.length : (snapshot?.stay.pets ?? 0),
      ),
      my_feedback: feedback ? this.toFeedbackSummary(feedback) : null,
      change_requests: changes.requests,
      alternatives: changes.alternatives,
      change_types: changes.change_types,
    };
  }

  /**
   * Home dashboard (F-PV6). Read-only, one round-trip: next trip (same list
   * logic as the upcoming tab), saved dogs and alerts. Alerts come from the
   * pure buildTravelerAlerts with the F-PV4 resolver (frozen snapshot), never
   * from live host policy. `now` is injectable for tests.
   */
  async getDashboard(
    userId: number,
    now: Date = new Date(),
  ): Promise<TravelerDashboardDto> {
    this.assertTravelerUserId(userId);
    const rows = await this.loadVisibleRows(userId, now);
    const upcoming = this.filterTab(rows, TRAVELER_TAB.UPCOMING, now);

    const [flags, sites, snapshotsById, dogs, offers] = await Promise.all([
      this.loadCardFlags(rows),
      this.loadSitesByIds([...new Set(rows.map(row => row.site_id))]),
      // Only upcoming rows can still be cancelled (checkout in the future).
      this.loadSnapshotsByReservation(upcoming),
      this.loadDashboardDogs(userId),
      this.changes.findPendingOfferFlags(
        upcoming.map(row => row.id),
        now,
      ),
    ]);
    const upcomingIds = new Set(upcoming.map(row => row.id));

    const candidates: TravelerAlertCandidate[] = rows.map(row => {
      const rowFlags = flags.get(row.id) ?? NO_FLAGS;
      const snapshot = snapshotsById.get(row.id) ?? null;
      const { status } = this.mapStatus(row, rowFlags);
      return {
        reservation_id: row.id,
        code: this.reservationCode(row),
        site_name:
          nonEmpty(sites.get(row.site_id)?.name) ??
          snapshot?.room?.name ??
          null,
        status,
        has_pending_refund: rowFlags.has_pending_refund,
        has_open_incident: rowFlags.open_incident_types.length > 0,
        // Reason does not change the deadline (only force_majeure changes
        // the amounts), so any non-exceptional reason gives the free window.
        free_cancel:
          status === TRAVELER_STATUS.CONFIRMED && upcomingIds.has(row.id)
            ? resolveTravelerCancellationQuote({
                reservation: row,
                snapshot,
                reason: TRAVELER_CANCELLATION_REASON.CHANGE_OF_PLANS,
                now,
                partial_refund_from_change: rowFlags.partial_refund_from_change,
              })
            : null,
        // F-PV7b: live (pending, not expired) offers of upcoming stays.
        has_pending_change_proposal:
          offers.get(row.id)?.has_pending_change_proposal ?? false,
        has_pending_alternative:
          offers.get(row.id)?.has_pending_alternative ?? false,
      };
    });

    const next = upcoming.at(0);
    return {
      next_trip: next
        ? this.buildCard(
            next,
            snapshotsById.get(next.id) ?? null,
            sites.get(next.site_id) ?? null,
            flags.get(next.id) ?? NO_FLAGS,
            now,
          )
        : null,
      upcoming_count: upcoming.length,
      dogs: dogs.dogs,
      dogs_available: dogs.available,
      alerts: buildTravelerAlerts({ reservations: candidates }, now),
    };
  }

  private assertTravelerUserId(userId: number): void {
    if (!Number.isInteger(userId) || userId < 1) {
      throw new BadRequestException("Invalid traveler user_id");
    }
  }

  /**
   * A traveler has few reservations: the abandoned-checkout filter runs in
   * memory over the (user_id, checkin) index range.
   */
  private async loadVisibleRows(
    userId: number,
    now: Date,
  ): Promise<ReservationEntity[]> {
    const rows = await this.reservationRepository.find({
      where: { user_id: userId },
    });
    return rows.filter(row => !isAbandonedPendingCheckout(row, now));
  }

  private filterTab(
    rows: ReservationEntity[],
    tab: TravelerTab,
    now: Date,
  ): ReservationEntity[] {
    return rows
      .filter(row => resolveTravelerTab(row, now) === tab)
      .sort((a, b) => this.compareByCheckin(a, b, tab));
  }

  /** Saved dogs never break the home (e.g. traveler_dogs migration pending). */
  private async loadDashboardDogs(userId: number): Promise<DashboardDogs> {
    try {
      const list = await this.travelerDogs.list(userId);
      return {
        dogs: list.items.map(dog => ({
          id: dog.id,
          name: dog.name,
          photo_path: dog.photo_path,
          size: dog.size,
        })),
        available: true,
      };
    } catch (error) {
      this.logger.error(
        `Traveler dashboard dogs lookup failed for user ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { dogs: [], available: false };
    }
  }

  private mapStatus(
    reservation: ReservationEntity,
    flags: CardFlags,
  ): TravelerStatusResult {
    return mapTravelerFacingStatus({
      reservation,
      has_open_dispute: flags.has_open_dispute,
      has_pending_refund: flags.has_pending_refund,
      has_open_incident: flags.open_incident_types.length > 0,
      partial_refund_from_change: flags.partial_refund_from_change,
    });
  }

  private reservationCode(reservation: Pick<ReservationEntity, "id">): string {
    return `#RES-${reservation.id}`;
  }

  private compareByCheckin(
    a: ReservationEntity,
    b: ReservationEntity,
    tab: TravelerTab,
  ): number {
    const byDate = a.checkin.slice(0, 10).localeCompare(b.checkin.slice(0, 10));
    const ordered = byDate === 0 ? a.id - b.id : byDate;
    return tab === TRAVELER_TAB.UPCOMING ? ordered : -ordered;
  }

  private buildCard(
    reservation: ReservationEntity,
    snapshot: ReservationSnapshotPayload | null,
    site: TravelerSiteRow | null,
    flags: CardFlags,
    now: Date,
  ): TravelerReservationCardDto {
    const mapped = this.mapStatus(reservation, flags);
    if (mapped.is_fallback) {
      this.logger.warn(
        `Traveler status fallback for reservation ${reservation.id} (status=${reservation.status}, payment_status=${reservation.payment_status})`,
      );
    }
    const roomName = snapshot?.room?.name ?? null;
    const payability = resolveTravelerPayability(reservation, now);
    return {
      id: reservation.id,
      code: this.reservationCode(reservation),
      site_id: reservation.site_id,
      site_name: nonEmpty(site?.name) ?? roomName,
      site_alias: site?.alias_l1 ?? null,
      site_town: site?.poblacio ?? null,
      site_province: site?.provincia ?? null,
      site_image_file: nonEmpty(site?.image1),
      room_name: roomName,
      checkin: reservation.checkin,
      checkout: reservation.checkout,
      nights: snapshot?.stay.nights ?? this.countNights(reservation),
      guests: reservation.guests,
      dogs_count: reservation.pets,
      status: mapped.status,
      tab: resolveTravelerTab(reservation, now),
      total_cents: snapshot?.total_cents ?? expectedChargeCents(reservation),
      currency: snapshot?.currency ?? reservation.currency ?? "eur",
      can_pay: payability.can_pay,
      pay_expires_at: payability.pay_expires_at,
    };
  }

  private buildLegacyStay(reservation: ReservationEntity): SnapshotStay {
    return {
      site_id: reservation.site_id,
      checkin: reservation.checkin,
      checkout: reservation.checkout,
      nights: this.countNights(reservation),
      guests: reservation.guests,
      pets: reservation.pets,
    };
  }

  private countNights(
    reservation: Pick<ReservationEntity, "checkin" | "checkout">,
  ): number {
    const diff =
      parseIsoDateAtUtcMidnight(reservation.checkout).getTime() -
      parseIsoDateAtUtcMidnight(reservation.checkin).getTime();
    return Number.isFinite(diff) ? Math.max(0, Math.round(diff / DAY_MS)) : 0;
  }

  private buildPolicy(
    reservation: ReservationEntity,
    snapshot: ReservationSnapshotPayload | null,
  ): TravelerPolicyDto {
    const rule = snapshot?.refund_policy;
    return {
      rule: rule?.rule ?? CURRENT_REFUND_RULE,
      refund_deadline_iso: resolveSnapshotRefundDeadlineIso(
        snapshot,
        reservation,
      ),
      timezone: rule?.timezone ?? reservation.timezone ?? null,
      generated_text: rule?.generated_text ?? null,
      is_structured: !!rule?.cancellation,
      ...this.buildChargeInfo(reservation),
    };
  }

  /** Fase 5: deferred-charge state shown next to the policy (flexible). */
  private buildChargeInfo(
    reservation: ReservationEntity,
  ): Pick<
    TravelerPolicyDto,
    | "charge_mode"
    | "charge_pending"
    | "charge_at_iso"
    | "regularization_deadline_iso"
  > {
    const flexible = reservation.charge_mode === "flexible";
    const pending =
      flexible &&
      reservation.status === "confirmed" &&
      reservation.payment_status === "pending";
    const iso = (value: Date | null | undefined): string | null => {
      if (!value) {
        return null;
      }
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };
    return {
      charge_mode: flexible ? "flexible" : "immediate",
      charge_pending: pending,
      charge_at_iso: pending ? iso(reservation.charge_at) : null,
      regularization_deadline_iso: pending
        ? iso(reservation.regularization_deadline_at)
        : null,
    };
  }

  private buildCapabilities(
    reservation: ReservationEntity,
    hasFeedback: boolean,
    flags: CardFlags,
    now: Date,
    canRequestChange: boolean,
  ): TravelerCapabilitiesDto {
    // Same pure rule the incident service validates with (no divergence).
    const reportable = resolveReportableIncidentTypes(
      reservation,
      flags.open_incident_types,
      now,
    );
    const deadline = reservation.feedback_deadline_at
      ? new Date(reservation.feedback_deadline_at).getTime()
      : Number.NaN;
    const reviewable = reservation.status === "finalized" && !hasFeedback;
    const payability = resolveTravelerPayability(reservation, now);
    return {
      can_pay: payability.can_pay,
      pay_expires_at: payability.pay_expires_at,
      // F-PV7b: a change-only partial refund cancels like confirmed+paid
      // (same option cancelByTraveler validates with).
      can_cancel: travelerPolicyAllowsCancel(reservation, now, {
        partialRefundFromChange: flags.partial_refund_from_change,
      }),
      can_review:
        reviewable && Number.isFinite(deadline) && deadline > now.getTime(),
      can_request_change: canRequestChange,
      can_report_incident: reportable.length > 0,
      reportable_incident_types: reportable,
      has_feedback: hasFeedback,
      review_deadline_passed:
        reviewable && Number.isFinite(deadline) && deadline <= now.getTime(),
    };
  }

  /** §13: what the traveler submitted (no report_reason, no ids). */
  private toFeedbackSummary(
    feedback: ReservationGuestFeedbackEntity,
  ): TravelerFeedbackSummaryDto {
    const rating = Number(feedback.rating);
    // created_at is typed non-null but legacy/fake rows may lack it.
    const submitted = new Date(
      (feedback.created_at as Date | string | undefined) ?? Number.NaN,
    ).getTime();
    const comment =
      typeof feedback.comment === "string" ? feedback.comment.trim() : "";
    return {
      type: feedback.type,
      rating:
        Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
      comment: comment === "" ? null : comment,
      submitted_at: Number.isFinite(submitted)
        ? new Date(submitted).toISOString()
        : null,
    };
  }

  private toPriceLineDto(line: PriceLineDraft): TravelerPriceLineDto {
    return {
      type: line.type,
      description: line.description,
      quantity: Number(line.quantity),
      unit_amount_cents: line.unit_amount_cents,
      amount_cents: line.amount_cents,
      is_optional: line.is_optional,
    };
  }

  private toPaymentDto(payment: PaymentEntity): TravelerPaymentDto {
    return {
      id: payment.id,
      status_label_key: mapPaymentLabelKey(payment.status),
      amount_cents: payment.amount_cents,
      paid_at: payment.paid_at ? new Date(payment.paid_at).toISOString() : null,
    };
  }

  private toRefundDto(refund: RefundEntity): TravelerRefundDto {
    return {
      id: refund.id,
      status_label_key: mapRefundLabelKey(refund.status),
      amount_cents: refund.amount_cents,
      created_at: new Date(refund.created_at).toISOString(),
      completed_at: refund.completed_at
        ? new Date(refund.completed_at).toISOString()
        : null,
    };
  }

  /** F2 extension fields are optional on f1/legacy/manual snapshots. */
  private snapshotField<T>(
    snapshot: ReservationSnapshotPayload | null,
    key: string,
  ): T | null {
    const value = snapshot?.[key];
    return value === undefined || value === null ? null : (value as T);
  }

  /** Snapshot dog as-is plus a normalized nullable saved_dog_id. */
  private toDetailDog(dog: SnapshotDog): TravelerReservationDogDto {
    const savedId = Number(dog.saved_dog_id);
    return {
      ...dog,
      saved_dog_id: Number.isInteger(savedId) && savedId > 0 ? savedId : null,
    };
  }

  private snapshotList<T>(
    snapshot: ReservationSnapshotPayload | null,
    key: string,
  ): T[] {
    const value = snapshot?.[key];
    return Array.isArray(value) ? (value as T[]) : [];
  }

  /** Same lookup as ReservationRefundService.loadSnapshotPayload. */
  private async loadSnapshotPayload(
    reservation: ReservationEntity,
  ): Promise<ReservationSnapshotPayload | null> {
    const version = reservation.snapshot_version ?? 1;
    const row = await this.snapshots.findVersion(reservation.id, version);
    if (!row?.payload) {
      const latest = await this.snapshots.findLatest(reservation.id);
      return (
        (latest?.payload as ReservationSnapshotPayload | undefined) ?? null
      );
    }
    return row.payload as ReservationSnapshotPayload;
  }

  /** Batch variant for the list: frozen version, else the latest one. */
  private async loadSnapshotsByReservation(
    reservations: ReservationEntity[],
  ): Promise<Map<number, ReservationSnapshotPayload>> {
    const result = new Map<number, ReservationSnapshotPayload>();
    if (reservations.length === 0) {
      return result;
    }
    const rows = await this.snapshotRepository.find({
      where: { reservation_id: In(reservations.map(row => row.id)) },
    });
    for (const reservation of reservations) {
      const frozenVersion = reservation.snapshot_version ?? 1;
      let frozen: ReservationSnapshotEntity | null = null;
      let latest: ReservationSnapshotEntity | null = null;
      for (const row of rows) {
        if (row.reservation_id !== reservation.id) {
          continue;
        }
        if (row.version === frozenVersion) {
          frozen = row;
        }
        if (!latest || row.version > latest.version) {
          latest = row;
        }
      }
      const picked = frozen ?? latest;
      if (picked?.payload) {
        result.set(
          reservation.id,
          picked.payload as ReservationSnapshotPayload,
        );
      }
    }
    return result;
  }

  private async loadCardFlags(
    reservations: ReservationEntity[],
  ): Promise<Map<number, CardFlags>> {
    const flags = new Map<number, CardFlags>();
    const ids = reservations.map(row => row.id);
    if (ids.length === 0) {
      return flags;
    }
    const partialIds = reservations
      .filter(row => row.payment_status === "partially_refunded")
      .map(row => row.id);
    const [disputes, refunds, openIncidents, partialRefunds] =
      await Promise.all([
        this.disputeRepository.find({
          where: { reservation_id: In(ids), status: "open" },
        }),
        this.refundRepository.find({
          where: { reservation_id: In(ids), status: "pending" },
        }),
        this.incidents.findOpenTypesByReservation(ids),
        partialIds.length > 0
          ? this.refundRepository.find({
              where: { reservation_id: In(partialIds) },
            })
          : Promise.resolve([] as RefundEntity[]),
      ]);
    const disputeIds = new Set(disputes.map(row => row.reservation_id));
    const refundIds = new Set(refunds.map(row => row.reservation_id));
    for (const reservation of reservations) {
      const id = reservation.id;
      flags.set(id, {
        has_open_dispute: disputeIds.has(id),
        has_pending_refund: refundIds.has(id),
        open_incident_types: openIncidents.get(id) ?? [],
        partial_refund_from_change: isPartiallyRefundedByChangeOnly(
          reservation,
          partialRefunds.filter(row => row.reservation_id === id),
        ),
      });
    }
    return flags;
  }

  /** Never throws on a missing site (unlike ReservationService.getSiteById). */
  private async loadSitesByIds(
    ids: number[],
  ): Promise<Map<number, TravelerSiteRow>> {
    const sites = new Map<number, TravelerSiteRow>();
    if (ids.length === 0) {
      return sites;
    }
    const prefix = envs.DB_PREFIX;
    try {
      const rows = await this.mysqlService.query<TravelerSiteRow>(
        `SELECT s1.id, s1.name, s1.alias_l1, s1.poblacio, s1.provincia, s2.image1
         FROM ${prefix}sites1 s1
         LEFT JOIN ${prefix}sites2 s2
           ON s2.id = (SELECT MIN(id) FROM ${prefix}sites2 WHERE idback = s1.id)
         WHERE s1.id IN (?)`,
        [ids],
      );
      for (const row of rows) {
        sites.set(Number(row.id), row);
      }
    } catch (error) {
      this.logger.error(
        `Traveler panel site lookup failed for ids ${ids.join(",")}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
    return sites;
  }
}
