import type { ReservationEntity } from "../../reservations/entities/reservation.entity";
import type { Actor } from "../domain/audit-actor";
import type { RefundResponsible } from "../domain/refund-state-machine";
import type { PaymentEntity } from "../entities/payment.entity";
import type { RefundEntity } from "../entities/refund.entity";

import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";

import { envs } from "../../shared/configs/envs";
import { computePlatformFee, type PlatformFee } from "../domain/commission";
import { PAYMENT_STATUS } from "../domain/payment-state-machine";
import {
  payoutStateMachine,
  type PayoutStatus,
} from "../domain/payout-state-machine";
import {
  type PriceLineDraft,
  summarizePriceLines,
} from "../domain/price-lines";
import {
  buildReservationSnapshotPayload,
  type SnapshotBoard,
  type SnapshotF2Extension,
  type SnapshotRoom,
} from "../domain/reservation-snapshot";
import { InvalidTransitionError } from "../domain/state-machine";
import { AUDIT_ENTITY } from "../entities/audit-log.entity";
import { normalizeRate, percentOfCents, toCents } from "../utils/money.util";
import { AuditLogService } from "./audit-log.service";
import {
  LEDGER_TRANSITION,
  type LedgerTransition,
  ON_INVALID,
  type OnInvalid,
  PaymentLedgerService,
  type StripeRefundPayload,
} from "./payment-ledger.service";
import { PlatformSettingsService } from "./platform-settings.service";
import { PriceLinesService } from "./price-lines.service";
import { ReservationSnapshotService } from "./reservation-snapshot.service";

/** Terms frozen on the reservation at creation (A10). */
export interface FrozenTerms {
  commissionRate: number;
  currency: string;
  timezone: string;
  deadlineLocalTime: string;
}

export interface FrozenReservationFields {
  commission_rate: number;
  commission_cents: number;
  total_cents: number;
  currency: string;
  timezone: string;
}

export interface NewReservationEconomics {
  terms: FrozenTerms;
  lines: PriceLineDraft[];
  room: SnapshotRoom | null;
  board: SnapshotBoard | null;
  actor: Actor;
  /** SNAPSHOT_REASON.* */
  reason: string;
  nights: number;
  paymentIdempotencyKey: string;
  /** F2 snapshot additions (dogs, dog policy, services, deposit). */
  snapshotExtension?: SnapshotF2Extension | null;
}

export interface RefundContext {
  requestedBy: Actor;
  approvedBy?: Actor | null;
  responsible: RefundResponsible | null;
}

export interface RecordRefundInput {
  reservationId: number;
  paymentIntentId: string | null;
  amountCents: number;
  reason: string | null;
  idempotencyKey: string;
  stripeRefundId: string;
  context: RefundContext;
}

export interface PayoutTransitionOptions {
  onInvalid?: OnInvalid;
  metadata?: Record<string, unknown>;
}

export function reservationCurrency(): string {
  return envs.CURRENCY.toLowerCase();
}

export interface FreezeAmounts {
  total_cents: number;
  /** A3 base (sum of commissionable lines). */
  commissionable_cents: number;
}

/**
 * F2: commission frozen on the COMMISSIONABLE base (A2/A3:
 * round_half_up(rate x sum(commissionable lines))). total_cents = sum(lines).
 */
export function freezeReservationFields(
  terms: FrozenTerms,
  amounts: FreezeAmounts,
): FrozenReservationFields {
  const rate = normalizeRate(terms.commissionRate);
  return {
    commission_rate: rate,
    commission_cents: percentOfCents(amounts.commissionable_cents, rate),
    total_cents: amounts.total_cents,
    currency: terms.currency,
    timezone: terms.timezone,
  };
}

/**
 * Facade of the F1 economic model for the reservation/webhook flows:
 * frozen terms, price lines, snapshots, payments, refunds, payout
 * transitions and the audit trail. All writes use the caller's
 * transaction (`manager`), which must hold the reservation row lock.
 */
