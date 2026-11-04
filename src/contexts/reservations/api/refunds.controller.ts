import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from "@nestjs/common";

import { ReviewRefundDto } from "../../payments/dto/review-refund.dto";
import { InternalApiKeyGuard } from "../../shared/guards/internal-api-key.guard";
import { ReservationRefundService } from "../services/reservation-refund.service";

@Controller({
  path: "refunds",
  version: "1",
})
@UseGuards(InternalApiKeyGuard)
export class RefundsController {
  constructor(private readonly refundService: ReservationRefundService) {}

  @Post(":refund_id/review")
  reviewPendingRefund(
    @Param("refund_id", ParseIntPipe) refundId: number,
    @Body() dto: ReviewRefundDto,
  ) {
    return this.refundService.reviewPendingRefund(refundId, dto);
  }
}
