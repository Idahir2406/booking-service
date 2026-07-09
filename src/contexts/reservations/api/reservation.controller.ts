import type { FeedbackSummaryDto } from "../dto/feedback-summary.dto";
import type { ReservationWithRoomName } from "../dto/reservation-with-room.dto";

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";

import { DateRangeQueryDto } from "../../shared/dto/date-range-query.dto";
import { CancelReservationDto } from "../dto/cancel-reservation.dto";
import { CheckoutReservationDto } from "../dto/checkout-reservation.dto";
import { CreateReservationDto } from "../dto/create-reservation.dto";
import { FinalizeReservationDto } from "../dto/finalize-reservation.dto";
import { QuoteReservationDto } from "../dto/quote-reservation.dto";
import { ReservationPublicSummaryDto } from "../dto/reservation-public-summary.dto";
import { SubmitFeedbackDto } from "../dto/submit-feedback.dto";
import { ReservationService } from "../services/reservation.service";
import { ReservationFeedbackService } from "../services/reservation-feedback.service";
import { ReservationLifecycleService } from "../services/reservation-lifecycle.service";

@Controller({
  path: "reservations",
  version: "1",
})
export class ReservationController {
  constructor(
    private readonly reservationService: ReservationService,
    private readonly lifecycleService: ReservationLifecycleService,
    private readonly feedbackService: ReservationFeedbackService,
  ) {}

  @Get("by-site/:site_id/range")
  async findBySiteRange(
    @Param("site_id", ParseIntPipe) site_id: number,
    @Query() range: DateRangeQueryDto,
  ): Promise<ReservationWithRoomName[]> {
    const rows = await this.reservationService.find_active_by_site_and_range(
      site_id,
      range.from,
      range.to,
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- TypeORM query builder
    return rows;
  }

  @Get("feedback/:token")
  getFeedbackSummary(
    @Param("token") token: string,
  ): Promise<FeedbackSummaryDto> {
    return this.feedbackService.getFeedbackSummary(token);
  }

  @Post("feedback/:token")
  submitFeedback(
    @Param("token") token: string,
    @Body() dto: SubmitFeedbackDto,
  ) {
    return this.feedbackService.submitFeedback(token, dto);
  }

  @Post("quote")
  quote(@Body() quote_dto: QuoteReservationDto) {
    return this.reservationService.quoteReservation(quote_dto);
  }

  @Post("checkout")
  checkout(@Body() checkout_dto: CheckoutReservationDto) {
    return this.reservationService.checkout(checkout_dto);
  }

  @Post()
  create(@Body() create_dto: CreateReservationDto) {
    return this.reservationService.create(create_dto);
  }

  @Post(":id/cancel")
  cancelReservation(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: CancelReservationDto,
  ) {
    return this.lifecycleService.cancelReservation(id, dto);
  }

  @Post(":id/finalize")
  finalizeReservation(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: FinalizeReservationDto,
  ) {
    return this.lifecycleService.finalizeReservation(id, dto.site_id);
  }

  @Get(":id")
  getPublicSummary(
    @Param("id", ParseIntPipe) id: number,
  ): Promise<ReservationPublicSummaryDto> {
    return this.reservationService.getPublicSummary(id);
  }

  @Patch(":id")
  confirm(@Param("id", ParseIntPipe) id: number) {
    return this.reservationService.confirm(id);
  }

  @Delete(":id")
  cancel(@Param("id", ParseIntPipe) id: number) {
    return this.reservationService.cancel(id);
  }
}
