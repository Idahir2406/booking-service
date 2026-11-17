import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";

import { SiteAuditService } from "@/contexts/site-history/services/site-audit.service";
import { orUndefined } from "@/contexts/site-history/utils/or-undefined.util";
import { siteActorFromHeaders } from "@/contexts/site-history/utils/site-audit-input.util";
import {
  SITE_AUDIT_ACTION,
  SITE_AUDIT_SOURCE,
  type SiteAuditAction,
} from "@/contexts/site-history/utils/site-change.util";

import { InternalApiKeyGuard } from "../../shared/guards/internal-api-key.guard";
import { CreateRoomDto } from "../dto/create-room.dto";
import { UpdateRoomDto } from "../dto/update-room.dto";
import { RoomEntity } from "../entities/room.entity";
import { RoomsService } from "../services/rooms.service";
import { auditableRoom } from "../utils/room-audit.util";

type RequestHeaders = Record<string, unknown>;

/**
 * PUBLIC: GET by-site/:site_id/public (active rooms for the booking form).
 * Everything else is host/internal (F0).
 */
@Controller({
  path: "rooms",
  version: "1",
})
export class RoomsController {
  constructor(
    private readonly roomsService: RoomsService,
    private readonly siteAuditService: SiteAuditService,
  ) {}

  /** Accommodation history entry (host panel, or admino with x-actor-*). */
  private async audit(
    action: SiteAuditAction,
    headers: RequestHeaders,
    room: RoomEntity,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    let actor;
    try {
      actor = siteActorFromHeaders(headers, room.site_id);
    } catch {
      return;
    }
    await this.siteAuditService.record({
      siteId: room.site_id,
      action,
      actor,
      source: SITE_AUDIT_SOURCE.PANEL,
      before,
      after,
      metadata: { room_id: room.id, room_name: room.name },
      always: action === SITE_AUDIT_ACTION.UNIT_DELETED,
    });
  }

  @Post()
  @UseGuards(InternalApiKeyGuard)
  async create(
    @Body() createDto: CreateRoomDto,
    @Headers() headers: RequestHeaders,
  ): Promise<RoomEntity> {
    const room = await this.roomsService.create(createDto);
    await this.audit(
      SITE_AUDIT_ACTION.UNIT_CREATED,
      headers,
      room,
      {},
      auditableRoom(room),
    );
    return room;
  }

  @Get("by-site/:site_id")
  @UseGuards(InternalApiKeyGuard)
  findBySite(
    @Param("site_id", ParseIntPipe) siteId: number,
  ): Promise<RoomEntity[]> {
    return this.roomsService.findBySite(siteId);
  }

  @Get("by-site/:site_id/public")
  findActiveBySite(
    @Param("site_id", ParseIntPipe) siteId: number,
  ): Promise<RoomEntity[]> {
    return this.roomsService.findActiveBySite(siteId);
  }

  @Patch(":id")
  @UseGuards(InternalApiKeyGuard)
  async update(
    @Param("id", ParseIntPipe) id: number,
    @Body() updateDto: UpdateRoomDto,
    @Headers() headers: RequestHeaders,
  ): Promise<RoomEntity> {
    const before = await orUndefined(this.roomsService.findOne(id));
    const room = await this.roomsService.update(id, updateDto);
    await this.audit(
      SITE_AUDIT_ACTION.UNIT_UPDATED,
      headers,
      room,
      auditableRoom(before),
      auditableRoom(room),
    );
    return room;
  }

  @Delete(":id")
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param("id", ParseIntPipe) id: number,
    @Headers() headers: RequestHeaders,
  ): Promise<void> {
    const before = await orUndefined(this.roomsService.findOne(id));
    const outcome = await this.roomsService.remove(id);
    if (before) {
      await this.audit(
        SITE_AUDIT_ACTION.UNIT_DELETED,
        headers,
        before,
        auditableRoom(before),
        outcome === "deactivated"
          ? { ...auditableRoom(before), is_active: false, soft_deleted: true }
          : {},
      );
    }
  }
}
