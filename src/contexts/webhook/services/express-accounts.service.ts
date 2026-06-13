import type { StripeWebhookEvent } from "../types/stripe-webhook-event.type";

import { Injectable, Logger } from "@nestjs/common";

import { UserProfilesService } from "../../stripe/services/user-profiles.service";

interface StripeAccountPayload {
  id: string;
  charges_enabled?: boolean;
  details_submitted?: boolean;
  metadata?: Record<string, string>;
}

@Injectable()
export class ExpressAccountsService {
  private readonly logger = new Logger(ExpressAccountsService.name);

  constructor(private readonly userProfilesService: UserProfilesService) {}

  async handleAccountUpdated(event: StripeWebhookEvent) {
    if (event.type !== "account.updated") {
      return;
    }

    const account = event.data.object as StripeAccountPayload;
    const metadataUserId = Number(account.metadata?.user_id);

    if (metadataUserId && !Number.isNaN(metadataUserId)) {
      await this.userProfilesService.saveStripeAccountId(
        metadataUserId,
        account.id,
      );
      this.logger.log(
        `Synced stripe_account_id=${account.id} for user_id=${metadataUserId}`,
      );
      return;
    }

    const existingProfile =
      await this.userProfilesService.findByStripeAccountId(account.id);
    if (!existingProfile) {
      this.logger.warn(
        `account.updated for ${account.id} without metadata.user_id and no matching profile`,
      );
      return;
    }

    if (existingProfile.stripe_account_id !== account.id) {
      await this.userProfilesService.saveStripeAccountId(
        existingProfile.id,
        account.id,
      );
    }

    if (account.charges_enabled && account.details_submitted) {
      this.logger.log(
        `Stripe Connect onboarding completed for user_id=${existingProfile.id} (account ${account.id})`,
      );
    }
  }
}
