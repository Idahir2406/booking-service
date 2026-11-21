import type { ProviderCancelResult } from "../domain/provider-reservation.types";
import type { ProviderCancellationQuoteResponse } from "../services/provider-cancellation.service";
import type {
  ProviderCheckoutResponse,
  ProviderQuoteResponse,
  ProviderRatesResponse,
} from "../services/provider-reservation.service";

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { InternalApiKeyGuard } from "../../shared/guards/internal-api-key.guard";
import {
  ProviderAdminCancelDto,
  ProviderCheckoutDto,
  ProviderQuoteDto,
  ProviderRatesQueryDto,
} from "../dto/provider-reservations.dto";
import { ProviderCancellationService } from "../services/provider-cancellation.service";
import { ProviderReservationService } from "../services/provider-reservation.service";

/**
 * Provider reservations (Nuitee), called by web/php/booking_reservation_api.php
 * with X-Internal-Key. Rates -> quote (prebook + pending reservation) ->
 * checkout (manual-capture Stripe Checkout). The book happens in the Stripe
 * webhook (ProviderBookingService).
 */
@Controller({
  path: "provider-reservations",
  version: "1",
})
@UseGuards(InternalApiKeyGuard)
export class ProviderReservationsController {
  constructor(
    private readonly service: ProviderReservationService,
    private readonly cancellation: ProviderCancellationService,
  ) {}

  @Get("rates")
  rates(@Query() query: ProviderRatesQueryDto): Promise<ProviderRatesResponse> {
    return this.service.getRates(query);
  }

  @Post("quote")
  @HttpCode(200)
  quote(@Body() dto: ProviderQuoteDto): Promise<ProviderQuoteResponse> {
    return this.service.quote(dto);
  }

  @Post("checkout")
  @HttpCode(200)
  checkout(
    @Body() dto: ProviderCheckoutDto,
  ): Promise<ProviderCheckoutResponse> {
    return this.service.checkout(dto);
  }

  /**
   * Phase 5: what cancelling would cost now (penalty on the sell price from
   * the frozen provider policy). No side effects. The traveler panel uses
   * POST /v1/traveler/:user_id/reservations/:id/cancel-preview (same quote).
   */
  @Get(":id/cancellation-quote")
  cancellationQuote(
    @Param("id", ParseIntPipe) id: number,
  ): Promise<ProviderCancellationQuoteResponse> {
    return this.cancellation.quoteForReservation(id);
  }

  /** Backoffice cancellation: provider cancel first, then Stripe refund. */
  @Post(":id/cancel")
  @HttpCode(200)
  cancel(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ProviderAdminCancelDto,
  ): Promise<ProviderCancelResult> {
    return this.cancellation.cancelByAdmin(id, {
      waivePenalty: dto.waive_penalty === true,
      notes: dto.notes ?? null,
      adminId: dto.admin_id ?? null,
    });
  }
}
