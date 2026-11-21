import type { ProviderHotel } from "../../providers/domain/provider.types";

import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";

import { ProviderNotFoundError } from "../../providers/domain/provider.errors";
import {
  PROVIDER_PROPERTY_STATUS,
  ProviderPropertyEntity,
} from "../../providers/entities/provider-property.entity";
import { AccommodationProviderRegistry } from "../../providers/services/accommodation-provider.registry";
import { ProviderNotifierService } from "./provider-notifier.service";

export interface HotelSyncSummary {
  synced: number;
  paused: number;
  errors: number;
  changes: string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Same shape the booking emails read (petsAllowed + petPolicy). */
export function petsSnapshotOf(hotel: ProviderHotel): Record<string, unknown> {
  return { petsAllowed: hotel.petsAllowed, petPolicy: hotel.petPolicy };
}

/**
 * Weekly refresh of linked provider hotels (active/paused): pets snapshot,
 * content snapshot and last_synced_at. A hotel that no longer accepts pets
 * (petsAllowed === false) or that the provider removed (404) is paused; only
 * provider_properties.status changes (the rates endpoint already requires an
 * active link), never v4p_jsites1. V4P gets one digest email per run.
 */
@Injectable()
export class ProviderHotelSyncService {
  private readonly logger = new Logger(ProviderHotelSyncService.name);

  constructor(
    @InjectRepository(ProviderPropertyEntity)
    private readonly propertyRepository: Repository<ProviderPropertyEntity>,
    private readonly registry: AccommodationProviderRegistry,
    private readonly notifier: ProviderNotifierService,
  ) {}

  async run(now: Date = new Date()): Promise<HotelSyncSummary> {
    const summary: HotelSyncSummary = {
      synced: 0,
      paused: 0,
      errors: 0,
      changes: [],
    };
    const properties = await this.propertyRepository.find({
      where: {
        status: In([
          PROVIDER_PROPERTY_STATUS.ACTIVE,
          PROVIDER_PROPERTY_STATUS.PAUSED,
        ]),
      },
      order: { id: "ASC" },
    });
    for (const property of properties) {
      try {
        await this.syncOne(property, now, summary);
      } catch (error) {
        summary.errors += 1;
        this.logger.error(
          `Hotel sync failed for ${property.provider}:${property.provider_hotel_id} (site ${property.site_id}): ${errorMessage(error)}`,
        );
      }
    }
    if (summary.errors > 0) {
      summary.changes.push(
        `${summary.errors} hoteles no se pudieron sincronizar (error del proveedor); se reintentará la próxima semana.`,
      );
    }
    await this.notifier.sendAdminDigest(
      "Sincronización semanal de hoteles de proveedor",
      summary.changes,
    );
    this.logger.log(
      `Provider hotel sync: ${summary.synced} synced, ${summary.paused} paused, ${summary.errors} errors`,
    );
    return summary;
  }

  private async syncOne(
    property: ProviderPropertyEntity,
    now: Date,
    summary: HotelSyncSummary,
  ): Promise<void> {
    const label = `Ficha ${property.site_id} (${property.provider} ${property.provider_hotel_id})`;
    let hotel: ProviderHotel;
    try {
      hotel = await this.registry
        .get(property.provider)
        .getHotel(property.provider_hotel_id);
    } catch (error) {
      if (!(error instanceof ProviderNotFoundError)) {
        throw error;
      }
      const patch: Partial<ProviderPropertyEntity> = { last_synced_at: now };
      if (property.status === PROVIDER_PROPERTY_STATUS.ACTIVE) {
        patch.status = PROVIDER_PROPERTY_STATUS.PAUSED;
        summary.paused += 1;
        summary.changes.push(
          `${label}: el proveedor ya no publica el hotel (404). Pausada.`,
        );
      }
      await this.propertyRepository.update(property.id, patch);
      return;
    }

    const patch: Partial<ProviderPropertyEntity> = {
      pets_snapshot: petsSnapshotOf(hotel),
      content_snapshot: hotel,
      last_synced_at: now,
    };
    const previousPets = (property.pets_snapshot ?? null) as {
      petsAllowed?: unknown;
    } | null;
    if (hotel.petsAllowed === false) {
      if (property.status === PROVIDER_PROPERTY_STATUS.ACTIVE) {
        patch.status = PROVIDER_PROPERTY_STATUS.PAUSED;
        summary.paused += 1;
        summary.changes.push(
          `${label} "${hotel.name}": ya no admite mascotas según el proveedor. Pausada.`,
        );
      }
    } else if (
      property.status === PROVIDER_PROPERTY_STATUS.PAUSED &&
      hotel.petsAllowed === true &&
      previousPets?.petsAllowed === false
    ) {
      // Never re-activated automatically: V4P decides.
      summary.changes.push(
        `${label} "${hotel.name}": vuelve a admitir mascotas; sigue pausada hasta que la revises.`,
      );
    }
    await this.propertyRepository.update(property.id, patch);
    summary.synced += 1;
  }
}
