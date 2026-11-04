import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { InternalApiKeyGuard } from "../../shared/guards/internal-api-key.guard";
import {
  CreateAlternativeDto,
  CreateChangeProposalDto,
  ListChangeRequestsQueryDto,
  UpdateChangeRequestStatusDto,
} from "../dto/reservation-change.dto";
import { ReservationAlternativeService } from "../services/reservation-alternative.service";
import { ReservationChangeService } from "../services/reservation-change.service";

/**
 * F-PV7b, V4P side (D9, same pattern as POST /v1/incidents/:id/status): no
 * backoffice UI, X-Internal-Key only. Prices always come from the checkout
 * quote engine; `.../quote` is a dry run that stores nothing.
 */
@Controller({
  path: "reservation-changes",
  version: "1",
})
@UseGuards(InternalApiKeyGuard)
export class ReservationChangesAdminController {
  constructor(private readonly changeService: ReservationChangeService) {}

  /** Queue: open requests (default) or the last 100 of any status. */
  @Get()
  list(@Query() query: ListChangeRequestsQueryDto) {
    return this.changeService.listForAdmin((query.scope ?? "open") === "open");
  }

  @Get(":request_id")
  get(@Param("request_id", ParseIntPipe) requestId: number) {
    return this.changeService.getForAdmin(requestId);
  }

  @Post(":request_id/status")
  @HttpCode(HttpStatus.OK)
  setStatus(
    @Param("request_id", ParseIntPipe) requestId: number,
    @Body() dto: UpdateChangeRequestStatusDto,
  ) {
    return this.changeService.setRequestStatus(requestId, dto);
  }

  @Post(":request_id/quote")
  @HttpCode(HttpStatus.OK)
  quote(
    @Param("request_id", ParseIntPipe) requestId: number,
    @Body() dto: CreateChangeProposalDto,
  ) {
    return this.changeService.quoteProposal(requestId, dto);
  }

  @Post(":request_id/proposals")
  createProposal(
    @Param("request_id", ParseIntPipe) requestId: number,
    @Body() dto: CreateChangeProposalDto,
  ) {
    return this.changeService.createProposal(requestId, dto);
  }
}

/**
 * F-PV7b (PDF §10), V4P side: accommodation alternatives. Own prefix so the
 * public `GET reservations/:id` is never touched.
 */
@Controller({
  path: "reservation-alternatives",
  version: "1",
})
@UseGuards(InternalApiKeyGuard)
export class ReservationAlternativesAdminController {
  constructor(
    private readonly alternativeService: ReservationAlternativeService,
  ) {}

  @Post(":reservation_id/quote")
  @HttpCode(HttpStatus.OK)
  quote(
    @Param("reservation_id", ParseIntPipe) reservationId: number,
    @Body() dto: CreateAlternativeDto,
  ) {
    return this.alternativeService.quote(reservationId, dto);
  }

  @Post(":reservation_id")
  create(
    @Param("reservation_id", ParseIntPipe) reservationId: number,
    @Body() dto: CreateAlternativeDto,
  ) {
    return this.alternativeService.create(reservationId, dto);
  }
}
