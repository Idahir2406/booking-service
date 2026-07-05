import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from "@nestjs/common";

import { CreateExpressAccountDto } from "../dto/create-express-account.dto";
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

  @Get("connect-status/:user_id")
  getConnectStatus(@Param("user_id", ParseIntPipe) user_id: number) {
    return this.stripeService.getConnectStatus(user_id);
  }

  @Post("express-account")
  createExpressAccount(@Body() body: CreateExpressAccountDto) {
    return this.stripeService.expressAccount(body);
  }
}
