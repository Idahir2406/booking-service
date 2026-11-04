import type { Actor } from "../domain/audit-actor";

import { Injectable, Logger } from "@nestjs/common";
import { EntityManager, In, Not } from "typeorm";

import {
  PAYMENT_STATUS,
  PAYMENT_TYPE,
  paymentStateMachine,
  type PaymentStatus,
} from "../domain/payment-state-machine";
import {
  isRefundCompleted,
  REFUND_STATUS,
  type RefundResponsible,
  refundStateMachine,
  type RefundStatus,
  refundStatusFromStripe,
} from "../domain/refund-state-machine";
import {
  InvalidTransitionError,
  type StateMachine,
  TRANSITION_RESULT,
} from "../domain/state-machine";
import { AUDIT_ENTITY } from "../entities/audit-log.entity";
import { PaymentEntity } from "../entities/payment.entity";
import { RefundEntity } from "../entities/refund.entity";
import { AuditLogService } from "./audit-log.service";

export const LEDGER_TRANSITION = {
  CHANGED: "changed",
  NOOP: "noop",
  REJECTED: "rejected",
} as const;

export type LedgerTransition =
  (typeof LEDGER_TRANSITION)[keyof typeof LEDGER_TRANSITION];

export const ON_INVALID = {
  /** Commands (host/admin/cron): invalid transition = bug -> throw. */
  THROW: "throw",
  /** Out-of-order Stripe events: audit and ignore (no infinite retries). */
  IGNORE: "ignore",
} as const;

export type OnInvalid = (typeof ON_INVALID)[keyof typeof ON_INVALID];

export interface TransitionOptions {
  onInvalid?: OnInvalid;
  metadata?: Record<string, unknown>;
}

export const paymentKeys = {
  checkout: (reservationId: number): string =>
    `payment:checkout:${reservationId}`,
  manual: (reservationId: number): string => `payment:manual:${reservationId}`,
  byPaymentIntent: (paymentIntentId: string): string =>
    `payment:pi:${paymentIntentId}`,
} as const;

export const refundKeys = {
  external: (stripeRefundId: string): string =>
    `refund:stripe:${stripeRefundId}`,
} as const;

export interface CreatePaymentInput {
  reservationId: number;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  idempotencyKey: string;
  checkoutSessionId?: string | null;
  paymentIntentId?: string | null;
  paidAt?: Date | null;
}

export interface PaymentSucceededInput {
  reservationId: number;
  checkoutSessionId: string | null;
  paymentIntentId: string;
  amountCents: number;
  currency: string;
}

export interface PaymentFailedInput {
  reservationId: number;
  code: string;
  message?: string | null;
  checkoutSessionId?: string | null;
}

export interface RefundCreatedInput {
  reservationId: number;
  paymentIntentId: string | null;
  amountCents: number;
  currency: string;
  reason: string | null;
  idempotencyKey: string;
  stripeRefundId: string;
  requestedBy: Actor;
  approvedBy?: Actor | null;
  responsible: RefundResponsible | null;
}

/** Subset of Stripe's Refund object used by the webhooks. */
export interface StripeRefundPayload {
  id: string;
  status?: string | null;
  amount?: number | null;
  currency?: string | null;
  payment_intent?: string | { id: string } | null;
  charge?: string | { id: string } | null;
  failure_reason?: string | null;
  metadata?: Record<string, string> | null;
}

export interface RefundSyncResult {
  refund: RefundEntity | null;
  result: LedgerTransition | "not_found";
  created: boolean;
}

function resolveId(
  value: string | { id: string } | null | undefined,
): string | null {
  if (typeof value === "string") {
    return value;
  }
  return value?.id ?? null;
}

const COMPLETED_REFUND_STATUSES: RefundStatus[] = [
  REFUND_STATUS.PARTIAL_COMPLETED,
  REFUND_STATUS.TOTAL_COMPLETED,
];

/**
 * Payments and refunds ledger (B2-B4). Every status change goes through the
 * pure state machines and is written to audit_log in the caller's
 * transaction. Callers MUST hold the reservation row lock
 * (SELECT ... FOR UPDATE) so ledger reads/writes are serialized per
 * reservation.
 */
@Injectable()
export class PaymentLedgerService {
  private readonly logger = new Logger(PaymentLedgerService.name);

