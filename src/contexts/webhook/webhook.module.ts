import { Module } from "@nestjs/common";

import { WebhookController } from "./api/webhook.controller";
import { ReservationWebhookService } from "./services/reservation-webhook.service";
import { WebhookService } from "./services/webhook.service";

@Module({
  controllers: [WebhookController],
  providers: [ReservationWebhookService, WebhookService],
  exports: [ReservationWebhookService],
})
export class WebhookModule {}
