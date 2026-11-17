import type {
  AfterCommitTask,
  StripeWebhookEvent,
  WebhookHandlerResult,
} from "../types/stripe-webhook-event.type";

import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

import {
  StripeWebhookEventEntity,
  WEBHOOK_EVENT_STATUS,
} from "../entities/stripe-webhook-event.entity";
import { ExpressAccountsService } from "./express-accounts.service";
import { HostPayoutWebhookService } from "./host-payout-webhook.service";
import { ReservationWebhookService } from "./reservation-webhook.service";

/**
 * A delivery stuck in `processing` longer than this (worker crashed) may be
 * taken over by a retry. The processing transaction rolled back with the
 * crash, so reprocessing is safe.
 */
export const WEBHOOK_PROCESSING_LEASE_MS = 5 * 60 * 1000;

const MAX_ERROR_LENGTH = 2000;

export const WEBHOOK_CLAIM = {
  CLAIMED: "claimed",
  ALREADY_PROCESSED: "already_processed",
  IN_PROGRESS: "in_progress",
} as const;

export type WebhookClaim = (typeof WEBHOOK_CLAIM)[keyof typeof WEBHOOK_CLAIM];

export interface HandleWebhookResult {
  duplicate: boolean;
}

/**
 * Stripe webhook lifecycle (F0):
 * 1. claim     short tx: INSERT IGNORE the event row, lock it FOR UPDATE,
 *              skip if processed, 409 if another delivery holds a fresh lease,
 *              else mark processing + attempts++.
 * 2. process   one DB transaction for the handler side effects AND the
 *              `processed` mark (all-or-nothing).
 * 3. afterCommit  emails, only once the transaction committed.
 * On error: mark `failed` (+last_error) and rethrow -> non-2xx -> Stripe retries,
 * and the retried `failed` event is reprocessed.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @InjectRepository(StripeWebhookEventEntity)
    private readonly stripeWebhookEventRepository: Repository<StripeWebhookEventEntity>,
    private readonly reservationWebhookService: ReservationWebhookService,
    private readonly expressAccountsService: ExpressAccountsService,
    private readonly hostPayoutWebhookService: HostPayoutWebhookService,
  ) {}

  async handleWebhook(event: StripeWebhookEvent): Promise<HandleWebhookResult> {
    const claim = await this.claimEvent(event);
    if (claim === WEBHOOK_CLAIM.ALREADY_PROCESSED) {
      return { duplicate: true };
    }
    if (claim === WEBHOOK_CLAIM.IN_PROGRESS) {
      // Non-2xx on purpose: Stripe retries later and the retry is skipped
      // (processed) or reprocessed (failed/stale lease).
      throw new ConflictException(
        `Stripe event ${event.id} is being processed by another delivery`,
      );
    }

    const afterCommit: AfterCommitTask[] = [];
    try {
      await this.stripeWebhookEventRepository.manager.transaction(
        async manager => {
          const result = await this.dispatch(event, manager, afterCommit);
          await manager.getRepository(StripeWebhookEventEntity).update(
            { stripe_event_id: event.id },
            {
              status: WEBHOOK_EVENT_STATUS.PROCESSED,
              processed_at: new Date(),
              last_error: null,
              ...(result.reservationId === undefined
                ? {}
                : { reservation_id: result.reservationId }),
            },
          );
        },
      );
    } catch (error) {
      await this.markFailed(event.id, error);
      throw error;
    }

    for (const task of afterCommit) {
      try {
        await task();
      } catch (error) {
        // Email failures must not make Stripe replay a committed money change.
        this.logger.error(
          `Post-commit task failed for Stripe event ${event.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return { duplicate: false };
  }

  async claimEvent(event: StripeWebhookEvent): Promise<WebhookClaim> {
    return this.stripeWebhookEventRepository.manager.transaction(
      async manager => {
        const repository = manager.getRepository(StripeWebhookEventEntity);
        const now = new Date();

        // INSERT IGNORE: two simultaneous deliveries cannot both create the
        // row; the loser waits on the PK and then reads the winner's row.
        await repository
          .createQueryBuilder()
          .insert()
          .into(StripeWebhookEventEntity)
          .values({
            stripe_event_id: event.id,
            type: event.type,
            payload: event.data.object as QueryDeepPartialEntity<
              Record<string, unknown>
            >,
            status: WEBHOOK_EVENT_STATUS.RECEIVED,
            attempts: 0,
            received_at: now,
          })
          .orIgnore()
          .execute();

        const row = await repository.findOne({
          where: { stripe_event_id: event.id },
          lock: { mode: "pessimistic_write" },
        });
        if (!row) {
          throw new Error(`Stripe event ${event.id} could not be registered`);
        }

        if (row.status === WEBHOOK_EVENT_STATUS.PROCESSED) {
          return WEBHOOK_CLAIM.ALREADY_PROCESSED;
        }

        const leaseStart = row.processing_started_at
          ? new Date(row.processing_started_at).getTime()
          : 0;
        if (
          row.status === WEBHOOK_EVENT_STATUS.PROCESSING &&
          now.getTime() - leaseStart < WEBHOOK_PROCESSING_LEASE_MS
        ) {
          return WEBHOOK_CLAIM.IN_PROGRESS;
        }

        row.status = WEBHOOK_EVENT_STATUS.PROCESSING;
        row.attempts += 1;
        row.processing_started_at = now;
        await repository.save(row);
        return WEBHOOK_CLAIM.CLAIMED;
      },
    );
  }

  private async markFailed(eventId: string, error: unknown): Promise<void> {
    const message = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, MAX_ERROR_LENGTH);
    this.logger.error(
      `Stripe event ${eventId} failed: ${message}`,
      error instanceof Error ? error.stack : undefined,
    );
    try {
      await this.stripeWebhookEventRepository.update(
        { stripe_event_id: eventId },
        { status: WEBHOOK_EVENT_STATUS.FAILED, last_error: message },
      );
    } catch (updateError) {
      this.logger.error(
        `Could not mark Stripe event ${eventId} as failed`,
        updateError instanceof Error ? updateError.stack : String(updateError),
      );
    }
  }

  private async dispatch(
    event: StripeWebhookEvent,
    manager: EntityManager,
    afterCommit: AfterCommitTask[],
  ): Promise<WebhookHandlerResult> {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        return this.reservationWebhookService.handleCheckoutCompleted(
          event,
          manager,
          afterCommit,
        );
      }
      case "checkout.session.expired":
      case "checkout.session.async_payment_failed": {
        return this.reservationWebhookService.handleCheckoutExpired(
          event,
          manager,
        );
      }
      case "payment_intent.succeeded":
      case "payment_intent.payment_failed": {
        // Fase 4: only off-session deferred charges (metadata.deferred=1).
        return this.reservationWebhookService.handlePaymentIntentEvent(
          event,
          manager,
          afterCommit,
        );
      }
      case "charge.refunded": {
        return this.reservationWebhookService.handleChargeRefunded(
          event,
          manager,
          afterCommit,
        );
      }
      case "refund.created":
      case "refund.updated":
      case "refund.failed": {
        return this.reservationWebhookService.handleRefundEvent(
          event,
          manager,
          afterCommit,
        );
      }
      case "charge.dispute.created": {
        return this.reservationWebhookService.handleChargeDisputeCreated(
          event,
          manager,
          afterCommit,
        );
      }
      case "charge.dispute.closed": {
        return this.reservationWebhookService.handleChargeDisputeClosed(
          event,
          manager,
        );
      }
      case "transfer.created": {
        return this.reservationWebhookService.handleTransferCreated(
          event,
          manager,
        );
      }
      case "account.updated": {
        // Writes to the legacy user_profiles table (own mysql pool,
        // idempotent upsert of stripe_account_id).
        await this.expressAccountsService.handleAccountUpdated(event);
        return {};
      }
      case "payout.failed": {
        return this.hostPayoutWebhookService.handlePayoutFailed(
          event,
          manager,
          afterCommit,
        );
      }
      case "payout.paid": {
        return this.hostPayoutWebhookService.handlePayoutPaid(event, manager);
      }
      default: {
        return {};
      }
    }
  }
}
