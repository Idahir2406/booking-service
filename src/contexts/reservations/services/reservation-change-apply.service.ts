import type { Actor } from "../../payments/domain/audit-actor";
import type { ReservationSnapshotPayload } from "../../payments/domain/reservation-snapshot";
import type { QuoteReservationDto } from "../dto/quote-reservation.dto";

import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { EntityManager } from "typeorm";

import { actors } from "../../payments/domain/audit-actor";
import {
  CHARGE_MODE,
  resolveChargePlan,
} from "../../payments/domain/cancellation-policy";
import { PRICE_LINE_TYPE } from "../../payments/entities/reservation-price-line.entity";
import { PriceLinesService } from "../../payments/services/price-lines.service";
import { ReservationEconomicsService } from "../../payments/services/reservation-economics.service";
import { ReservationSnapshotService } from "../../payments/services/reservation-snapshot.service";
import { ReservationEntity } from "../entities/reservation.entity";
import { buildChangeRefundReason } from "../utils/change-refund.util";
import {
  buildAdjustmentLine,
  buildChangedSnapshotPayload,
  buildChangeQuoteInput,
  CHANGE_ERROR,
  type ChangeBasePayload,
  type ChangeErrorCode,
  type ChangeKind,
  type ChangeOfferPayload,
  type ChangeOverrides,
  type ChangeTarget,
  snapshotDogs,
} from "../utils/reservation-change.util";
import { isDeferredUnpaid } from "../utils/reservation-policy.util";
import { linkSavedDogs } from "../utils/saved-dog-link.util";
import {
  type QuoteReservationResult,
  ReservationService,
} from "./reservation.service";
import { ReservationEventService } from "./reservation-event.service";
import { ReservationPayoutService } from "./reservation-payout.service";

/** HttpException with a stable `code` in the body (proxy maps it). */
export function changeError(
  status: HttpStatus,
  code: ChangeErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): HttpException {
  return new HttpException(
    { statusCode: status, code, message, ...extra },
    status,
  );
}

export interface BuildOfferInput {
  reservation: ReservationEntity;
  snapshot: ReservationSnapshotPayload;
  overrides: ChangeOverrides;
  adjustmentCents?: number;
  adjustmentDescription?: string;
  /** SNAPSHOT_REASON of the snapshot an acceptance would write. */
  source: string;
  siteNameBefore: string | null;
  siteNameAfter: string | null;
}

export interface BuiltOffer {
  valid: boolean;
  errors: string[];
  /** Quote produced only dog-compatibility problems. */
  onlyDogProblems: boolean;
  /** null when no dogs are declared / engine without compatibility data. */
  dogsCompatible: boolean | null;
  before: ChangeBasePayload;
  after: ChangeOfferPayload;
  amountDeltaCents: number;
}

export type RevalidationResult =
  | { ok: true }
  | { ok: false; code: ChangeErrorCode; errors: string[] };

export interface ApplyChangeInput {
  kind: ChangeKind;
  offerId: number;
  requestId: number | null;
  offer: ChangeOfferPayload;
  amountDeltaCents: number;
  basedOnSnapshotVersion: number;
  /** SNAPSHOT_REASON.CHANGE_ACCEPTED | ALTERNATIVE_ACCEPTED. */
  reason: string;
  actor: Actor;
  now: Date;
}

export interface ApplyChangeOutcome {
  snapshotVersion: number;
  previousSnapshotVersion: number;
  refundCents: number;
  refundInitiated: boolean;
}

function onlyDogProblems(quote: QuoteReservationResult): boolean {
  const violations = quote.compatibility?.violations ?? [];
  if (violations.length === 0) {
    return false;
  }
  const dogMessages = new Set(violations.map(violation => violation.message));
  return quote.errors.every(message => dogMessages.has(message));
}

/**
 * F-PV7b engine shared by change proposals and alternatives:
 * - buildOffer: prices the changed stay with the checkout quote engine
 *   (same pure pricing, nothing new) and freezes the snapshot an acceptance
 *   would write. No writes.
 * - revalidate: re-runs the quote at accept time (availability, capacity,
 *   dog compatibility) WITHOUT repricing the frozen offer.
 * - applyInTransaction: inside the caller's transaction with the reservation
 *   row locked: moves the nights (row locks), writes snapshot n+1 linked to
 *   n, updates the reservation, adds the price-line adjustment, refunds a
 *   negative delta through ReservationPayoutService.refundInTransaction and
 *   audits. Never mutates older snapshot rows.
 */
