import type { ReservationEntity } from "../../reservations/entities/reservation.entity";
import type { Actor } from "../domain/audit-actor";
import type { RefundResponsible } from "../domain/refund-state-machine";
import type { PaymentEntity } from "../entities/payment.entity";
import type { RefundEntity } from "../entities/refund.entity";

import { Injectable, Logger, Optional } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";

import { envs } from "../../shared/configs/envs";
import { SiteSettingsEntity } from "../../site-wizard/entities/site-settings.entity";
import {
  buildQuoteCancellationSummary,
  type CancellationPolicyDefinition,
  cancellationPolicyFromColumns,
  CHARGE_MODE,
  type ChargeMode,
  type ChargePlan,
  type QuoteCancellationSummary,
  resolveEffectiveChargePlan,
  validTimezoneOrNull,
} from "../domain/cancellation-policy";
import { computePlatformFee, type PlatformFee } from "../domain/commission";
import {
  PAYMENT_STATUS,
  type PaymentStatus,
} from "../domain/payment-state-machine";
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
  type SnapshotCancellationTerms,
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
  /** site_settings.timezone ?? platform default_timezone. */
  timezone: string;
  deadlineLocalTime: string;
  /**
   * Structured policy of the site (wizard step 6). null/absent = legacy
   * 24 h rule (immediate charge, legacy snapshot rule).
   */
  cancellationPolicy?: CancellationPolicyDefinition | null;
  /** platform_settings.deferred_charge_enabled (A5). */
  deferredChargeEnabled?: boolean;
  /** platform_settings.deferred_min_lead_hours (A6). */
  deferredMinLeadHours?: number;
  /** Booking instant the charge plan was computed at (ISO). */
  bookedAtIso?: string;
  /**
   * Effective charge plan (resolveEffectiveChargePlan) for the stay; null
   * without policy or without a stay (checkin) to compute it for.
   */
  chargePlan?: ChargePlan | null;
}

/** Stay the frozen terms are resolved for (site policy + charge plan). */
export interface FrozenTermsStay {
  siteId: number;
  /** YYYY-MM-DD */
  checkin: string;
  /** Booking instant (default: now). */
  now?: Date;
}

export interface FrozenReservationFields {
  commission_rate: number;
  commission_cents: number;
  total_cents: number;
  currency: string;
  timezone: string;
  charge_mode: ChargeMode;
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
    // flexible only when the platform enabled the deferred charge (the plan
    // is already downgraded otherwise); no policy -> immediate (legacy).
    charge_mode: terms.chargePlan?.charge_mode ?? CHARGE_MODE.IMMEDIATE,
  };
}

/**
 * Quote `cancellation` block from the frozen terms of the stay. null for a
 * legacy site (no structured policy) or terms resolved without a stay.
 */
export function quoteCancellationFromTerms(
  terms: FrozenTerms,
  totalCents: number,
): QuoteCancellationSummary | null {
  const policy = terms.cancellationPolicy ?? null;
  const plan = terms.chargePlan ?? null;
  if (!policy || !plan) {
    return null;
  }
  return buildQuoteCancellationSummary({
    policy,
    plan,
    timezone: terms.timezone,
    total_cents: totalCents,
  });
}

