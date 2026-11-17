import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { BlocksEntity } from "@/contexts/blocks/entities/blocks.entity";
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
import { CreateBlocksDto } from "../dto/create-blocks.dto";
import { UpdateBlocksDto } from "../dto/update-blocks.dto";
import { BlocksService } from "../services/blocks.service";

interface BlockLike {
  room_id?: number | null;
  start_date?: unknown;
  end_date?: unknown;
  type?: unknown;
}

function day(value: unknown): unknown {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function auditableBlock(block: BlockLike | null | undefined) {
  if (!block) {
    return;
  }
  return {
    room_id: block.room_id ?? null,
    start_date: day(block.start_date),
    end_date: day(block.end_date),
    type: block.type,
  };
}

/** Host/internal only (F0): reached via web/php/booking_host_api.php. */
@Controller({
  path: "blocks",
  version: "1",
})
@UseGuards(InternalApiKeyGuard)
export class BlocksController {
  constructor(
    private readonly blocks_service: BlocksService,
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
    @Body() create_dto: CreateBlocksDto,
    @Headers() headers: Record<string, unknown>,
  ) {
    const block = await this.blocks_service.create(create_dto);
    await this.audit(
      SITE_AUDIT_ACTION.BLOCK_CREATED,
      headers,
      create_dto.site_id,
      {},
      auditableBlock(create_dto),
      { room_id: create_dto.room_id },
    );
    return block;
  }

  @Get()
  find_all() {
    return this.blocks_service.find_all();
  }

  /** Calendario: bloques que solapan el rango (fechas inclusives). */
  @Get("by-site/:site_id/range")
  async find_by_site_range(
    @Param("site_id", ParseIntPipe) site_id: number,
    @Query() range: DateRangeQueryDto,
  ): Promise<BlocksEntity[]> {
    const rows = await this.blocks_service.find_by_site_and_range(
      site_id,
      range.from,
      range.to,
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- TypeORM query builder
    return rows;
  }

  /** Calendario por habitación. */
  @Get("by-room/:room_id/range")
  async find_by_room_range(
    @Param("room_id", ParseIntPipe) room_id: number,
    @Query() range: DateRangeQueryDto,
  ): Promise<BlocksEntity[]> {
    const rows = await this.blocks_service.find_by_room_and_range(
      room_id,
      range.from,
      range.to,
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- TypeORM query builder
    return rows;
  }

  /** Listado del host: todos los bloqueos del site, o solo vigentes (`end_date` desde hoy, ISO servidor). */
  @Get("by-site/:site_id")
  find_by_site(
    @Param("site_id", ParseIntPipe) site_id: number,
    @Query("only_future", new DefaultValuePipe(false), ParseBoolPipe)
    only_future: boolean,
  ): Promise<BlocksEntity[]> {
    return this.blocks_service.find_by_site(site_id, {
      only_future,
    });
  }

  @Get(":id")
  find_one(@Param("id", ParseIntPipe) id: number) {
    return this.blocks_service.find_one(id);
  }

  @Patch(":id")
  async update(
    @Param("id", ParseIntPipe) id: number,
    @Body() update_dto: UpdateBlocksDto,
    @Headers() headers: Record<string, unknown>,
  ) {
    const before = await orUndefined(this.blocks_service.find_one(id));
    const block = await this.blocks_service.update(id, update_dto);
    await this.audit(
      SITE_AUDIT_ACTION.BLOCK_UPDATED,
      headers,
      block.site_id,
      auditableBlock(before),
      auditableBlock(block),
      { room_id: block.room_id, block_id: id },
    );
    return block;
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param("id", ParseIntPipe) id: number,
    @Headers() headers: Record<string, unknown>,
  ) {
    const before = await orUndefined(this.blocks_service.find_one(id));
    await this.blocks_service.remove(id);
    if (before) {
      await this.audit(
        SITE_AUDIT_ACTION.BLOCK_DELETED,
        headers,
        before.site_id,
        auditableBlock(before),
        {},
        { room_id: before.room_id, block_id: id },
        true,
      );
    }
  }
}