@Injectable()
export class ReservationChangeApplyService {
  constructor(
    private readonly reservationService: ReservationService,
    private readonly payoutService: ReservationPayoutService,
    private readonly economics: ReservationEconomicsService,
    private readonly snapshots: ReservationSnapshotService,
    private readonly priceLines: PriceLinesService,
    private readonly reservationEventService: ReservationEventService,
  ) {}

  /** Frozen snapshot of the reservation (snapshot_version, else latest). */
  async loadCurrentSnapshot(
    reservation: ReservationEntity,
  ): Promise<ReservationSnapshotPayload | null> {
    if (reservation.snapshot_version) {
      const row = await this.snapshots.findVersion(
        reservation.id,
        reservation.snapshot_version,
      );
      if (row?.payload) {
        return row.payload as ReservationSnapshotPayload;
      }
    }
    const latest = await this.snapshots.findLatest(reservation.id);
    return (latest?.payload as ReservationSnapshotPayload | undefined) ?? null;
  }

  async buildOffer(input: BuildOfferInput): Promise<BuiltOffer> {
    const { reservation, snapshot } = input;
    const quoteInput = buildChangeQuoteInput(
      reservation,
      snapshot,
      input.overrides,
    );
    const quote = await this.reservationService.quoteReservation(
      quoteInput as QuoteReservationDto,
      { excludeReservation: reservation, skipHostPaymentCheck: true },
    );
    const before: ChangeBasePayload = {
      snapshot,
      site_name: input.siteNameBefore,
    };
    const errors = [...quote.errors];
    const internal = quote.internal;
    if (!internal) {
      return {
        valid: false,
        errors: errors.length > 0 ? errors : ["Cambio no válido."],
        onlyDogProblems: false,
        dogsCompatible: null,
        before,
        after: {
          target: this.targetFromReservation(reservation),
          quote: quoteInput,
          snapshot,
          site_name: input.siteNameAfter,
        },
        amountDeltaCents: 0,
      };
    }

    const lines = [...internal.lines];
    if (input.adjustmentCents) {
      lines.push(
        buildAdjustmentLine(input.adjustmentCents, input.adjustmentDescription),
      );
    }
    // Saved-dog links survive only for dogs the snapshot already linked
    // (verified at checkout); V4P can never point at another traveler's dog.
    const previouslyLinked = new Set(
      snapshotDogs(snapshot)
        .map(dog => Number(dog.saved_dog_id))
        .filter(id => Number.isInteger(id) && id > 0),
    );
    const { dogs } = linkSavedDogs(
      internal.snapshotExtension.dogs,
      quoteInput.dogs,
      previouslyLinked,
    );
    const extension = { ...internal.snapshotExtension, dogs };
    const sameRoom =
      quoteInput.site_id === reservation.site_id &&
      quoteInput.room_id === reservation.room_id;
    const room = sameRoom
      ? snapshot.room
      : await this.reservationService.loadSnapshotRoom(quoteInput.room_id);

    const next = buildChangedSnapshotPayload({
      previous: snapshot,
      reservation,
      quote: quoteInput,
      nights: quote.nights,
      pets: internal.pets,
      room,
      board: internal.board,
      lines,
      extension,
      source: input.source,
    });
    if (next.total_cents < 0) {
      errors.push("El total resultante no puede ser negativo.");
    }
    const board = quote.board_option;
    const target: ChangeTarget = {
      site_id: quoteInput.site_id,
      room_id: quoteInput.room_id,
      checkin: quoteInput.checkin.slice(0, 10),
      checkout: quoteInput.checkout.slice(0, 10),
      guests: quoteInput.guests,
      pets: internal.pets,
      board_option_id: board?.id ?? null,
      board_snapshot:
        board === null
          ? null
          : {
              code: board.code,
              name: board.name,
              description: board.description,
              is_included: board.is_included,
              price: board.price,
              board_amount: quote.board_amount,
            },
      extras_snapshot: {
        services: extension.services,
        extras: extension.extras,
      },
    };
    const compatibility = quote.compatibility ?? null;
    return {
      valid: errors.length === 0,
      errors,
      onlyDogProblems: onlyDogProblems(quote),
      dogsCompatible: compatibility ? Boolean(compatibility.compatible) : null,
      before,
      after: {
        target,
        quote: quoteInput,
        snapshot: next,
        site_name: input.siteNameAfter,
      },
      amountDeltaCents: next.total_cents - Number(snapshot.total_cents),
    };
  }