/** Structured snapshot terms (null = legacy rule). */
export function snapshotCancellationTerms(
  terms: FrozenTerms,
  reservation: Pick<ReservationEntity, "charge_mode" | "created_at">,
): SnapshotCancellationTerms | null {
  const policy = terms.cancellationPolicy ?? null;
  if (!policy) {
    return null;
  }
  const plan = terms.chargePlan ?? null;
  const chargeMode: ChargeMode =
    reservation.charge_mode === CHARGE_MODE.FLEXIBLE
      ? CHARGE_MODE.FLEXIBLE
      : CHARGE_MODE.IMMEDIATE;
  const createdAt =
    reservation.created_at instanceof Date &&
    Number.isFinite(reservation.created_at.getTime())
      ? reservation.created_at.toISOString()
      : null;
  return {
    policy,
    booked_at_iso: terms.bookedAtIso ?? createdAt ?? new Date().toISOString(),
    charge_mode: chargeMode,
    charge_at_iso:
      chargeMode === CHARGE_MODE.FLEXIBLE
        ? (plan?.charge_at_iso ?? null)
        : null,
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
  private readonly logger = new Logger(ReservationEconomicsService.name);

  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly priceLines: PriceLinesService,
    private readonly snapshots: ReservationSnapshotService,
    private readonly ledger: PaymentLedgerService,
    private readonly audit: AuditLogService,
    // Optional so unit fixtures built without it keep the legacy terms.
    @Optional()
    @InjectRepository(SiteSettingsEntity)
    private readonly siteSettings?: Repository<SiteSettingsEntity>,
  ) {}

  /**
   * Read OUTSIDE the transaction (cached platform settings + one
   * site_settings row). Without `stay` (or without a site policy) the terms
   * are the legacy ones: platform timezone, immediate charge.
   */
  async resolveFrozenTerms(stay?: FrozenTermsStay): Promise<FrozenTerms> {
    const settings = await this.settings.getAll();
    const now = stay?.now ?? new Date();
    const site =
      stay && this.siteSettings
        ? await this.siteSettings.findOne({ where: { site_id: stay.siteId } })
        : null;
    const policy = cancellationPolicyFromColumns(site);
    if (site?.cancellation_policy_type && !policy) {
      this.logger.warn(
        `site ${stay?.siteId}: invalid cancellation policy columns; legacy rule applies`,
      );
    }
    const timezone =
      validTimezoneOrNull(site?.timezone) ?? settings.default_timezone;
    const chargePlan =
      policy && stay
        ? resolveEffectiveChargePlan({
            policy,
            checkin: stay.checkin.slice(0, 10),
            timezone,
            deadlineLocalTime: settings.deadline_local_time,
            now,
            minLeadHours: settings.deferred_min_lead_hours,
            deferredChargeEnabled: settings.deferred_charge_enabled,
          })
        : null;
    return {
      commissionRate: settings.commission_rate,
      currency: reservationCurrency(),
      timezone,
      deadlineLocalTime: settings.deadline_local_time,
      cancellationPolicy: policy,
      deferredChargeEnabled: settings.deferred_charge_enabled,
      deferredMinLeadHours: settings.deferred_min_lead_hours,
      bookedAtIso: now.toISOString(),
      chargePlan,
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
        cancellation: snapshotCancellationTerms(input.terms, reservation),
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

  /** Fase 4: latest charge row (deferred charge state). */
  findLatestPayment(manager: EntityManager, reservationId: number) {
    return this.ledger.findLatestCharge(manager, reservationId);
  }

  /** Fase 4: state-machine transition of a payment row (audited). */
  transitionPayment(
    manager: EntityManager,
    payment: PaymentEntity,
    to: PaymentStatus,
    actor: Actor,
    patch: Partial<PaymentEntity> = {},
    options: { onInvalid?: OnInvalid; metadata?: Record<string, unknown> } = {},
  ) {
    return this.ledger.transitionPayment(
      manager,
      payment,
      to,
      actor,
      patch,
      options,
    );
  }

  /** Fase 4: setup session completed -> payment method_validated. */
  recordMethodValidated(
    manager: EntityManager,
    reservation: ReservationEntity,
    checkoutSessionId: string,
    setupIntentId: string,
    actor: Actor,
  ) {
    return this.ledger.recordMethodValidated(
      manager,
      {
        reservationId: reservation.id,
        amountCents: reservation.total_cents ?? toCents(reservation.total),
        currency: reservation.currency ?? reservationCurrency(),
        checkoutSessionId,
        setupIntentId,
      },
      actor,
    );
  }

  /** Fase 4: cached platform settings (regularization window, lead hours). */
  getPlatformSettings() {
    return this.settings.getAll();
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