  constructor(private readonly auditLogService: AuditLogService) {}

  // ---------------------------------------------------------------- payments

  async createPayment(
    manager: EntityManager,
    input: CreatePaymentInput,
    actor: Actor,
  ): Promise<PaymentEntity> {
    const repository = manager.getRepository(PaymentEntity);
    const existing = await repository.findOne({
      where: { idempotency_key: input.idempotencyKey },
    });
    if (existing) {
      return existing;
    }
    if (!paymentStateMachine.initial.includes(input.status)) {
      throw new InvalidTransitionError("payment", null, input.status);
    }
    const payment = await repository.save(
      repository.create({
        reservation_id: input.reservationId,
        type: PAYMENT_TYPE.CHARGE,
        status: input.status,
        amount_cents: input.amountCents,
        currency: input.currency,
        idempotency_key: input.idempotencyKey,
        stripe_checkout_session_id: input.checkoutSessionId ?? null,
        stripe_payment_intent_id: input.paymentIntentId ?? null,
        attempts: 0,
        paid_at: input.paidAt ?? null,
      }),
    );
    await this.auditLogService.record(manager, {
      entity: AUDIT_ENTITY.PAYMENT,
      entityId: payment.id,
      action: "payment.created",
      actor,
      after: {
        status: payment.status,
        amount_cents: payment.amount_cents,
        currency: payment.currency,
      },
      metadata: {
        reservation_id: input.reservationId,
        idempotency_key: input.idempotencyKey,
      },
    });
    return payment;
  }

  async findLatestCharge(
    manager: EntityManager,
    reservationId: number,
  ): Promise<PaymentEntity | null> {
    return manager.getRepository(PaymentEntity).findOne({
      where: { reservation_id: reservationId, type: PAYMENT_TYPE.CHARGE },
      order: { id: "DESC" },
    });
  }

  async findByPaymentIntent(
    manager: EntityManager,
    paymentIntentId: string,
  ): Promise<PaymentEntity | null> {
    return manager.getRepository(PaymentEntity).findOne({
      where: { stripe_payment_intent_id: paymentIntentId },
    });
  }

  /** A new Checkout Session was opened for the pending charge. */
  async attachCheckoutSession(
    manager: EntityManager,
    reservationId: number,
    checkoutSessionId: string,
    actor: Actor,
  ): Promise<PaymentEntity | null> {
    const payment = await this.findLatestCharge(manager, reservationId);
    if (!payment || payment.status !== PAYMENT_STATUS.PENDING_CHARGE) {
      return payment;
    }
    if (payment.stripe_checkout_session_id === checkoutSessionId) {
      return payment;
    }
    const before = {
      stripe_checkout_session_id: payment.stripe_checkout_session_id,
    };
    payment.stripe_checkout_session_id = checkoutSessionId;
    payment.attempts += 1;
    const saved = await manager.getRepository(PaymentEntity).save(payment);
    await this.auditLogService.record(manager, {
      entity: AUDIT_ENTITY.PAYMENT,
      entityId: payment.id,
      action: "payment.checkout_session_attached",
      actor,
      before,
      after: { stripe_checkout_session_id: checkoutSessionId },
      metadata: { reservation_id: reservationId, attempts: payment.attempts },
    });
    return saved;
  }

  async transitionPayment(
    manager: EntityManager,
    payment: PaymentEntity,
    to: PaymentStatus,
    actor: Actor,
    patch: Partial<PaymentEntity> = {},
    options: TransitionOptions = {},
  ): Promise<LedgerTransition> {
    return this.applyTransition(
      manager,
      paymentStateMachine,
      AUDIT_ENTITY.PAYMENT,
      payment,
      to,
      actor,
      patch,
      options,
      PaymentEntity,
    );
  }

