import type { FeedbackSummaryDto } from "../dto/feedback-summary.dto";
import type { PublicRoomCalendarDto } from "../dto/public-room-calendar.dto";
import type { ReservationWithRoomName } from "../dto/reservation-with-room.dto";

import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { DateRangeQueryDto } from "../../shared/dto/date-range-query.dto";
import { InternalApiKeyGuard } from "../../shared/guards/internal-api-key.guard";
import { CancelReservationDto } from "../dto/cancel-reservation.dto";
import { CheckoutReservationDto } from "../dto/checkout-reservation.dto";
import { CreateReservationDto } from "../dto/create-reservation.dto";
import { ExceptionalRefundRequestDto } from "../dto/exceptional-refund-request.dto";
import { FinalizeReservationDto } from "../dto/finalize-reservation.dto";
import { ReportNoShowDto } from "../dto/no-show.dto";
import { QuoteReservationDto } from "../dto/quote-reservation.dto";
import { ReservationPublicSummaryDto } from "../dto/reservation-public-summary.dto";
import { SubmitFeedbackDto } from "../dto/submit-feedback.dto";
import { TravelerCancelReservationDto } from "../dto/traveler-cancel-reservation.dto";
import {
  ReservationService,
  toPublicQuote,
} from "../services/reservation.service";
import { ReservationFeedbackService } from "../services/reservation-feedback.service";
import { ReservationLifecycleService } from "../services/reservation-lifecycle.service";
import { ReservationNoShowService } from "../services/reservation-no-show.service";
import { ReservationRefundService } from "../services/reservation-refund.service";

/**
 * Route classification (F0):
 * PUBLIC (traveler, browser): feedback/:token (GET/POST), quote, checkout,
 *   public/rooms/:room_id/calendar, GET :id (requires ?session_id).
 * INTERNAL (X-Internal-Key, via web/php/booking_host_api.php): everything else.
 * PATCH /:id (confirm without payment) and DELETE /:id were removed.
 */
@Controller({
  path: "reservations",
  version: "1",
})
export class ReservationController {
  constructor(
    private readonly reservationService: ReservationService,
    private readonly lifecycleService: ReservationLifecycleService,
    private readonly refundService: ReservationRefundService,
    private readonly feedbackService: ReservationFeedbackService,
    private readonly noShowService: ReservationNoShowService,
  ) {}

  @Get("by-site/:site_id/range")
  @UseGuards(InternalApiKeyGuard)
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

  @Get("public/rooms/:room_id/calendar")
  getPublicRoomCalendar(
    @Param("room_id", ParseIntPipe) room_id: number,
    @Query() range: DateRangeQueryDto,
  ): Promise<PublicRoomCalendarDto> {
    return this.reservationService.getPublicRoomCalendar(
      room_id,
      range.from,
      range.to,
    );
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
  async quote(@Body() quote_dto: QuoteReservationDto) {
    // F2: same pricing as checkout; internal checkout data is stripped.
    return toPublicQuote(
      await this.reservationService.quoteReservation(quote_dto),
    );
  }

  @Post("checkout")
  checkout(@Body() checkout_dto: CheckoutReservationDto) {
    return this.reservationService.checkout(checkout_dto);
  }

  @Post()
  @UseGuards(InternalApiKeyGuard)
  create(@Body() create_dto: CreateReservationDto) {
    return this.reservationService.create(create_dto);
  }

  @Post(":id/cancel")
  @UseGuards(InternalApiKeyGuard)
  cancelReservation(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: CancelReservationDto,
  ) {
    return this.lifecycleService.cancelReservation(id, dto);
  }

  @Post(":id/cancel-traveler")
  @UseGuards(InternalApiKeyGuard)
  cancelByTraveler(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: TravelerCancelReservationDto,
  ) {
    return this.refundService.cancelByTraveler(id, dto);
  }

  @Post(":id/exceptional-refund")
  @UseGuards(InternalApiKeyGuard)
  requestExceptionalRefund(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ExceptionalRefundRequestDto,
  ) {
    return this.refundService.requestExceptionalRefund(id, dto);
  }

  @Post(":id/finalize")
  @UseGuards(InternalApiKeyGuard)
  finalizeReservation(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: FinalizeReservationDto,
  ) {
    return this.lifecycleService.finalizeReservation(id, dto.site_id);
  }

  /** Punto 6: host reports "No se presentó" (payout of this reservation blocked, V4P reviews). */
  @Post(":id/no-show")
  @UseGuards(InternalApiKeyGuard)
  reportNoShow(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ReportNoShowDto,
  ) {
    return this.noShowService.reportByHost(id, dto.site_id, dto.note);
  }

  @Get(":id")
  getPublicSummary(
    @Param("id", ParseIntPipe) id: number,
    @Query("session_id") sessionId?: string,
  ): Promise<ReservationPublicSummaryDto> {
    return this.reservationService.getPublicSummary(
      id,
      typeof sessionId === "string" ? sessionId : undefined,
    );
  }
}
