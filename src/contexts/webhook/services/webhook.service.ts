import { Injectable } from "@nestjs/common";
import type {
  AccountUpdatedEvent,
  Event,
} from "stripe/esm/resources/Events.js";

@Injectable()
export class WebhookService {
  async handleWebhook(event: Event) {
    switch (event.type) {
      case "account.updated":
        return this.handleAccountUpdated(event);
      default:
        return;
    }
  }

  private async handleAccountUpdated(event: AccountUpdatedEvent) {
    const account = event.data.object;
    return account;
  }
}