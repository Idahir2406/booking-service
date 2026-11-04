import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { PaymentsModule } from "../payments/payments.module";
import { ReservationEntity } from "../reservations/entities/reservation.entity";
import { ReservationModule } from "../reservations/reservation.module";
import { StripeModule } from "../stripe/stripe.module";
import { WebhookController } from "./api/webhook.controller";
import { StripeWebhookEventEntity } from "./entities/stripe-webhook-event.entity";
import { ExpressAccountsService } from "./services/express-accounts.service";
import { HostPayoutWebhookService } from "./services/host-payout-webhook.service";
import { ReservationWebhookService } from "./services/reservation-webhook.service";
import { WebhookService } from "./services/webhook.service";

@Module({
  controllers: [WebhookController],
  providers: [
    ReservationWebhookService,
    WebhookService,
    ExpressAccountsService,
    HostPayoutWebhookService,
  ],
  exports: [ReservationWebhookService, ExpressAccountsService],
  imports: [
    ReservationModule,
    StripeModule,
    PaymentsModule,
    TypeOrmModule.forFeature([StripeWebhookEventEntity, ReservationEntity]),
  ],
})
export class WebhookModule {}