  /**
   * Checkout paid (checkout.session.completed / async_payment_succeeded).
   * Idempotent: same payment_intent already paid -> noop.
   * A second, different payment_intent for an already-paid reservation gets
   * its OWN payment row (it will be refunded as duplicate_payment).
   */
  async recordPaymentSucceeded(
    manager: EntityManager,
    input: PaymentSucceededInput,
    actor: Actor,
  ): Promise<PaymentEntity> {
    const byIntent = await this.findByPaymentIntent(
      manager,
      input.paymentIntentId,
    );
    if (byIntent) {
      await this.transitionPayment(
        manager,
        byIntent,
        PAYMENT_STATUS.PAID,
        actor,
        { paid_at: byIntent.paid_at ?? new Date() },
        { onInvalid: ON_INVALID.IGNORE },
      );
      return byIntent;
    }

    const latest = await this.findLatestCharge(manager, input.reservationId);
    if (
      latest &&
      !latest.stripe_payment_intent_id &&
      paymentStateMachine.canTransition(latest.status, PAYMENT_STATUS.PAID)
    ) {
      const retriedAfterFailure = latest.status === PAYMENT_STATUS.FAILED;
      await this.transitionPayment(
        manager,
        latest,
        PAYMENT_STATUS.PAID,
        actor,
        {
          stripe_payment_intent_id: input.paymentIntentId,
          stripe_checkout_session_id:
            input.checkoutSessionId ?? latest.stripe_checkout_session_id,
          paid_at: new Date(),
          ...(latest.amount_cents === input.amountCents
            ? {}
            : { amount_cents: input.amountCents }),
        },
        {
          metadata: {
            amount_paid_cents: input.amountCents,
            expected_cents: latest.amount_cents,
            // B3: "pagado tras reintento" is history, not a state.
            ...(retriedAfterFailure ? { paid_after_failure: true } : {}),
          },
        },
      );
      return latest;
    }

    return this.createPayment(
      manager,
      {
        reservationId: input.reservationId,
        amountCents: input.amountCents,
        currency: input.currency,
        status: PAYMENT_STATUS.PAID,
        idempotencyKey: paymentKeys.byPaymentIntent(input.paymentIntentId),
        checkoutSessionId: input.checkoutSessionId,
        paymentIntentId: input.paymentIntentId,
        paidAt: new Date(),
      },
      actor,
    );
  }

  /** Session completed but the async method is still settling. */
  async recordPaymentProcessing(
    manager: EntityManager,
    reservationId: number,
    checkoutSessionId: string,
    paymentIntentId: string | null,
    actor: Actor,
  ): Promise<PaymentEntity | null> {
    const payment = await this.findLatestCharge(manager, reservationId);
    if (!payment) {
      return null;
    }
    await this.transitionPayment(
      manager,
      payment,
      PAYMENT_STATUS.PROCESSING,
      actor,
      {
        stripe_checkout_session_id: checkoutSessionId,
        ...(paymentIntentId
          ? { stripe_payment_intent_id: paymentIntentId }
          : {}),
      },
      { onInvalid: ON_INVALID.IGNORE },
    );
    return payment;
  }

  /**
   * Charge failed / hold expired unpaid. Never downgrades a paid payment
   * (out-of-order events are audited and ignored).
   */
  async recordPaymentFailed(
    manager: EntityManager,
    input: PaymentFailedInput,
    actor: Actor,
  ): Promise<PaymentEntity | null> {
    const payment = await this.findLatestCharge(manager, input.reservationId);
    if (!payment) {
      return null;
    }
    if (
      input.checkoutSessionId &&
      payment.stripe_checkout_session_id &&
      payment.stripe_checkout_session_id !== input.checkoutSessionId
    ) {
      return payment;
    }
    await this.transitionPayment(
      manager,
      payment,
      PAYMENT_STATUS.FAILED,
      actor,
      {
        failure_code: input.code.slice(0, 128),
        failure_message: input.message ?? null,
      },
      { onInvalid: ON_INVALID.IGNORE },
    );
    return payment;
  }

  async attachChargeId(
    manager: EntityManager,
    paymentIntentId: string,
    chargeId: string,
  ): Promise<void> {
    const payment = await this.findByPaymentIntent(manager, paymentIntentId);
    if (payment && !payment.stripe_charge_id) {
      payment.stripe_charge_id = chargeId;
      await manager.getRepository(PaymentEntity).save(payment);
    }
  }

  // ----------------------------------------------------------------- refunds

