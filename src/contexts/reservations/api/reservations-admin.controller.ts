import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from "@nestjs/common";

import { InternalApiKeyGuard } from "../../shared/guards/internal-api-key.guard";
import { ReservationHistoryService } from "../services/reservation-history.service";

/** V4P read routes on a reservation (admino proxy only, X-Internal-Key). */
@Controller({
  path: "admin/reservations",
  version: "1",
})
@UseGuards(InternalApiKeyGuard)
export class ReservationsAdminController {
  constructor(private readonly historyService: ReservationHistoryService) {}

  /** Activity history with notes and admin names. */
  @Get(":id/history")
  history(@Param("id", ParseIntPipe) id: number) {
    return this.historyService.getForAdmin(id);
  }
}