@Injectable()
export class ReservationEconomicsService {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly priceLines: PriceLinesService,
    private readonly snapshots: ReservationSnapshotService,
    private readonly ledger: PaymentLedgerService,
    private readonly audit: AuditLogService,
  ) {}

  /** Read OUTSIDE the transaction (cached settings). */
  async resolveFrozenTerms(): Promise<FrozenTerms> {
    const settings = await this.settings.getAll();
    return {
      commissionRate: settings.commission_rate,
      currency: reservationCurrency(),
      timezone: settings.default_timezone,
      deadlineLocalTime: settings.deadline_local_time,
    };
  }

  /**
   * Price lines + payment (pending_charge) + snapshot v1 + audit for a
   * reservation just inserted in `manager`'s transaction. Mutates
   * `reservation.snapshot_version`.
   */
  async recordNewReservation(
    manager: EntityManager,
    reservation: ReservationEntity,
    input: NewReservationEconomics,
  ): Promise<{ payment: PaymentEntity | null; snapshotVersion: number }> {
    const totals = summarizePriceLines(input.lines);
    const currency = input.terms.currency;

    await this.priceLines.addLines(
      manager,
      reservation.id,
      input.lines,
      currency,
      input.actor,
    );

    const payment =
      totals.total_cents > 0
        ? await this.ledger.createPayment(
            manager,
            {
              reservationId: reservation.id,
              amountCents: totals.total_cents,
              currency,
              status: PAYMENT_STATUS.PENDING_CHARGE,
              idempotencyKey: input.paymentIdempotencyKey,
            },
            input.actor,
          )
        : null;

    const snapshot = await this.snapshots.createSnapshot(
      reservation.id,
      input.reason,
      buildReservationSnapshotPayload({
        stay: {
          site_id: reservation.site_id,
          checkin: String(reservation.checkin).slice(0, 10),
          checkout: String(reservation.checkout).slice(0, 10),
          nights: input.nights,
          guests: reservation.guests,
          pets: reservation.pets,
        },
        room: input.room,
        board: input.board,
        currency,
        lines: input.lines,
        totals,
        commissionRate: reservation.commission_rate ?? null,
        commissionCents: reservation.commission_cents ?? null,
        timezone: reservation.timezone ?? input.terms.timezone,
        deadlineLocalTime: input.terms.deadlineLocalTime,
        source: input.reason,
        commissionBase: "commissionable",
        extension: input.snapshotExtension ?? null,
      }),
      manager,
      input.actor,
    );
    reservation.snapshot_version = snapshot.version;

    await this.audit.record(manager, {
      entity: AUDIT_ENTITY.RESERVATION,
      entityId: reservation.id,
      action: "reservation.created",
      actor: input.actor,
      after: {
        status: reservation.status,
        payment_status: reservation.payment_status,
        total_cents: reservation.total_cents ?? null,
        commission_rate: reservation.commission_rate ?? null,
        commission_cents: reservation.commission_cents ?? null,
        snapshot_version: snapshot.version,
      },
      metadata: { reason: input.reason, payment_id: payment?.id ?? null },
    });

    return { payment, snapshotVersion: snapshot.version };
  }

  /** Immutable price lines of a reservation (Stripe line_items, emails). */
  findPriceLines(reservationId: number, manager?: EntityManager) {
    return this.priceLines.findByReservation(reservationId, manager);
  }

  /** Latest snapshot (emails / read models). */
  findLatestSnapshot(reservationId: number, manager?: EntityManager) {
    return this.snapshots.findLatest(reservationId, manager);
  }

  async auditReservationChange(
    manager: EntityManager,
    reservationId: number,
    action: string,
    actor: Actor,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(manager, {
      entity: AUDIT_ENTITY.RESERVATION,
      entityId: reservationId,
      action,
      actor,
      before,
      after,
      metadata: metadata ?? null,
    });
  }

  /** Survives rollbacks (e.g. failed payout release). */
  async auditDetached(
    entity: string,
    entityId: number | string,
    action: string,
    actor: Actor,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.recordDetached({
      entity,
      entityId,
      action,
      actor,
      metadata: metadata ?? null,
    });
  }

  // ---------------------------------------------------------------- payments

  attachCheckoutSession(
    manager: EntityManager,
    reservationId: number,
    checkoutSessionId: string,
    actor: Actor,
  ) {
    return this.ledger.attachCheckoutSession(
      manager,
      reservationId,
      checkoutSessionId,
      actor,
    );
  }

  recordPaymentSucceeded(
    manager: EntityManager,
    reservation: ReservationEntity,
    checkoutSessionId: string | null,
    paymentIntentId: string,
    amountCents: number,
    actor: Actor,
  ) {
    return this.ledger.recordPaymentSucceeded(
      manager,
      {
        reservationId: reservation.id,
        checkoutSessionId,
        paymentIntentId,
        amountCents,
        currency: reservation.currency ?? reservationCurrency(),
      },
      actor,
    );
  }

  recordPaymentProcessing(
    manager: EntityManager,
    reservationId: number,
    checkoutSessionId: string,
    paymentIntentId: string | null,
    actor: Actor,
  ) {
    return this.ledger.recordPaymentProcessing(
      manager,
      reservationId,
      checkoutSessionId,
      paymentIntentId,
      actor,
    );
  }

  recordPaymentFailed(
    manager: EntityManager,
    reservationId: number,
    code: string,
    actor: Actor,
    checkoutSessionId?: string | null,
    message?: string | null,
  ) {
    return this.ledger.recordPaymentFailed(
      manager,
      { reservationId, code, message, checkoutSessionId },
      actor,
    );
  }

  attachChargeId(
    manager: EntityManager,
    paymentIntentId: string,
    chargeId: string,
  ) {
    return this.ledger.attachChargeId(manager, paymentIntentId, chargeId);
  }

  // ----------------------------------------------------------------- refunds

  recordRefundCreated(
    manager: EntityManager,
    input: RecordRefundInput,
    actor: Actor,
  ): Promise<RefundEntity> {
    return this.ledger.recordRefundCreated(
      manager,
      {
        reservationId: input.reservationId,
        paymentIntentId: input.paymentIntentId,
        amountCents: input.amountCents,
        currency: reservationCurrency(),
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        stripeRefundId: input.stripeRefundId,
        requestedBy: input.context.requestedBy,
        approvedBy: input.context.approvedBy ?? null,
        responsible: input.context.responsible,
      },
      actor,
    );
  }

  recordRefundPending(
    manager: EntityManager,
    input: Omit<RecordRefundInput, "stripeRefundId">,
    actor: Actor,
  ): Promise<RefundEntity> {
    return this.ledger.recordRefundPending(
      manager,
      {
        reservationId: input.reservationId,
        paymentIntentId: input.paymentIntentId,
        amountCents: input.amountCents,
        currency: reservationCurrency(),
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        stripeRefundId: "",
        requestedBy: input.context.requestedBy,
        approvedBy: input.context.approvedBy ?? null,
        responsible: input.context.responsible,
      },
      actor,
    );
  }

  rejectPendingRefund(
    manager: EntityManager,
    refundId: number,
    actor: Actor,
    failureReason: string,
  ) {
    return this.ledger.rejectPendingRefund(
      manager,
      refundId,
      actor,
      failureReason,
    );
  }

  submitPendingRefundToStripe(
    manager: EntityManager,
    refund: RefundEntity,
    stripeRefundId: string,
    stripeIdempotencyKey: string,
    actor: Actor,
  ) {
    return this.ledger.submitPendingRefundToStripe(
      manager,
      refund,
      stripeRefundId,
      stripeIdempotencyKey,
      actor,
    );
  }

  syncRefundFromStripe(
    manager: EntityManager,
    refund: StripeRefundPayload,
    actor: Actor,
    fallbackReservationId?: number,
  ) {
    return this.ledger.syncRefundFromStripe(
      manager,
      refund,
      actor,
      fallbackReservationId,
    );
  }

  aggregateRefundStatus(manager: EntityManager, reservationId: number) {
    return this.ledger.aggregateRefundStatus(manager, reservationId);
  }

  // ------------------------------------------------------------------ payout

  /**
   * Validates reservation.payout_status `from -> to` with the payout state
   * machine, mutates the entity (caller saves) and audits the change.
   * null -> anything is the initial assignment.
   */
  async transitionPayout(
    manager: EntityManager,
    reservation: ReservationEntity,
    to: PayoutStatus,
    actor: Actor,
    options: PayoutTransitionOptions = {},
  ): Promise<LedgerTransition> {
    const from = (reservation.payout_status ?? null) as PayoutStatus | null;
    if (from === to) {
      return LEDGER_TRANSITION.NOOP;
    }
    // null = payout never assigned (unpaid / legacy row): any first state.
    const allowed = from === null || payoutStateMachine.canTransition(from, to);
    if (!allowed) {
      await this.audit.recordDetached({
        entity: AUDIT_ENTITY.PAYOUT,
        entityId: reservation.id,
        action: "payout.transition_rejected",
        actor,
        before: { payout_status: from },
        after: { payout_status: to },
        metadata: options.metadata ?? null,
      });
      if ((options.onInvalid ?? ON_INVALID.THROW) === ON_INVALID.THROW) {
        throw new InvalidTransitionError("payout", from, to);
      }
      return LEDGER_TRANSITION.REJECTED;
    }
    reservation.payout_status = to;
    await this.audit.record(manager, {
      entity: AUDIT_ENTITY.PAYOUT,
      entityId: reservation.id,
      action: "payout.status_changed",
      actor,
      before: { payout_status: from },
      after: { payout_status: to },
      metadata: options.metadata ?? null,
    });
    return LEDGER_TRANSITION.CHANGED;
  }

  /** Platform fee for the host transfer (frozen commission, env fallback). */
  computePlatformFee(
    reservation: ReservationEntity,
    refundedCents: number,
  ): PlatformFee {
    const totalCents = reservation.total_cents ?? toCents(reservation.total);
    return computePlatformFee({
      commissionRate:
        reservation.commission_rate === null ||
        reservation.commission_rate === undefined
          ? null
          : Number(reservation.commission_rate),
      commissionCents: reservation.commission_cents ?? null,
      totalCents,
      refundedCents,
      fallbackRate: envs.COMMISSION_PERCENTAGE,
    });
  }
}