  /**
   * Refund sent to Stripe by one of our flows. Row starts `processing`;
   * completion comes ONLY from refund.* webhooks (B4: never assume success).
   * Idempotent by idempotency_key (same key as the Stripe request).
   */
  async recordRefundCreated(
    manager: EntityManager,
    input: RefundCreatedInput,
    actor: Actor,
  ): Promise<RefundEntity> {
    const repository = manager.getRepository(RefundEntity);
    const existing = await repository.findOne({
      where: [
        { idempotency_key: input.idempotencyKey },
        { stripe_refund_id: input.stripeRefundId },
      ],
    });
    if (existing) {
      return existing;
    }
    const payment = input.paymentIntentId
      ? await this.findByPaymentIntent(manager, input.paymentIntentId)
      : await this.findLatestCharge(manager, input.reservationId);

    const refund = await repository.save(
      repository.create({
        reservation_id: input.reservationId,
        payment_id: payment?.id ?? null,
        status: REFUND_STATUS.PROCESSING,
        amount_cents: input.amountCents,
        currency: input.currency,
        reason: input.reason?.slice(0, 128) ?? null,
        requested_by_type: input.requestedBy.type,
        requested_by_id: input.requestedBy.id,
        approved_by_type: input.approvedBy?.type ?? null,
        approved_by_id: input.approvedBy?.id ?? null,
        responsible: input.responsible,
        stripe_refund_id: input.stripeRefundId,
        idempotency_key: input.idempotencyKey,
      }),
    );
    await this.auditLogService.record(manager, {
      entity: AUDIT_ENTITY.REFUND,
      entityId: refund.id,
      action: "refund.created",
      actor,
      after: {
        status: refund.status,
        amount_cents: refund.amount_cents,
        responsible: refund.responsible ?? null,
      },
      metadata: {
        reservation_id: input.reservationId,
        payment_id: refund.payment_id ?? null,
        stripe_refund_id: input.stripeRefundId,
        idempotency_key: input.idempotencyKey,
        reason: input.reason,
      },
    });
    return refund;
  }

  /** Awaiting V4P review (force majeure / exceptional host request). No Stripe call. */
  async recordRefundPending(
    manager: EntityManager,
    input: RefundCreatedInput,
    actor: Actor,
  ): Promise<RefundEntity> {
    const repository = manager.getRepository(RefundEntity);
    const existing = await repository.findOne({
      where: { idempotency_key: input.idempotencyKey },
    });
    if (existing) {
      return existing;
    }
    const payment = input.paymentIntentId
      ? await this.findByPaymentIntent(manager, input.paymentIntentId)
      : await this.findLatestCharge(manager, input.reservationId);

    const refund = await repository.save(
      repository.create({
        reservation_id: input.reservationId,
        payment_id: payment?.id ?? null,
        status: REFUND_STATUS.PENDING,
        amount_cents: input.amountCents,
        currency: input.currency,
        reason: input.reason?.slice(0, 128) ?? null,
        requested_by_type: input.requestedBy.type,
        requested_by_id: input.requestedBy.id,
        approved_by_type: input.approvedBy?.type ?? null,
        approved_by_id: input.approvedBy?.id ?? null,
        responsible: input.responsible,
        stripe_refund_id: null,
        idempotency_key: input.idempotencyKey,
      }),
    );
    await this.auditLogService.record(manager, {
      entity: AUDIT_ENTITY.REFUND,
      entityId: refund.id,
      action: "refund.pending_created",
      actor,
      after: {
        status: refund.status,
        amount_cents: refund.amount_cents,
        responsible: refund.responsible ?? null,
      },
      metadata: {
        reservation_id: input.reservationId,
        idempotency_key: input.idempotencyKey,
        reason: input.reason,
      },
    });
    return refund;
  }

  async rejectPendingRefund(
    manager: EntityManager,
    refundId: number,
    actor: Actor,
    failureReason: string,
  ): Promise<RefundEntity | null> {
    const repository = manager.getRepository(RefundEntity);
    const refund = await repository.findOne({ where: { id: refundId } });
    if (!refund || refund.status !== REFUND_STATUS.PENDING) {
      return refund;
    }
    await this.applyTransition(
      manager,
      refundStateMachine,
      AUDIT_ENTITY.REFUND,
      refund,
      REFUND_STATUS.FAILED,
      actor,
      { failure_reason: failureReason.slice(0, 255) },
      {
        onInvalid: ON_INVALID.THROW,
        metadata: { refund_id: refundId, decision: "reject" },
      },
      RefundEntity,
    );
    return repository.findOne({ where: { id: refundId } });
  }

