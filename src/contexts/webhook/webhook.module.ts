import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { ReservationModule } from "../reservations/reservation.module";
import { StripeModule } from "../stripe/stripe.module";
import { WebhookController } from "./api/webhook.controller";
import { StripeWebhookEventEntity } from "./entities/stripe-webhook-event.entity";
import { ExpressAccountsService } from "./services/express-accounts.service";
import { ReservationWebhookService } from "./services/reservation-webhook.service";
import { WebhookService } from "./services/webhook.service";

@Module({
  controllers: [WebhookController],
  providers: [
    ReservationWebhookService,
    WebhookService,
    ExpressAccountsService,
  ],
  exports: [ReservationWebhookService, ExpressAccountsService],
  imports: [
    ReservationModule,
    StripeModule,
    TypeOrmModule.forFeature([StripeWebhookEventEntity]),
  ],
})
export class WebhookModule {}
