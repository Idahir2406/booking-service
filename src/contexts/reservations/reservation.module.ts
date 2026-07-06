import { forwardRef, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AvailabilityModule } from "../availability/availability.module";
import { BlocksModule } from "../blocks/blocks.module";
import { RoomsModule } from "../rooms/rooms.module";
import { MysqlService } from "../shared/services/mysql.service";
import { StripeModule } from "../stripe/stripe.module";
import { ReservationController } from "./api/reservation.controller";
import { ReservationDisputeEntity } from "./entities/reservation-dispute.entity";
import { ReservationEventEntity } from "./entities/reservation-event.entity";
import { ReservationFeedbackTokenEntity } from "./entities/reservation-feedback-token.entity";
import { ReservationGuestFeedbackEntity } from "./entities/reservation-guest-feedback.entity";
import { ReservationEntity } from "./entities/reservation.entity";
import { ReservationEmailService } from "./services/reservation-email.service";
import { ReservationEventService } from "./services/reservation-event.service";
import { ReservationFeedbackService } from "./services/reservation-feedback.service";
import { ReservationLifecycleService } from "./services/reservation-lifecycle.service";
import { ReservationPayoutService } from "./services/reservation-payout.service";
import { ReservationService } from "./services/reservation.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReservationEntity,
      ReservationFeedbackTokenEntity,
      ReservationGuestFeedbackEntity,
      ReservationDisputeEntity,
      ReservationEventEntity,
    ]),
    AvailabilityModule,
    BlocksModule,
    RoomsModule,
    forwardRef(() => StripeModule),
  ],
  controllers: [ReservationController],
  providers: [
    ReservationService,
    ReservationEmailService,
    ReservationPayoutService,
    ReservationLifecycleService,
    ReservationFeedbackService,
    ReservationEventService,
    MysqlService,
  ],
  exports: [
    ReservationService,
    ReservationEmailService,
    ReservationPayoutService,
    ReservationLifecycleService,
    ReservationFeedbackService,
  ],
})
export class ReservationModule {}
