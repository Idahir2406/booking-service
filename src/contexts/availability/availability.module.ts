import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AvailabilityEntity } from "@/contexts/availability/entities/availability.entity";
import { RoomsModule } from "@/contexts/rooms/rooms.module";

import { MysqlService } from "../shared/services/mysql.service";
import { AvailabilityController } from "./api/availability.controller";
import { AvailabilityService } from "./services/availability.service";

@Module({
  imports: [TypeOrmModule.forFeature([AvailabilityEntity]), RoomsModule],
  controllers: [AvailabilityController],
  providers: [AvailabilityService, MysqlService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
