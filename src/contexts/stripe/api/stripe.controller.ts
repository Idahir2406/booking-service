import { Body, Controller, Post } from "@nestjs/common";

import { CreateSitePaymentIntentDto } from "../dto/create-site-payment-intent.dto";
import { StripeService } from "../services/stripe.service";

@Controller({
  path: "stripe",
  version: "1",
})
export class StripeController {
  constructor(private readonly stripeService: StripeService) {}

  @Post("site-payment-link")
  createSitePaymentLink(@Body() body: CreateSitePaymentIntentDto) {
    return this.stripeService.createSitePaymentLink(body);
  }

  @Post("express-account")
  createExpressAccount() {
    return this.stripeService.expressAccount();
  }
}
