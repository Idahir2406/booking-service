import type {
  AfterCommitTask,
  StripeWebhookEvent,
  WebhookHandlerResult,
} from "../types/stripe-webhook-event.type";

import { Injectable, Logger } from "@nestjs/common";
import { EntityManager } from "typeorm";

import { HostPayoutBlockService } from "../../reservations/services/host-payout-block.service";
import { UserProfilesService } from "../../stripe/services/user-profiles.service";

interface StripePayoutPayload {
  id: string;
  amount?: number;
  currency?: string;
  failure_code?: string | null;
  failure_message?: string | null;
  created?: number;
}

/**
 * Punto 9: payouts of the HOST's Stripe balance to the host's bank
 * (Connect events, event.account = host account). payout.failed opens a
 * host_payout_failures row (+ emails after commit); payout.paid resolves
 * every open row of that account.
 */
@Injectable()
export class HostPayoutWebhookService {
  private readonly logger = new Logger(HostPayoutWebhookService.name);

  constructor(
    private readonly hostPayoutBlockService: HostPayoutBlockService,
    private readonly userProfilesService: UserProfilesService,
  ) {}

  async handlePayoutFailed(
    event: StripeWebhookEvent,
    manager: EntityManager,
    afterCommit: AfterCommitTask[],
  ): Promise<WebhookHandlerResult> {
    const accountId = event.account;
    if (!accountId) {
      // A payout of the PLATFORM balance: not a host problem.
      this.logger.warn(`payout.failed ${event.id} without account (platform payout)`);
      return {};
    }
    const payout = event.data.object as StripePayoutPayload;
    const profile = await this.userProfilesService.findByStripeAccountId(accountId);
    const input = {
      stripeAccountId: accountId,
      userId: profile ? Number(profile.id) : null,
      stripePayoutId: payout.id,
      amountCents: Number(payout.amount ?? 0),
      currency: String(payout.currency ?? "eur").toLowerCase(),
      failureCode: payout.failure_code ?? null,
      failureMessage: payout.failure_message ?? null,
      failedAt: new Date(),
    };
    const created = await this.hostPayoutBlockService.recordBankPayoutFailure(
      manager,
      input,
    );
    if (created) {
      afterCommit.push(() =>
        this.hostPayoutBlockService.notifyBankPayoutFailed(input),
      );
    }
    return {};
  }

  async handlePayoutPaid(
    event: StripeWebhookEvent,
    manager: EntityManager,
  ): Promise<WebhookHandlerResult> {
    if (!event.account) {
      return {};
    }
    const resolved = await this.hostPayoutBlockService.resolveBankPayoutFailures(
      manager,
      event.account,
      new Date(),
    );
    if (resolved > 0) {
      this.logger.log(
        `payout.paid ${event.id}: resolved ${resolved} bank payout failure(s) of ${event.account}`,
      );
    }
    return {};
  }
}