  async submitPendingRefundToStripe(
    manager: EntityManager,
    refund: RefundEntity,
    stripeRefundId: string,
    stripeIdempotencyKey: string,
    actor: Actor,
  ): Promise<RefundEntity> {
    if (refund.status !== REFUND_STATUS.PENDING) {
      return refund;
    }
    refund.stripe_refund_id = stripeRefundId;
    refund.idempotency_key = stripeIdempotencyKey;
    await this.applyTransition(
      manager,
      refundStateMachine,
      AUDIT_ENTITY.REFUND,
      refund,
      REFUND_STATUS.PROCESSING,
      actor,
      {},
      {
        onInvalid: ON_INVALID.THROW,
        metadata: {
          stripe_refund_id: stripeRefundId,
          idempotency_key: stripeIdempotencyKey,
        },
      },
      RefundEntity,
    );
    return manager.getRepository(RefundEntity).findOneOrFail({
      where: { id: refund.id },
    });
  }

  /**
   * refund.created / refund.updated / refund.failed (and refunds embedded in
   * charge.refunded): Stripe is the source of truth for completion.
   * Idempotent: same status -> noop. Unknown refunds (Stripe Dashboard) get
   * a row with key refund:stripe:{id}. Returns not_found when the refund
   * cannot be tied to a reservation.
   */
  async syncRefundFromStripe(
    manager: EntityManager,
    stripeRefund: StripeRefundPayload,
    actor: Actor,
    fallbackReservationId?: number,
  ): Promise<RefundSyncResult> {
    const repository = manager.getRepository(RefundEntity);
    let refund = await repository.findOne({
      where: { stripe_refund_id: stripeRefund.id },
    });
    let created = false;

    const paymentIntentId = resolveId(stripeRefund.payment_intent);
    let payment: PaymentEntity | null = null;
    if (refund?.payment_id) {
      payment = await manager
        .getRepository(PaymentEntity)
        .findOne({ where: { id: refund.payment_id } });
    } else if (paymentIntentId) {
      payment = await this.findByPaymentIntent(manager, paymentIntentId);
    }

    if (!refund) {
      const metadataReservation = Number(stripeRefund.metadata?.reservation_id);
      const reservationId =
        payment?.reservation_id ??
        (Number.isInteger(metadataReservation) && metadataReservation > 0
          ? metadataReservation
          : fallbackReservationId);
      if (!reservationId) {
        return { refund: null, result: "not_found", created: false };
      }
      refund = await repository.save(
        repository.create({
          reservation_id: reservationId,
          payment_id: payment?.id ?? null,
          status: REFUND_STATUS.PROCESSING,
          amount_cents: Number(stripeRefund.amount ?? 0),
          currency: (
            stripeRefund.currency ??
            payment?.currency ??
            "eur"
          ).toLowerCase(),
          reason: stripeRefund.metadata?.reason ?? "external_stripe_refund",
          requested_by_type: actor.type,
          requested_by_id: actor.id,
          responsible: null,
          stripe_refund_id: stripeRefund.id,
          idempotency_key: refundKeys.external(stripeRefund.id),
        }),
      );
      created = true;
      await this.auditLogService.record(manager, {
        entity: AUDIT_ENTITY.REFUND,
        entityId: refund.id,
        action: "refund.created_from_stripe",
        actor,
        after: { status: refund.status, amount_cents: refund.amount_cents },
        metadata: {
          reservation_id: reservationId,
          stripe_refund_id: stripeRefund.id,
        },
      });
    }

    const isTotal = await this.wouldBeTotal(manager, refund, payment);
    const target = refundStatusFromStripe(stripeRefund.status, isTotal);
    const patch: Partial<RefundEntity> = {};
    if (isRefundCompleted(target)) {
      patch.completed_at = refund.completed_at ?? new Date();
      patch.failure_reason = null;
    } else if (target === REFUND_STATUS.FAILED) {
      patch.failure_reason =
        stripeRefund.failure_reason ?? stripeRefund.status ?? "failed";
    }
    const result = await this.applyTransition(
      manager,
      refundStateMachine,
      AUDIT_ENTITY.REFUND,
      refund,
      target,
      actor,
      patch,
      {
        onInvalid: ON_INVALID.IGNORE,
        metadata: {
          stripe_refund_id: stripeRefund.id,
          stripe_status: stripeRefund.status ?? null,
          reservation_id: refund.reservation_id,
        },
      },
      RefundEntity,
    );
    return { refund, result, created };
  }

