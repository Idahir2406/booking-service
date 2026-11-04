import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { InternalApiKeyGuard } from "../../shared/guards/internal-api-key.guard";
import { CreateDashboardLinkDto } from "../dto/create-dashboard-link.dto";
import { CreateExpressAccountDto } from "../dto/create-express-account.dto";
import { CreateSitePaymentIntentDto } from "../dto/create-site-payment-intent.dto";
import { StripeService } from "../services/stripe.service";

/**
 * Host/internal only (F0): reached through the PHP proxy
 * web/php/booking_host_api.php (user_id/site_id from the PHP session) or
 * server-side PHP (inc/booking_checkout_lib.php) with X-Internal-Key.
 */
@Controller({
  path: "stripe",
  version: "1",
})
@UseGuards(InternalApiKeyGuard)
export class StripeController {
  constructor(private readonly stripeService: StripeService) {}

  @Post("site-payment-link")
  createSitePaymentLink(@Body() body: CreateSitePaymentIntentDto) {
    return this.stripeService.createSitePaymentLink(body);
  }

  @Get("connect-status/:user_id")
  getConnectStatus(
    @Param("user_id", ParseIntPipe) user_id: number,
    // string on purpose: the global ValidationPipe (implicit conversion)
    // turns an absent numeric query param into NaN before any ParseIntPipe.
    @Query("site_id") site_id?: string,
  ) {
    if (site_id === undefined || site_id === "") {
      return this.stripeService.getConnectStatus(user_id);
    }
    if (!/^[1-9]\d{0,9}$/.test(site_id)) {
      throw new BadRequestException("site_id must be a positive integer");
    }
    return this.stripeService.getConnectStatus(user_id, Number(site_id));
  }

  @Post("express-account")
  createExpressAccount(@Body() body: CreateExpressAccountDto) {
    return this.stripeService.expressAccount(body);
  }

  @Post("dashboard-link")
  createDashboardLink(@Body() body: CreateDashboardLinkDto) {
    return this.stripeService.createDashboardLoginLink(body);
  }
}
