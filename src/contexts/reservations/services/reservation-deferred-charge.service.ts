import type {
  OffSessionChargeResult,
  StripeService,
} from "../../stripe/services/stripe.service";

import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import {
  EntityManager,
  IsNull,
  LessThan,
  LessThanOrEqual,
  Repository,
} from "typeorm";

import { type Actor, actors } from "../../payments/domain/audit-actor";
import { freeCancellationDeadlineIso } from "../../payments/domain/cancellation-policy";
import { PAYMENT_STATUS } from "../../payments/domain/payment-state-machine";
import { PaymentEntity } from "../../payments/entities/payment.entity";
import { ReservationEconomicsService } from "../../payments/services/reservation-economics.service";
import { ReservationEntity } from "../entities/reservation.entity";
import { expectedChargeCents } from "../utils/reservation-amount.util";
import {
  getCheckinStartUtc,
  isDeferredUnpaid,
} from "../utils/reservation-policy.util";
import { ReservationService } from "./reservation.service";
import { ReservationEmailService } from "./reservation-email.service";
import { ReservationEventService } from "./reservation-event.service";

/** PaymentIntent status values returned by chargeOffSession (no SDK import). */
const CHARGE = {
  SUCCEEDED: "succeeded",
  PROCESSING: "processing",
} as const;

/** reservations.cancel_reason when the regularization window expires. */
export const DEFERRED_CHARGE_UNPAID_REASON = "deferred_charge_unpaid";

const DEFAULT_TIMEZONE = "Europe/Madrid";
const HOUR_MS = 60 * 60 * 1000;
const CRON_BATCH = 50;

export const DEFERRED_CHARGE_OUTCOME = {
  PAID: "paid",
  /** Async settlement: payment_intent.* webhooks finish it. */
  PROCESSING: "processing",
  /** Charge failed: regularization window opened, traveler/host notified. */
  REGULARIZATION: "regularization",
  /** Nothing to do (already paid, in flight, not due, cancelled...). */
  SKIPPED: "skipped",
} as const;

export type DeferredChargeOutcome =
  (typeof DEFERRED_CHARGE_OUTCOME)[keyof typeof DEFERRED_CHARGE_OUTCOME];

export interface DeferredChargeRunResult {
  reservationId: number;
  outcome: DeferredChargeOutcome;
  reason?: string;
  paymentIntentId?: string | null;
}

export const PENALTY_CHARGE_OUTCOME = {
  CHARGED: "charged",
  /** Async: the payment_intent.* webhook settles it. */
  PROCESSING: "processing",
  FAILED: "failed",
  /** Penalty 0: nothing to charge. */
  NONE: "none",
} as const;

export type PenaltyChargeOutcome =
  (typeof PENALTY_CHARGE_OUTCOME)[keyof typeof PENALTY_CHARGE_OUTCOME];

export interface PenaltyChargeResult {
  outcome: PenaltyChargeOutcome;
  paymentIntentId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
}

export type PostCommitTask = () => Promise<void>;

interface ChargeFailure {
  code: string;
  message: string | null;
}

/**
 * Regularization deadline (A7): min(now + window, check-in start in the
 * site timezone). Never later than the stay starts, so a no-show can never
 * happen on an unpaid reservation.
 */
export function regularizationDeadline(
  reservation: Pick<ReservationEntity, "checkin" | "timezone">,
  now: Date,
  windowHours: number,
): Date {
  const checkin = String(reservation.checkin).slice(0, 10);
  let checkinStartMs: number;
  try {
    checkinStartMs = new Date(
      freeCancellationDeadlineIso(
        checkin,
        0,
        reservation.timezone ?? DEFAULT_TIMEZONE,
        "00:00",
      ),
    ).getTime();
  } catch {
    checkinStartMs = getCheckinStartUtc(checkin).getTime();
  }
  const windowEndMs = now.getTime() + Math.max(0, windowHours) * HOUR_MS;
  return new Date(Math.min(windowEndMs, checkinStartMs));
}