  /** B4 aggregate for a reservation (none when no refund rows exist). */
  async aggregateRefundStatus(
    manager: EntityManager,
    reservationId: number,
  ): Promise<RefundStatus> {
    const rows = await manager.getRepository(RefundEntity).find({
      where: { reservation_id: reservationId },
      order: { id: "ASC" },
    });
    return aggregateRefundStatus(rows.map(row => row.status));
  }

  async sumCompletedRefunds(
    manager: EntityManager,
    paymentId: number,
    excludeRefundId?: number,
  ): Promise<number> {
    const rows = await manager.getRepository(RefundEntity).find({
      where: {
        payment_id: paymentId,
        status: In(COMPLETED_REFUND_STATUSES),
        ...(excludeRefundId === undefined ? {} : { id: Not(excludeRefundId) }),
      },
    });
    return rows.reduce((total, row) => total + row.amount_cents, 0);
  }

  private async wouldBeTotal(
    manager: EntityManager,
    refund: RefundEntity,
    payment: PaymentEntity | null,
  ): Promise<boolean> {
    if (!payment) {
      return false;
    }
    const others = await this.sumCompletedRefunds(
      manager,
      payment.id,
      refund.id,
    );
    return others + refund.amount_cents >= payment.amount_cents;
  }

  // ------------------------------------------------------------- internals

  private async applyTransition<
    S extends string,
    E extends { id: number; status: S },
  >(
    manager: EntityManager,
    machine: StateMachine<S>,
    entityName: string,
    row: E,
    to: S,
    actor: Actor,
    patch: Partial<E>,
    options: TransitionOptions,
    target: new () => E,
  ): Promise<LedgerTransition> {
    const from = row.status;
    let outcome;
    try {
      outcome = machine.assertTransition(from, to);
    } catch (error) {
      if (!(error instanceof InvalidTransitionError)) {
        throw error;
      }
      // Detached: must survive the rollback the THROW mode causes.
      await this.auditLogService.recordDetached({
        entity: entityName,
        entityId: row.id,
        action: `${entityName}.transition_rejected`,
        actor,
        before: { status: from },
        after: { status: to },
        metadata: options.metadata ?? null,
      });
      if ((options.onInvalid ?? ON_INVALID.THROW) === ON_INVALID.THROW) {
        throw error;
      }
      this.logger.warn(error.message);
      return LEDGER_TRANSITION.REJECTED;
    }

    if (outcome === TRANSITION_RESULT.NOOP) {
      return LEDGER_TRANSITION.NOOP;
    }

    Object.assign(row, patch, { status: to });
    await manager.getRepository(target).save(row);
    await this.auditLogService.record(manager, {
      entity: entityName,
      entityId: row.id,
      action: `${entityName}.status_changed`,
      actor,
      before: { status: from },
      after: { status: to },
      metadata: options.metadata ?? null,
    });
    return LEDGER_TRANSITION.CHANGED;
  }
}

/** Pure B4 aggregate over a reservation's refund rows. */
export function aggregateRefundStatus(
  statuses: readonly RefundStatus[],
): RefundStatus {
  if (statuses.length === 0) {
    return REFUND_STATUS.NONE;
  }
  if (statuses.includes(REFUND_STATUS.TOTAL_COMPLETED)) {
    return REFUND_STATUS.TOTAL_COMPLETED;
  }
  if (statuses.includes(REFUND_STATUS.PROCESSING)) {
    return REFUND_STATUS.PROCESSING;
  }
  if (statuses.includes(REFUND_STATUS.PENDING)) {
    return REFUND_STATUS.PENDING;
  }
  if (statuses.includes(REFUND_STATUS.FAILED)) {
    // B4: an open obligation beats a previous partial success.
    return REFUND_STATUS.FAILED;
  }
  return REFUND_STATUS.PARTIAL_COMPLETED;
}
