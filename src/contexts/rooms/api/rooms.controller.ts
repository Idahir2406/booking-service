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
} from "@nestjs/common";

import { CreateRoomDto } from "../dto/create-room.dto";
import { UpdateRoomDto } from "../dto/update-room.dto";
import { RoomEntity } from "../entities/room.entity";
import { RoomsService } from "../services/rooms.service";

@Controller({
  path: "rooms",
  version: "1",
})
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  create(@Body() createDto: CreateRoomDto): Promise<RoomEntity> {
    return this.roomsService.create(createDto);
  }

  @Get("by-site/:site_id")
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
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateRoomDto,
  ): Promise<RoomEntity> {
    return this.roomsService.update(id, updateDto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.roomsService.remove(id);
  }
}
