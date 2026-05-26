import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";

import { BlocksEntity } from "@/contexts/blocks/entities/blocks.entity";

import { DateRangeQueryDto } from "../../shared/dto/date-range-query.dto";
import { CreateBlocksDto } from "../dto/create-blocks.dto";
import { UpdateBlocksDto } from "../dto/update-blocks.dto";
import { BlocksService } from "../services/blocks.service";

@Controller({
  path: "blocks",
  version: "1",
})
export class BlocksController {
  constructor(private readonly blocks_service: BlocksService) {}

  @Post()
  create(@Body() create_dto: CreateBlocksDto) {
    return this.blocks_service.create(create_dto);
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
  find_one(@Param("id", ParseUUIDPipe) id: string) {
    return this.blocks_service.find_one(id);
  }

  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() update_dto: UpdateBlocksDto,
  ) {
    return this.blocks_service.update(id, update_dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.blocks_service.remove(id);
  }
}
