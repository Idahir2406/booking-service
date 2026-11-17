import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { InternalApiKeyGuard } from "../../shared/guards/internal-api-key.guard";
import { ResolveHostCannotHostDto } from "../dto/host-cannot-host.dto";
import { ListIncidentsQueryDto } from "../dto/incident-admin.dto";
import { ResolveNoShowDto } from "../dto/no-show.dto";
import {
  AddIncidentMessageDto,
  UpdateIncidentStatusDto,
} from "../dto/reservation-incident.dto";
import { ReservationHostCannotHostService } from "../services/reservation-host-cannot-host.service";
import { ReservationIncidentService } from "../services/reservation-incident.service";
import { ReservationIncidentAdminService } from "../services/reservation-incident-admin.service";
import { ReservationNoShowService } from "../services/reservation-no-show.service";
import {
  type IncidentAdminActor,
  InvalidAdminActorError,
  parseAdminActorHeaders,
} from "../utils/incident-admin.util";

function actorFrom(
  headers: Record<string, unknown>,
): IncidentAdminActor | null {
  try {
    return parseAdminActorHeaders(headers);
  } catch (error) {
    if (error instanceof InvalidAdminActorError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}

/**
 * F-PV7a, V4P side (D9 pattern, like POST /v1/refunds/:id/review), called
 * with X-Internal-Key only. Backoffice fase 1: the admino proxy
 * (web/admino/php/admOps_api.php) is the only caller; it adds the reads below
 * and the optional x-actor-id / x-actor-name headers on mutations. The
 * economic resolution of a held payout still goes through the refunds review
 * route or release_hold.
 */
@Controller({
  path: "incidents",
  version: "1",
})
@UseGuards(InternalApiKeyGuard)
export class IncidentsAdminController {
  constructor(
    private readonly incidentService: ReservationIncidentService,
    private readonly adminService: ReservationIncidentAdminService,
    private readonly noShowService: ReservationNoShowService,
    private readonly hostCannotHostService: ReservationHostCannotHostService,
  ) {}

  /** Inbox: filters + pagination + counters per status. */
  @Get()
  list(@Query() query: ListIncidentsQueryDto) {
    return this.adminService.list(query);
  }

  /** Full detail (timeline, attachments metadata, reservation, transitions). */
  @Get(":incident_id")
  get(@Param("incident_id", ParseIntPipe) incidentId: number) {
    return this.adminService.getDetail(incidentId);
  }

  /** For the admino proxy only: storage key after the incident check. */
  @Get(":incident_id/attachments/:attachment_id")
  getAttachment(
    @Param("incident_id", ParseIntPipe) incidentId: number,
    @Param("attachment_id", ParseIntPipe) attachmentId: number,
  ) {
    return this.adminService.getAttachmentFile(incidentId, attachmentId);
  }

  @Post(":incident_id/status")
  @HttpCode(HttpStatus.OK)
  updateStatus(
    @Param("incident_id", ParseIntPipe) incidentId: number,
    @Body() dto: UpdateIncidentStatusDto,
    @Headers() headers: Record<string, unknown>,
  ) {
    return this.incidentService.updateStatus(
      incidentId,
      dto,
      new Date(),
      actorFrom(headers),
    );
  }

  /** Punto 6: V4P confirms (refund per no-show policy + release rest) or rejects a host no-show. */
  @Post(":incident_id/no-show/resolve")
  @HttpCode(HttpStatus.OK)
  resolveNoShow(
    @Param("incident_id", ParseIntPipe) incidentId: number,
    @Body() dto: ResolveNoShowDto,
    @Headers() headers: Record<string, unknown>,
  ) {
    return this.noShowService.resolveByAdmin(
      incidentId,
      dto.decision,
      dto.note,
      actorFrom(headers),
    );
  }

  /**
   * "Imposibilidad de alojar": V4P approves (cancel + 100 % refund to the
   * traveler, responsible host) or rejects (stay goes on, payout unblocked).
   */
  @Post(":incident_id/host-cannot-host/resolve")
  @HttpCode(HttpStatus.OK)
  resolveHostCannotHost(
    @Param("incident_id", ParseIntPipe) incidentId: number,
    @Body() dto: ResolveHostCannotHostDto,
    @Headers() headers: Record<string, unknown>,
  ) {
    return this.hostCannotHostService.resolveByAdmin(
      incidentId,
      dto.decision,
      dto.note,
      actorFrom(headers),
    );
  }

  @Post(":incident_id/messages")
  addMessage(
    @Param("incident_id", ParseIntPipe) incidentId: number,
    @Body() dto: AddIncidentMessageDto,
    @Headers() headers: Record<string, unknown>,
  ) {
    return this.incidentService.addAdminMessage(
      incidentId,
      dto,
      actorFrom(headers),
    );
  }
}
