import { forwardRef, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AvailabilityModule } from "../availability/availability.module";
import { BlocksModule } from "../blocks/blocks.module";
import { RoomsModule } from "../rooms/rooms.module";
import { MysqlService } from "../shared/services/mysql.service";
import { StripeModule } from "../stripe/stripe.module";
import { ReservationController } from "./api/reservation.controller";
import { ReservationEntity } from "./entities/reservation.entity";
import { ReservationService } from "./services/reservation.service";
import { ReservationEmailService } from "./services/reservation-email.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([ReservationEntity]),
    AvailabilityModule,
    BlocksModule,
    RoomsModule,
    forwardRef(() => StripeModule),
  ],
  controllers: [ReservationController],
  providers: [ReservationService, ReservationEmailService, MysqlService],
  exports: [ReservationService, ReservationEmailService],
})
export class ReservationModule {}
