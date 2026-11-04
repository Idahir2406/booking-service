import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";

import { InternalApiKeyGuard } from "../../shared/guards/internal-api-key.guard";
import { CreateRoomDto } from "../dto/create-room.dto";
import { UpdateRoomDto } from "../dto/update-room.dto";
import { RoomEntity } from "../entities/room.entity";
import { RoomsService } from "../services/rooms.service";

/**
 * PUBLIC: GET by-site/:site_id/public (active rooms for the booking form).
 * Everything else is host/internal (F0).
 */
@Controller({
  path: "rooms",
  version: "1",
})
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  @UseGuards(InternalApiKeyGuard)
  create(@Body() createDto: CreateRoomDto): Promise<RoomEntity> {
    return this.roomsService.create(createDto);
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
  update(
    @Param("id", ParseIntPipe) id: number,
    @Body() updateDto: UpdateRoomDto,
  ): Promise<RoomEntity> {
    return this.roomsService.update(id, updateDto);
  }

  @Delete(":id")
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id", ParseIntPipe) id: number): Promise<void> {
    await this.roomsService.remove(id);
  }
}
