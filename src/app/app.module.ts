import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { TypeOrmModule } from "@nestjs/typeorm";

import { HealthModule } from "@/app/health/health.module";

import { LoggerModule } from "@/shared/logger/logger.module";

import { AvailabilityModule } from "@/contexts/availability/availability.module";
import { BlocksModule } from "@/contexts/blocks/blocks.module";
import { ReservationModule } from "@/contexts/reservations/reservation.module";
import { envs } from "@/contexts/shared/configs/envs";

import { StripeModule } from "../contexts/stripe/stripe.module";
import { WebhookModule } from "../contexts/webhook/webhook.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot({
      type: "postgres",
      url: envs.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: false,
    }),
    LoggerModule,
    HealthModule,
    StripeModule,
    AvailabilityModule,
    BlocksModule,
    ReservationModule,
    WebhookModule,
  ],
})
export class AppModule {}