  async revalidate(
    offer: ChangeOfferPayload,
    reservation: ReservationEntity,
  ): Promise<RevalidationResult> {
    const quote = await this.reservationService.quoteReservation(
      offer.quote as QuoteReservationDto,
      { excludeReservation: reservation, skipHostPaymentCheck: true },
    );
    if (quote.valid) {
      return { ok: true };
    }
    return {
      ok: false,
      code: onlyDogProblems(quote)
        ? CHANGE_ERROR.DOGS_INCOMPATIBLE
        : CHANGE_ERROR.UNAVAILABLE,
      errors: quote.errors,
    };
  }

  /**
   * Preconditions (offer pending, not expired, base version, delta <= 0,
   * revalidation) are the caller's job; this only applies. Throws
   * ConflictException (nothing written) when the nights are gone.
   */
  async applyInTransaction(
    manager: EntityManager,
    reservation: ReservationEntity,
    input: ApplyChangeInput,
  ): Promise<ApplyChangeOutcome> {
    const target = input.offer.target;
    // 1. Inventory first: every check happens before any write.
    await this.reservationService.moveNightsForChange(manager, reservation, {
      site_id: target.site_id,
      room_id: target.room_id,
      checkin: target.checkin,
      checkout: target.checkout,
    });

    const before = this.auditFields(reservation);
    const previousVersion = input.basedOnSnapshotVersion;
    // Fase 4: flexible reservation not charged yet -> no money moves now;
    // the pending charge follows the new total and the new deadline.
    const deferredUnpaid = isDeferredUnpaid(reservation);
    const deferredChargeAt = deferredUnpaid
      ? await this.recomputeChargeAt(reservation, input)
      : null;
    const offerSnapshot =
      deferredChargeAt === null
        ? input.offer.snapshot
        : {
            ...input.offer.snapshot,
            refund_policy: {
              ...input.offer.snapshot.refund_policy,
              charge_at: deferredChargeAt.toISOString(),
            },
          };

    // 2. New snapshot version linked to the previous one (append-only).
    const snapshot = await this.snapshots.createSnapshot(
      reservation.id,
      input.reason,
      {
        ...offerSnapshot,
        previous_version: previousVersion,
        change: {
          kind: input.kind,
          offer_id: input.offerId,
          request_id: input.requestId,
          amount_delta_cents: input.amountDeltaCents,
          accepted_at: input.now.toISOString(),
        },
      },
      manager,
      input.actor,
    );

    // 3. Reservation fields (total_cents stays the CHARGED amount; a
    // negative delta is recorded as a refund, never as a new total).
    reservation.site_id = target.site_id;
    reservation.room_id = target.room_id;
    reservation.checkin = target.checkin;
    reservation.checkout = target.checkout;
    reservation.guests = target.guests;
    reservation.pets = target.pets;
    reservation.board_option_id = target.board_option_id ?? undefined;
    reservation.board_snapshot = target.board_snapshot ?? undefined;
    reservation.extras_snapshot = target.extras_snapshot;
    reservation.snapshot_version = snapshot.version;

    // 4. Price-line ledger: one adjustment line for the difference.
    const delta = input.amountDeltaCents;
    if (delta !== 0) {
      await this.priceLines.addLines(
        manager,
        reservation.id,
        [
          {
            type: PRICE_LINE_TYPE.ADJUSTMENT,
            description:
              input.kind === "alternative"
                ? "Ajuste por alternativa aceptada"
                : "Ajuste por cambio de reserva",
            quantity: 1,
            unit_amount_cents: delta,
            amount_cents: delta,
            is_optional: false,
            is_commissionable: true,
            is_penalizable: true,
            metadata: {
              reason: input.reason,
              kind: input.kind,
              offer_id: input.offerId,
              snapshot_version: snapshot.version,
            },
          },
        ],
        input.offer.snapshot.currency,
        input.actor,
        "price_lines.change_adjustment",
      );
    }

    // 5. delta < 0: refund through the existing refund path (plan D8).
    let refundCents = 0;
    let refundInitiated = false;
    let refundId: string | null = null;
    if (deferredUnpaid) {
      // Nothing was charged: the deferred charge is the new total.
      const newTotalCents = Math.round(
        Number(input.offer.snapshot.total_cents),
      );
      reservation.total_cents = newTotalCents;
      reservation.total = newTotalCents / 100;
      reservation.subtotal = newTotalCents / 100;
      reservation.charge_at = deferredChargeAt ?? reservation.charge_at;
    } else if (delta < 0) {
      refundCents = -delta;
      const result = await this.payoutService.refundInTransaction(
        manager,
        reservation,
        refundCents,
        buildChangeRefundReason(input.kind, input.offerId),
        {
          requestedBy: input.actor,
          approvedBy: actors.admin(),
          responsible: "traveler",
        },
      );
      refundInitiated = true;
      refundId = result.refundId;
    }

    await manager.getRepository(ReservationEntity).save(reservation);

    await this.economics.auditReservationChange(
      manager,
      reservation.id,
      "reservation.change_applied",
      input.actor,
      { ...before, snapshot_version: previousVersion },
      this.auditFields(reservation),
      {
        kind: input.kind,
        offer_id: input.offerId,
        request_id: input.requestId,
        amount_delta_cents: delta,
        refund_cents: refundCents,
        refund_id: refundId,
      },
    );
    await this.reservationEventService.logEventInTransaction(
      manager,
      reservation.id,
      "change_applied",
      {
        kind: input.kind,
        offer_id: input.offerId,
        request_id: input.requestId,
        previous_snapshot_version: previousVersion,
        snapshot_version: snapshot.version,
        amount_delta_cents: delta,
        refund_cents: refundCents,
      },
    );

    return {
      snapshotVersion: snapshot.version,
      previousSnapshotVersion: previousVersion,
      refundCents,
      refundInitiated,
    };
  }

