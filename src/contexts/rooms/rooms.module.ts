import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { RoomsController } from "./api/rooms.controller";
import { RoomBoardOptionEntity } from "./entities/room-board-option.entity";
import { RoomExtraEntity } from "./entities/room-extra.entity";
import { RoomEntity } from "./entities/room.entity";
import { RoomBoardOptionsService } from "./services/room-board-options.service";
import { RoomExtrasService } from "./services/room-extras.service";
import { RoomsService } from "./services/rooms.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RoomEntity,
      RoomBoardOptionEntity,
      RoomExtraEntity,
    ]),
  ],
  controllers: [RoomsController],
  providers: [RoomsService, RoomBoardOptionsService, RoomExtrasService],
  exports: [RoomsService, RoomBoardOptionsService, RoomExtrasService],
})
export class RoomsModule {}
