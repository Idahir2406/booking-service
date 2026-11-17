import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { TypeOrmModule } from "@nestjs/typeorm";

import { HealthModule } from "@/app/health/health.module";

import { LoggerModule } from "@/shared/logger/logger.module";

import { AdditionalServicesModule } from "@/contexts/additional-services/additional-services.module";
import { AvailabilityModule } from "@/contexts/availability/availability.module";
import { BlocksModule } from "@/contexts/blocks/blocks.module";
import { CatalogsModule } from "@/contexts/catalogs/catalogs.module";
import { ClosestServicesModule } from "@/contexts/closest-services/closest-services.module";
import { CommonZonesModule } from "@/contexts/common-zones/common-zones.module";
import { DogSizesModule } from "@/contexts/dog-sizes/dog-sizes.module";
import { DogSuppliesModule } from "@/contexts/dog-supplies/dog-supplies.module";
import { FaqModule } from "@/contexts/faq/faq.module";
import { GeographyModule } from "@/contexts/geography/geography.module";
import { MailModule } from "@/contexts/mail/mail.module";
import { PaymentsModule } from "@/contexts/payments/payments.module";
import { PetPoliciesModule } from "@/contexts/pet-policies/pet-policies.module";
import { ReservationModule } from "@/contexts/reservations/reservation.module";
import { RoomsModule } from "@/contexts/rooms/rooms.module";
import { envs } from "@/contexts/shared/configs/envs";
import { SiteHistoryModule } from "@/contexts/site-history/site-history.module";
import { SiteUnitModule } from "@/contexts/site-unit/site-unit.module";
import { SiteWizardModule } from "@/contexts/site-wizard/site-wizard.module";
import { SpeciesModule } from "@/contexts/species/species.module";
import { TravelerDogsModule } from "@/contexts/traveler-dogs/traveler-dogs.module";

import { StripeModule } from "../contexts/stripe/stripe.module";
import { WebhookModule } from "../contexts/webhook/webhook.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot({
      type: "mysql",
      host: envs.DB_HOST,
      port: envs.DB_PORT,
      username: envs.DB_USERNAME,
      password: envs.DB_PASSWORD,
      database: envs.DB_DATABASE,
      autoLoadEntities: true,
      synchronize: false,
    }),
    BullModule.forRoot({
      connection: {
        host: envs.REDIS_HOST,
        port: envs.REDIS_PORT,
      },
    }),
    MailModule,
    LoggerModule,
    HealthModule,
    StripeModule,
    PaymentsModule,
    AvailabilityModule,
    BlocksModule,
    ReservationModule,
    // Panel del viajero F-PV5: "Mis perros" (internal, X-Internal-Key)
    TravelerDogsModule,
    RoomsModule,
    WebhookModule,
    // Entity-only modules (dog module): register entities for autoLoadEntities
    SpeciesModule,
    DogSizesModule,
    DogSuppliesModule,
    AdditionalServicesModule,
    ClosestServicesModule,
    FaqModule,
    CommonZonesModule,
    PetPoliciesModule,
    SiteUnitModule,
    // Accommodation onboarding wizard (internal, X-Internal-Key)
    CatalogsModule,
    GeographyModule,
    SiteWizardModule,
    SiteHistoryModule,
  ],
})
export class AppModule {}