  /**
   * Fase 4: charge_at of an unpaid flexible reservation for its NEW
   * check-in, with the policy frozen in the snapshot. If the new plan is
   * immediate (deadline passed or under deferred_min_lead_hours), charge_at
   * becomes `now`: the deferred-charge cron charges it within 5 minutes and
   * a failure opens the usual regularization window.
   */
  private async recomputeChargeAt(
    reservation: ReservationEntity,
    input: ApplyChangeInput,
  ): Promise<Date | null> {
    const rule = input.offer.snapshot.refund_policy;
    const policy = rule.cancellation ?? null;
    if (!policy) {
      return reservation.charge_at ? new Date(reservation.charge_at) : null;
    }
    const settings = await this.economics.getPlatformSettings();
    const plan = resolveChargePlan({
      policy,
      checkin: input.offer.target.checkin.slice(0, 10),
      timezone:
        input.offer.snapshot.timezone ??
        rule.timezone ??
        reservation.timezone ??
        "Europe/Madrid",
      deadlineLocalTime:
        rule.deadline_local_time ?? settings.deadline_local_time,
      now: input.now,
      minLeadHours: settings.deferred_min_lead_hours,
    });
    return plan.charge_mode === CHARGE_MODE.FLEXIBLE && plan.charge_at_iso
      ? new Date(plan.charge_at_iso)
      : input.now;
  }

  /** Maps a move conflict (nights gone) to the stable code. */
  isUnavailableError(error: unknown): boolean {
    return error instanceof ConflictException;
  }

  private targetFromReservation(reservation: ReservationEntity): ChangeTarget {
    return {
      site_id: reservation.site_id,
      room_id: reservation.room_id,
      checkin: String(reservation.checkin).slice(0, 10),
      checkout: String(reservation.checkout).slice(0, 10),
      guests: reservation.guests,
      pets: reservation.pets,
      board_option_id: reservation.board_option_id ?? null,
      board_snapshot: reservation.board_snapshot ?? null,
      extras_snapshot: { services: [], extras: [] },
    };
  }

  private auditFields(reservation: ReservationEntity): Record<string, unknown> {
    return {
      site_id: reservation.site_id,
      room_id: reservation.room_id,
      checkin: String(reservation.checkin).slice(0, 10),
      checkout: String(reservation.checkout).slice(0, 10),
      guests: reservation.guests,
      pets: reservation.pets,
      snapshot_version: reservation.snapshot_version ?? null,
      payment_status: reservation.payment_status,
      amount_refunded: reservation.amount_refunded ?? null,
      ...(reservation.charge_mode === "flexible"
        ? {
            charge_at: reservation.charge_at
              ? new Date(reservation.charge_at).toISOString()
              : null,
            total_cents: reservation.total_cents ?? null,
          }
        : {}),
    };
  }
}
