import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";

import {
  BadRequestException,
  Controller,
  Headers,
  Post,
  Req,
} from "@nestjs/common";

import { StripeService } from "../../stripe/services/stripe.service";
import { WebhookService } from "../services/webhook.service";

@Controller({
  path: "webhook",
  version: "1",
})
export class WebhookController {
  constructor(
    private readonly webhookService: WebhookService,
    private readonly stripeService: StripeService,
  ) {}

  @Post()
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers("stripe-signature") signature?: string,
  ) {
    if (!signature) {
      throw new BadRequestException("Missing Stripe-Signature header");
    }

    const rawBody = req.rawBody ?? (req.body as Buffer);

    let event;
    try {
      event = this.stripeService.constructWebhookEvent(rawBody, signature);
    } catch {
      throw new BadRequestException("Invalid Stripe webhook signature");
    }

    await this.webhookService.handleWebhook(event);

    return { received: true };
  }
}
