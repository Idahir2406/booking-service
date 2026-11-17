import { forwardRef, Module } from "@nestjs/common";

import { SiteHistoryModule } from "@/contexts/site-history/site-history.module";

import { ReservationModule } from "../reservations/reservation.module";
import { MysqlService } from "../shared/services/mysql.service";
import { StripeController } from "./api/stripe.controller";
import { StripeService } from "./services/stripe.service";
import { UserProfilesService } from "./services/user-profiles.service";

@Module({
  controllers: [StripeController],
  providers: [StripeService, UserProfilesService, MysqlService],
  exports: [StripeService, UserProfilesService],
  imports: [forwardRef(() => ReservationModule), SiteHistoryModule],
})
export class StripeModule {}