/**
 * Fase 4 · deferred charge of `flexible` reservations (A5-A7).
 * - processDueCharges (cron, 5 min): confirmed flexible reservations whose
 *   charge_at is due are charged off-session with the saved card. Row lock
 *   (SELECT ... FOR UPDATE) + status re-check + idempotency key with the
 *   ledger attempts counter make a double run (two instances, retries)
 *   charge at most once.
 * - failure (declined / authentication_required) -> ledger failed ->
 *   pending_regularization, regularization_deadline_at, emails with the
 *   «Pagar reserva» link (TravelerReservationPayService).
 * - expireRegularizations (cron, 5 min): deadline passed and still unpaid ->
 *   ledger definitive_unpaid, reservation cancelled (deferred_charge_unpaid),
 *   nights released, emails.
 * Stripe calls happen inside the transaction (same pattern as
 * refundInTransaction): a rollback retries with the SAME idempotency key.
 */
@Injectable()
export class ReservationDeferredChargeService {
  private readonly logger = new Logger(ReservationDeferredChargeService.name);

  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    private readonly reservationService: ReservationService,
    private readonly economics: ReservationEconomicsService,
    @Inject(
      forwardRef(
        // Circular StripeModule <-> ReservationModule (pre-existing pattern).
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-return, node/no-missing-require
        () => require("../../stripe/services/stripe.service").StripeService,
      ),
    )
    private readonly stripeService: StripeService,
    private readonly reservationEmailService: ReservationEmailService,
    private readonly reservationEventService: ReservationEventService,
  ) {}

  // ------------------------------------------------------------ due charges

  @Cron("*/5 * * * *")
  async processDueCharges(
    now: Date = new Date(),
  ): Promise<DeferredChargeRunResult[]> {
    const due = await this.reservationRepository.find({
      select: { id: true },
      where: {
        charge_mode: "flexible",
        status: "confirmed",
        payment_status: "pending",
        charge_at: LessThanOrEqual(now),
        regularization_deadline_at: IsNull(),
      },
      order: { charge_at: "ASC" },
      take: CRON_BATCH,
    });
    const results: DeferredChargeRunResult[] = [];
    for (const row of due) {
      try {
        results.push(await this.chargeReservation(row.id, now));
      } catch (error) {
        this.logger.error(
          `Deferred charge failed for reservation ${row.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return results;
  }

  /**
   * Charges one reservation now (cron, or right after the setup activation
   * when charge_at is due / the card expires before it). Safe to call twice.
   */
  async chargeReservation(
    reservationId: number,
    now: Date = new Date(),
    actor: Actor = actors.system("deferred_charge"),
  ): Promise<DeferredChargeRunResult> {
    const tasks: PostCommitTask[] = [];
    const result = await this.reservationRepository.manager.transaction(
      async (manager): Promise<DeferredChargeRunResult> => {
        const reservation = await this.lock(manager, reservationId);
        const skip = (reason: string): DeferredChargeRunResult => ({
          reservationId,
          outcome: DEFERRED_CHARGE_OUTCOME.SKIPPED,
          reason,
        });
        if (!isDeferredUnpaid(reservation)) {
          return skip("not_deferred_unpaid");
        }
        if (reservation.regularization_deadline_at) {
          return skip("in_regularization");
        }
        const chargeAtMs = reservation.charge_at
          ? new Date(reservation.charge_at).getTime()
          : Number.NaN;
        if (!Number.isFinite(chargeAtMs) || chargeAtMs > now.getTime()) {
          return skip("not_due");
        }
        const payment = await this.economics.findLatestPayment(
          manager,
          reservationId,
        );
        if (!payment) {
          return skip("no_payment_row");
        }
        if (payment.status !== PAYMENT_STATUS.METHOD_VALIDATED) {
          // processing = a charge is in flight (webhook settles it).
          return skip(`payment_${payment.status}`);
        }

        const attempt = payment.attempts + 1;
        await this.economics.transitionPayment(
          manager,
          payment,
          PAYMENT_STATUS.PROCESSING,
          actor,
          { attempts: attempt },
          { metadata: { trigger: "deferred_charge", attempt } },
        );
        const charge = await this.stripeService.chargeOffSession({
          reservation,
          attempt,
        });

        if (charge.status === CHARGE.SUCCEEDED && charge.paymentIntentId) {
          const saved = await this.reservationService.applyDeferredPayment(
            manager,
            reservation,
            {
              paymentIntentId: charge.paymentIntentId,
              amountCents: charge.amountCents,
              actor,
              trigger: "deferred_charge_cron",
            },
          );
          tasks.push(() => this.notifySucceeded(saved, charge.amountCents));
          return {
            reservationId,
            outcome: DEFERRED_CHARGE_OUTCOME.PAID,
            paymentIntentId: charge.paymentIntentId,
          };
        }

        if (charge.status === CHARGE.PROCESSING && charge.paymentIntentId) {
          payment.stripe_payment_intent_id = charge.paymentIntentId;
          await manager.getRepository(PaymentEntity).save(payment);
          await this.reservationEventService.logEventInTransaction(
            manager,
            reservationId,
            "deferred_charge_processing",
            { payment_intent_id: charge.paymentIntentId, attempt },
          );
          return {
            reservationId,
            outcome: DEFERRED_CHARGE_OUTCOME.PROCESSING,
            paymentIntentId: charge.paymentIntentId,
          };
        }

        const saved = await this.enterRegularization(
          manager,
          reservation,
          payment,
          this.failureOf(charge),
          now,
          actor,
          charge.paymentIntentId,
        );
        tasks.push(() => this.notifyFailed(saved));
        return {
          reservationId,
          outcome: DEFERRED_CHARGE_OUTCOME.REGULARIZATION,
          reason: charge.failureCode ?? charge.status,
          paymentIntentId: charge.paymentIntentId,
        };
      },
    );
    await this.runTasks(tasks, reservationId);
    return result;
  }

  // ------------------------------------------------ async PI (webhooks)

  /**
   * payment_intent.succeeded of an off-session charge (metadata.deferred=1),
   * inside the webhook transaction. Idempotent: an already paid reservation
   * (same PI) is a no-op; also adopts a PI whose run rolled back after
   * Stripe charged.
   */
  async handleAsyncChargeSucceeded(
    manager: EntityManager,
    input: {
      reservationId: number;
      paymentIntentId: string;
      amountCents: number;
      purpose: string | null;
      actor: Actor;
    },
  ): Promise<PostCommitTask[]> {
    const reservation = await this.lockOrNull(manager, input.reservationId);
    if (!reservation) {
      return [];
    }
    if (reservation.stripe_payment_intent_id === input.paymentIntentId) {
      return [];
    }
    if (input.purpose === "cancellation_penalty") {
      if (
        reservation.status !== "cancelled" ||
        reservation.payment_status !== "pending"
      ) {
        return [];
      }
      await this.recordPenaltyPaid(manager, reservation, {
        paymentIntentId: input.paymentIntentId,
        amountCents: input.amountCents,
        actor: input.actor,
      });
      return [];
    }
    if (!isDeferredUnpaid(reservation)) {
      this.logger.warn(
        `payment_intent ${input.paymentIntentId} succeeded for reservation ${reservation.id} in state ${reservation.status}/${reservation.payment_status}; left for review`,
      );
      return [];
    }
    if (input.amountCents !== expectedChargeCents(reservation)) {
      this.logger.error(
        `Deferred charge amount mismatch for reservation ${reservation.id}: expected ${expectedChargeCents(reservation)}, got ${input.amountCents}`,
      );
    }
    const saved = await this.reservationService.applyDeferredPayment(
      manager,
      reservation,
      {
        paymentIntentId: input.paymentIntentId,
        amountCents: input.amountCents,
        actor: input.actor,
        trigger: "payment_intent_webhook",
      },
    );
    return [() => this.notifySucceeded(saved, input.amountCents)];
  }

  /**
   * payment_intent.payment_failed of an off-session charge still in flight
   * (ledger processing with that PI): opens the regularization window.
   * Out-of-order / already handled events are no-ops.
   */
  async handleAsyncChargeFailed(
    manager: EntityManager,
    input: {
      reservationId: number;
      paymentIntentId: string;
      failureCode: string | null;
      failureMessage: string | null;
      actor: Actor;
      now?: Date;
    },
  ): Promise<PostCommitTask[]> {
    const reservation = await this.lockOrNull(manager, input.reservationId);
    if (!reservation || !isDeferredUnpaid(reservation)) {
      return [];
    }
    if (reservation.regularization_deadline_at) {
      return [];
    }
    const payment = await this.economics.findLatestPayment(
      manager,
      reservation.id,
    );
    if (
      !payment ||
      payment.status !== PAYMENT_STATUS.PROCESSING ||
      payment.stripe_payment_intent_id !== input.paymentIntentId
    ) {
      return [];
    }
    const saved = await this.enterRegularization(
      manager,
      reservation,
      payment,
      {
        code: input.failureCode ?? "payment_failed",
        message: input.failureMessage,
      },
      input.now ?? new Date(),
      input.actor,
      input.paymentIntentId,
    );
    return [() => this.notifyFailed(saved)];
  }

  // ------------------------------------------------------- regularization

  @Cron("*/5 * * * *")
  async expireRegularizations(now: Date = new Date()): Promise<number[]> {
    const due = await this.reservationRepository.find({
      select: { id: true },
      where: {
        charge_mode: "flexible",
        status: "confirmed",
        payment_status: "pending",
        regularization_deadline_at: LessThan(now),
      },
      take: CRON_BATCH,
    });
    const cancelled: number[] = [];
    for (const row of due) {
      try {
        if (await this.expireRegularization(row.id, now)) {
          cancelled.push(row.id);
        }
      } catch (error) {
        this.logger.error(
          `Could not expire regularization of reservation ${row.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return cancelled;
  }

  async expireRegularization(
    reservationId: number,
    now: Date = new Date(),
    actor: Actor = actors.system("regularization_expiry"),
  ): Promise<boolean> {
    const outcome = await this.reservationRepository.manager.transaction(
      async manager => {
        const reservation = await this.lock(manager, reservationId);
        const deadline = reservation.regularization_deadline_at
          ? new Date(reservation.regularization_deadline_at).getTime()
          : Number.NaN;
        if (
          !isDeferredUnpaid(reservation) ||
          !Number.isFinite(deadline) ||
          deadline >= now.getTime()
        ) {
          return null;
        }
        const payment = await this.economics.findLatestPayment(
          manager,
          reservationId,
        );
        if (payment?.status === PAYMENT_STATUS.PROCESSING) {
          // A regularization payment is settling: the webhook decides.
          return null;
        }
        if (payment) {
          await this.economics.transitionPayment(
            manager,
            payment,
            PAYMENT_STATUS.DEFINITIVE_UNPAID,
            actor,
            {},
            {
              onInvalid: "ignore",
              metadata: { trigger: "regularization_expired" },
            },
          );
        }
        const before = {
          status: reservation.status,
          payment_status: reservation.payment_status,
        };
        reservation.status = "cancelled";
        reservation.cancelled_at = now;
        reservation.cancel_reason = DEFERRED_CHARGE_UNPAID_REASON;
        reservation.refund_on_cancel = false;
        const saved = await manager
          .getRepository(ReservationEntity)
          .save(reservation);
        await this.reservationService.releaseAvailabilityForReservation(
          saved,
          manager,
        );
        await this.economics.auditReservationChange(
          manager,
          reservationId,
          "reservation.cancelled",
          actor,
          before,
          { status: saved.status, payment_status: saved.payment_status },
          { reason: DEFERRED_CHARGE_UNPAID_REASON },
        );
        await this.reservationEventService.logEventInTransaction(
          manager,
          reservationId,
          "cancelled",
          { by: "system", reason: DEFERRED_CHARGE_UNPAID_REASON },
        );
        return saved;
      },
    );
    if (!outcome) {
      return false;
    }
    await this.runTasks(
      [
        () => this.notifyRegularizationExpired(outcome),
        () => this.detachQuietly(outcome.stripe_payment_method_id),
      ],
      reservationId,
    );
    return true;
  }

  // ------------------------------------------------- cancellation penalty

  /**
   * Cancellation of a flexible reservation never charged, outside the free
   * period: the penalty is charged off-session with the saved card, inside
   * the caller's transaction (row locked). The ledger payment row becomes
   * the penalty payment (paid with amount = penalty) or failed.
   */
  async chargePenaltyInTransaction(
    manager: EntityManager,
    reservation: ReservationEntity,
    penaltyCents: number,
    actor: Actor,
  ): Promise<PenaltyChargeResult> {
    if (penaltyCents <= 0) {
      return {
        outcome: PENALTY_CHARGE_OUTCOME.NONE,
        paymentIntentId: null,
        failureCode: null,
        failureMessage: null,
      };
    }
    const payment = await this.economics.findLatestPayment(
      manager,
      reservation.id,
    );
    const attempt = (payment?.attempts ?? 0) + 1;
    if (payment) {
      await this.economics.transitionPayment(
        manager,
        payment,
        PAYMENT_STATUS.PROCESSING,
        actor,
        { attempts: attempt },
        {
          onInvalid: "ignore",
          metadata: {
            trigger: "cancellation_penalty",
            attempt,
            penalty_cents: penaltyCents,
          },
        },
      );
    }
    const charge = await this.stripeService.chargeOffSession({
      reservation,
      attempt,
      amountCents: penaltyCents,
      purpose: "cancellation_penalty",
    });
    if (charge.status === CHARGE.SUCCEEDED && charge.paymentIntentId) {
      await this.recordPenaltyPaid(manager, reservation, {
        paymentIntentId: charge.paymentIntentId,
        amountCents: penaltyCents,
        actor,
      });
      return {
        outcome: PENALTY_CHARGE_OUTCOME.CHARGED,
        paymentIntentId: charge.paymentIntentId,
        failureCode: null,
        failureMessage: null,
      };
    }
    if (charge.status === CHARGE.PROCESSING && charge.paymentIntentId) {
      if (payment) {
        payment.stripe_payment_intent_id = charge.paymentIntentId;
        await manager.getRepository(PaymentEntity).save(payment);
      }
      return {
        outcome: PENALTY_CHARGE_OUTCOME.PROCESSING,
        paymentIntentId: charge.paymentIntentId,
        failureCode: null,
        failureMessage: null,
      };
    }
    const failure = this.failureOf(charge);
    if (payment) {
      await this.economics.transitionPayment(
        manager,
        payment,
        PAYMENT_STATUS.FAILED,
        actor,
        {
          failure_code: failure.code.slice(0, 128),
          failure_message: failure.message,
          stripe_payment_intent_id: null,
        },
        {
          onInvalid: "ignore",
          metadata: {
            trigger: "cancellation_penalty",
            payment_intent_id: charge.paymentIntentId,
          },
        },
      );
    }
    return {
      outcome: PENALTY_CHARGE_OUTCOME.FAILED,
      paymentIntentId: charge.paymentIntentId,
      failureCode: failure.code,
      failureMessage: failure.message,
    };
  }

  /** Best effort, after commit: the saved card is no longer needed. */
  async detachQuietly(paymentMethodId: string | null | undefined) {
    if (!paymentMethodId) {
      return;
    }
    const detached =
      await this.stripeService.detachPaymentMethodQuietly(paymentMethodId);
    if (!detached) {
      this.logger.warn(`Could not detach payment method ${paymentMethodId}`);
    }
  }

  // -------------------------------------------------------------- internals

  /**
   * Penalty charged: the reservation (already cancelled by the caller or
   * about to be) records the PaymentIntent; payment_status "paid" with the
   * penalty as the ledger amount; payout held (V4P liquidates it like any
   * cancelled reservation with a retained amount).
   */
  private async recordPenaltyPaid(
    manager: EntityManager,
    reservation: ReservationEntity,
    input: { paymentIntentId: string; amountCents: number; actor: Actor },
  ): Promise<void> {
    reservation.payment_status = "paid";
    reservation.paid_at = new Date();
    reservation.stripe_payment_intent_id = input.paymentIntentId;
    reservation.regularization_deadline_at = null;
    await this.economics.transitionPayout(
      manager,
      reservation,
      "held",
      input.actor,
      { onInvalid: "ignore", metadata: { trigger: "cancellation_penalty" } },
    );
    await manager.getRepository(ReservationEntity).save(reservation);
    await this.economics.recordPaymentSucceeded(
      manager,
      reservation,
      null,
      input.paymentIntentId,
      input.amountCents,
      input.actor,
    );
    await this.reservationEventService.logEventInTransaction(
      manager,
      reservation.id,
      "cancellation_penalty_charged",
      {
        payment_intent_id: input.paymentIntentId,
        amount_cents: input.amountCents,
      },
    );
  }

  private async enterRegularization(
    manager: EntityManager,
    reservation: ReservationEntity,
    payment: PaymentEntity,
    failure: ChargeFailure,
    now: Date,
    actor: Actor,
    paymentIntentId: string | null,
  ): Promise<ReservationEntity> {
    // The failed PI is kept in the audit only: a later regularization
    // payment (new PI) must find this row without a PI to settle it.
    await this.economics.transitionPayment(
      manager,
      payment,
      PAYMENT_STATUS.FAILED,
      actor,
      {
        failure_code: failure.code.slice(0, 128),
        failure_message: failure.message,
        stripe_payment_intent_id: null,
      },
      {
        onInvalid: "ignore",
        metadata: {
          trigger: "deferred_charge_failed",
          payment_intent_id: paymentIntentId,
        },
      },
    );
    await this.economics.transitionPayment(
      manager,
      payment,
      PAYMENT_STATUS.PENDING_REGULARIZATION,
      actor,
      {},
      { onInvalid: "ignore", metadata: { trigger: "deferred_charge_failed" } },
    );
    const settings = await this.economics.getPlatformSettings();
    const deadline = regularizationDeadline(
      reservation,
      now,
      settings.regularization_window_hours,
    );
    reservation.regularization_deadline_at = deadline;
    const saved = await manager
      .getRepository(ReservationEntity)
      .save(reservation);
    await this.economics.auditReservationChange(
      manager,
      reservation.id,
      "reservation.deferred_charge_failed",
      actor,
      null,
      { regularization_deadline_at: deadline.toISOString() },
      {
        failure_code: failure.code,
        failure_message: failure.message,
        payment_intent_id: paymentIntentId,
      },
    );
    await this.reservationEventService.logEventInTransaction(
      manager,
      reservation.id,
      "deferred_charge_failed",
      {
        failure_code: failure.code,
        payment_intent_id: paymentIntentId,
        regularization_deadline_at: deadline.toISOString(),
      },
    );
    return saved;
  }

  private failureOf(charge: OffSessionChargeResult): ChargeFailure {
    return {
      code: charge.failureCode ?? charge.status,
      message: charge.failureMessage,
    };
  }

  private async lock(
    manager: EntityManager,
    id: number,
  ): Promise<ReservationEntity> {
    const reservation = await this.lockOrNull(manager, id);
    if (!reservation) {
      throw new NotFoundException(`Reservation with id ${id} not found`);
    }
    return reservation;
  }

  private lockOrNull(
    manager: EntityManager,
    id: number,
  ): Promise<ReservationEntity | null> {
    return manager.getRepository(ReservationEntity).findOne({
      where: { id },
      lock: { mode: "pessimistic_write" },
    });
  }

  private async runTasks(
    tasks: PostCommitTask[],
    reservationId: number,
  ): Promise<void> {
    for (const task of tasks) {
      try {
        await task();
      } catch (error) {
        this.logger.error(
          `Post-commit task failed for reservation ${reservationId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  private async notifySucceeded(
    reservation: ReservationEntity,
    amountCents: number,
  ): Promise<void> {
    const site = await this.reservationService.getSiteById(reservation.site_id);
    await this.reservationEmailService.sendDeferredChargeSucceededEmail(
      reservation,
      site,
      amountCents,
    );
  }

  private async notifyFailed(reservation: ReservationEntity): Promise<void> {
    const site = await this.reservationService.getSiteById(reservation.site_id);
    await this.reservationEmailService.sendDeferredChargeFailedEmails(
      reservation,
      site,
    );
  }

  private async notifyRegularizationExpired(
    reservation: ReservationEntity,
  ): Promise<void> {
    const site = await this.reservationService.getSiteById(reservation.site_id);
    await this.reservationEmailService.sendRegularizationExpiredEmails(
      reservation,
      site,
    );
  }
}
