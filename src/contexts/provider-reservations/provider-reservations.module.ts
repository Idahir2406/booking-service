import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { MailModule } from "../mail/mail.module";
import { PaymentsModule } from "../payments/payments.module";
import { ProvidersModule } from "../providers/providers.module";
import { ReservationEntity } from "../reservations/entities/reservation.entity";
import { ReservationIncidentEntity } from "../reservations/entities/reservation-incident.entity";
import { ReservationModule } from "../reservations/reservation.module";
import { MysqlService } from "../shared/services/mysql.service";
import { StripeModule } from "../stripe/stripe.module";
import { ProviderReservationsController } from "./api/provider-reservations.controller";
import { ProviderWebhookController } from "./api/provider-webhook.controller";
import { ProviderWebhookEventEntity } from "./entities/provider-webhook-event.entity";
import { ProviderAlternativesService } from "./services/provider-alternatives.service";
import { ProviderBookingService } from "./services/provider-booking.service";
import { ProviderCancellationService } from "./services/provider-cancellation.service";
import { ProviderCronsService } from "./services/provider-crons.service";
import { ProviderHotelSyncService } from "./services/provider-hotel-sync.service";
import { ProviderIncidentService } from "./services/provider-incident.service";
import { ProviderNotifierService } from "./services/provider-notifier.service";
import { ProviderReconciliationService } from "./services/provider-reconciliation.service";
import { ProviderReservationService } from "./services/provider-reservation.service";
import { ProviderWebhookService } from "./services/provider-webhook.service";

/**
 * Provider reservations: live rates, quote/prebook, manual capture checkout
 * and the book after the Stripe authorization (phases 3-4); cancellation,
 * Nuitee webhook, reconciliation and hotel sync crons (phase 5).
 * ProviderBookingService is exported for the Stripe webhook.
 * ProviderCancellationService registers itself in ReservationModule's
 * ProviderCancellationBridge (traveler cancel/preview of source = nuitee).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReservationEntity,
      ReservationIncidentEntity,
      ProviderWebhookEventEntity,
    ]),
    ProvidersModule,
    PaymentsModule,
    StripeModule,
    ReservationModule,
    MailModule,
  ],
  controllers: [ProviderReservationsController, ProviderWebhookController],
  providers: [
    ProviderReservationService,
    ProviderBookingService,
    ProviderAlternativesService,
    ProviderNotifierService,
    ProviderIncidentService,
    ProviderCancellationService,
    ProviderWebhookService,
    ProviderReconciliationService,
    ProviderHotelSyncService,
    ProviderCronsService,
    MysqlService,
  ],
  exports: [ProviderBookingService, ProviderCancellationService],
})
export class ProviderReservationsModule {}
