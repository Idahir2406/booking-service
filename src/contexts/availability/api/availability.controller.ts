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
  Query,
  UseGuards,
} from "@nestjs/common";

import { AvailabilityEntity } from "@/contexts/availability/entities/availability.entity";
import { SiteAuditService } from "@/contexts/site-history/services/site-audit.service";
import { orUndefined } from "@/contexts/site-history/utils/or-undefined.util";
import { siteActorFromHeaders } from "@/contexts/site-history/utils/site-audit-input.util";
import {
  SITE_AUDIT_ACTION,
  SITE_AUDIT_SOURCE,
  type SiteAuditAction,
} from "@/contexts/site-history/utils/site-change.util";

import { DateRangeQueryDto } from "../../shared/dto/date-range-query.dto";
import { InternalApiKeyGuard } from "../../shared/guards/internal-api-key.guard";
import { CreateAvailabilityDto } from "../dto/create-availability.dto";
import { UpdateAvailabilityDto } from "../dto/update-availability.dto";
import { AvailabilityService } from "../services/availability.service";

function auditableAvailability(value: AvailabilityEntity | undefined) {
  if (!value) {
    return;
  }
  return {
    is_available: value.is_available,
    min_nights: value.min_nights,
    max_nights: value.max_nights,
  };
}

/**
 * Host/internal only (F0). Travelers read occupancy through the public
 * GET /v1/reservations/public/rooms/:room_id/calendar (no guest data).
 */
@Controller({
  path: "availability",
  version: "1",
})
@UseGuards(InternalApiKeyGuard)
export class AvailabilityController {
  constructor(
    private readonly availability_service: AvailabilityService,
    private readonly siteAuditService: SiteAuditService,
  ) {}

  /** Accommodation history entry (host panel, or admino with x-actor-*). */
  private async audit(
    action: SiteAuditAction,
    headers: Record<string, unknown>,
    siteId: number,
    before: unknown,
    after: unknown,
    metadata: Record<string, unknown>,
    always = false,
  ): Promise<void> {
    let actor;
    try {
      actor = siteActorFromHeaders(headers, siteId);
    } catch {
      return;
    }
    await this.siteAuditService.record({
      siteId,
      action,
      actor,
      source: SITE_AUDIT_SOURCE.PANEL,
      before,
      after,
      metadata,
      always,
    });
  }

  @Post()
  async create(
    @Body() create_dto: CreateAvailabilityDto,
    @Headers() headers: Record<string, unknown>,
  ) {
    const result = await this.availability_service.create(create_dto);
    // One entry per request (a range of days), never one per night.
    await this.audit(
      SITE_AUDIT_ACTION.AVAILABILITY_CHANGED,
      headers,
      create_dto.site_id,
      {},
      {
        from: create_dto.anchor_date ?? null,
        days: create_dto.day,
        is_available: create_dto.is_available ?? true,
        min_nights: create_dto.min_nights,
        max_nights: create_dto.max_nights,
      },
      { room_id: create_dto.room_id },
      true,
    );
    return result;
  }

  @Get()
  findAll() {
    return this.availability_service.findAll();
  }

  /** Calendario agregado: todas las habitaciones del site. */
  @Get("by-site/:site_id/range")
  async findBySiteAndRange(
    @Param("site_id", ParseIntPipe) site_id: number,
    @Query() range: DateRangeQueryDto,
  ): Promise<AvailabilityEntity[]> {
    const rows = await this.availability_service.findBySiteAndIsoRange(
      site_id,
      range.from,
      range.to,
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- TypeORM Repository
    return rows;
  }

  /** Calendario por habitación. */
  @Get("by-room/:room_id/range")
  async findByRoomAndRange(
    @Param("room_id", ParseIntPipe) room_id: number,
    @Query() range: DateRangeQueryDto,
  ): Promise<AvailabilityEntity[]> {
    const rows = await this.availability_service.findByRoomAndIsoRange(
      room_id,
      range.from,
      range.to,
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- TypeORM Repository
    return rows;
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.availability_service.findOne(id);
  }

  @Patch(":id")
  async update(
    @Param("id", ParseIntPipe) id: number,
    @Body() update_dto: UpdateAvailabilityDto,
    @Headers() headers: Record<string, unknown>,
  ) {
    const before = await orUndefined(this.availability_service.findOne(id));
    const row = await this.availability_service.update(id, update_dto);
    await this.audit(
      SITE_AUDIT_ACTION.AVAILABILITY_CHANGED,
      headers,
      row.site_id,
      auditableAvailability(before),
      auditableAvailability(row),
      { room_id: row.room_id, date: String(row.date) },
    );
    return row;
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id", ParseIntPipe) id: number) {
    await this.availability_service.remove(id);
  }
}
