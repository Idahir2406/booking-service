import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AvailabilityModule } from "../availability/availability.module";
import { BlocksModule } from "../blocks/blocks.module";
import { MysqlService } from "../shared/services/mysql.service";
import { ReservationController } from "./api/reservation.controller";
import { ReservationEntity } from "./entities/reservation.entity";
import { ReservationService } from "./services/reservation.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([ReservationEntity]),
    AvailabilityModule,
    BlocksModule,
  ],
  controllers: [ReservationController],
  providers: [ReservationService, MysqlService],
  exports: [ReservationService],
})
export class ReservationModule {}
