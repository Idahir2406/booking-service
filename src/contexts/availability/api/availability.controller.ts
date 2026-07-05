import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";

import { AvailabilityEntity } from "@/contexts/availability/entities/availability.entity";

import { DateRangeQueryDto } from "../../shared/dto/date-range-query.dto";
import { CreateAvailabilityDto } from "../dto/create-availability.dto";
import { UpdateAvailabilityDto } from "../dto/update-availability.dto";
import { AvailabilityService } from "../services/availability.service";

@Controller({
  path: "availability",
  version: "1",
})
export class AvailabilityController {
  constructor(private readonly availability_service: AvailabilityService) {}

  @Post()
  create(@Body() create_dto: CreateAvailabilityDto) {
    return this.availability_service.create(create_dto);
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
    @Param("room_id", ParseUUIDPipe) room_id: string,
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
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.availability_service.findOne(id);
  }

  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() update_dto: UpdateAvailabilityDto,
  ) {
    return this.availability_service.update(id, update_dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.availability_service.remove(id);
  }
}
