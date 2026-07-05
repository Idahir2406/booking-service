import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { BlocksEntity } from "@/contexts/blocks/entities/blocks.entity";
import { RoomsModule } from "@/contexts/rooms/rooms.module";

import { BlocksController } from "./api/blocks.controller";
import { BlocksService } from "./services/blocks.service";

@Module({
  imports: [TypeOrmModule.forFeature([BlocksEntity]), RoomsModule],
  controllers: [BlocksController],
  providers: [BlocksService],
  exports: [BlocksService],
})
export class BlocksModule {}
