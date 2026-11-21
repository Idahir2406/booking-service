import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { envs } from "../shared/configs/envs";
import { LegacyDbModule } from "../shared/legacy-db/legacy-db.module";
import { ProviderAdminController } from "./admin/api/provider-admin.controller";
import { ProviderAdminService } from "./admin/services/provider-admin.service";
import { ACCOMMODATION_PROVIDER } from "./domain/accommodation-provider.port";
import { ProviderOfferEntity } from "./entities/provider-offer.entity";
import { ProviderPropertyEntity } from "./entities/provider-property.entity";
import {
  NUITEE_CONFIG,
  NuiteeClient,
  type NuiteeConfig,
} from "./infrastructure/nuitee/nuitee.client";
import { NuiteeProvider } from "./infrastructure/nuitee/nuitee.provider";
import { AccommodationProviderRegistry } from "./services/accommodation-provider.registry";

export function nuiteeConfigFromEnv(): NuiteeConfig {
  const apiKey = envs.NUITEE_API_KEY?.trim() ?? "";
  return {
    apiKey: apiKey === "" ? null : apiKey,
    apiBaseUrl: envs.NUITEE_API_BASE_URL,
    bookBaseUrl: envs.NUITEE_BOOK_BASE_URL,
    paymentMethod: envs.NUITEE_PAYMENT_METHOD,
    guestNationality: envs.NUITEE_GUEST_NATIONALITY.toUpperCase(),
    currency: envs.NUITEE_CURRENCY.toUpperCase(),
    ratesTimeoutMs: envs.NUITEE_RATES_TIMEOUT_MS,
    requestTimeoutMs: envs.NUITEE_REQUEST_TIMEOUT_MS,
  };
}

/**
 * External accommodation providers (phase 1: port, Nuitee adapter, entities;
 * phase 2: admin import/link routes /v1/admin/providers/nuitee/*, admino
 * only). Boots without NUITEE_API_KEY; calls then fail with
 * ProviderNotConfiguredError.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ProviderPropertyEntity, ProviderOfferEntity]),
    LegacyDbModule,
  ],
  controllers: [ProviderAdminController],
  providers: [
    { provide: NUITEE_CONFIG, useFactory: nuiteeConfigFromEnv },
    NuiteeClient,
    NuiteeProvider,
    { provide: ACCOMMODATION_PROVIDER, useExisting: NuiteeProvider },
    AccommodationProviderRegistry,
    ProviderAdminService,
  ],
  exports: [
    ACCOMMODATION_PROVIDER,
    AccommodationProviderRegistry,
    NuiteeProvider,
    TypeOrmModule,
  ],
})
export class ProvidersModule {}
