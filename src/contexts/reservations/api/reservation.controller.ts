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
import { CheckoutReservationDto } from "../dto/checkout-reservation.dto";
import { CreateReservationDto } from "../dto/create-reservation.dto";
import { QuoteReservationDto } from "../dto/quote-reservation.dto";
import { ReservationPublicSummaryDto } from "../dto/reservation-public-summary.dto";
import { ReservationEntity } from "../entities/reservation.entity";
import { ReservationService } from "../services/reservation.service";

@Controller({
  path: "reservations",
  version: "1",
})
export class ReservationController {
  constructor(private readonly reservationService: ReservationService) {}

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
