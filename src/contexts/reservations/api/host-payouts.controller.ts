import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from "@nestjs/common";

import { InternalApiKeyGuard } from "../../shared/guards/internal-api-key.guard";
import { HostPayoutBlockService } from "../services/host-payout-block.service";

/**
 * Host/internal only (punto 9): reached through web/php/booking_host_api.php
 * (user_id from the PHP session) to show the "reservations paused" notice.
 */
@Controller({
  path: "hosts",
  version: "1",
})
@UseGuards(InternalApiKeyGuard)
export class HostPayoutsController {
  constructor(
    private readonly hostPayoutBlockService: HostPayoutBlockService,
  ) {}

  @Get(":user_id/payout-block")
  getPayoutBlock(@Param("user_id", ParseIntPipe) user_id: number) {
    return this.hostPayoutBlockService.getHostPayoutBlock(user_id);
  }
}
