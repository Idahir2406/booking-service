import { Body, Controller, Post } from "@nestjs/common";
import { type Stripe } from "stripe";

import { ReservationWebhookService } from "../services/reservation-webhook.service";

@Controller({
  path: "webhook",
  version: "1",
})
export class WebhookController {
  constructor(
  ) {}

  @Post()
  create(@Body() body: Stripe) {
    console.log(`body: ${JSON.stringify(body)}`);
    return {
      message: "Webhook received",
    };
  }
}
