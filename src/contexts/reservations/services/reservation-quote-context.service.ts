import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { SiteAdditionalServiceEntity } from "../../additional-services/entities/site-additional-service.entity";
import { DogSizeEntity } from "../../dog-sizes/entities/dog-size.entity";
import { SiteDogSupplyEntity } from "../../dog-supplies/entities/site-dog-supply.entity";
import {
  type PricedServiceOption,
  SERVICE_SELECTION_TYPE,
} from "../../payments/domain/reservation-pricing";
import { toCents } from "../../payments/utils/money.util";
import {
  type DogSizeRange,
  normalizeDogSizes,
  type SiteDogLimitSettings,
} from "../../pet-policies/domain/dog-compatibility";
import { UnitPetPolicyEntity } from "../../pet-policies/entities/unit-pet-policy.entity";
import { SiteSettingsEntity } from "../../site-wizard/entities/site-settings.entity";
import { SpeciesEntity } from "../../species/entities/species.entity";

/** V1 = dogs only (C1); same catalog row the wizard uses (step 3). */
export const DOG_SPECIES_NAME = "Perro";

/** Dog data a quote needs for one site/unit (wizard data model). */
export interface QuoteDogContext {
  speciesId: number | null;
  sizes: DogSizeRange[];
  /** Policy of the unit for species "Perro" (zones + zone catalog loaded). */
  policy: UnitPetPolicyEntity | null;
  /** null = legacy site without site_settings row. */
  siteSettings: SiteDogLimitSettings | null;
  /** Paid dog supplies (state yes & is_paid) the traveler can select. */
  dogServices: PricedServiceOption[];
  /** Paid additional services (state yes & is_paid). */
  additionalServices: PricedServiceOption[];
}

function isSellable(row: {
  state: string;
  is_paid: boolean | null;
  price: number | null;
  pricing_mode: string | null;
}): boolean {
  return (
    row.state === "yes" &&
    row.is_paid === true &&
    row.price !== null &&
    toCents(row.price) > 0 &&
    row.pricing_mode !== null
  );
}

/**
 * Read-only loader of the wizard data a quote/checkout needs: dog sizes,
 * unit dog policy (+ zones), site dog limit and paid services. Pure business
 * rules live in pet-policies/domain and payments/domain.
 */
@Injectable()
export class ReservationQuoteContextService {
  private readonly logger = new Logger(ReservationQuoteContextService.name);

  constructor(
    @InjectRepository(SpeciesEntity)
    private readonly speciesRepository: Repository<SpeciesEntity>,
    @InjectRepository(DogSizeEntity)
    private readonly dogSizesRepository: Repository<DogSizeEntity>,
    @InjectRepository(UnitPetPolicyEntity)
    private readonly policiesRepository: Repository<UnitPetPolicyEntity>,
    @InjectRepository(SiteSettingsEntity)
    private readonly siteSettingsRepository: Repository<SiteSettingsEntity>,
    @InjectRepository(SiteDogSupplyEntity)
    private readonly siteDogSuppliesRepository: Repository<SiteDogSupplyEntity>,
    @InjectRepository(SiteAdditionalServiceEntity)
    private readonly siteAdditionalServicesRepository: Repository<SiteAdditionalServiceEntity>,
  ) {}

  async load(siteId: number, roomId: number): Promise<QuoteDogContext> {
    const species = await this.speciesRepository.findOne({
      where: { name: DOG_SPECIES_NAME },
    });
    const speciesId = species?.id ?? null;
    if (speciesId === null) {
      this.logger.warn(
        `species "${DOG_SPECIES_NAME}" not found: dog policies ignored (legacy count only)`,
      );
    }

    const [sizes, policy, settings, dogSupplies, additionalServices] =
      await Promise.all([
        speciesId === null
          ? Promise.resolve([])
          : this.dogSizesRepository.find({
              where: { species_id: speciesId },
              order: { rank: "ASC" },
            }),
        speciesId === null
          ? Promise.resolve(null)
          : this.policiesRepository.findOne({
              where: { room_id: roomId, species_id: speciesId },
              relations: { zones: { zone: true } },
            }),
        this.siteSettingsRepository.findOne({ where: { site_id: siteId } }),
        this.siteDogSuppliesRepository.find({
          where: { site_id: siteId, state: "yes", is_paid: true },
          relations: { supply: true },
        }),
        this.siteAdditionalServicesRepository.find({
          where: { site_id: siteId, state: "yes", is_paid: true },
          relations: { additional_service: true },
        }),
      ]);

    return {
      speciesId,
      sizes: normalizeDogSizes(sizes),
      policy,
      siteSettings: settings
        ? {
            max_pets:
              settings.max_pets === null ? null : Number(settings.max_pets),
            max_pets_unlimited: Boolean(settings.max_pets_unlimited),
          }
        : null,
      dogServices: dogSupplies
        .filter(row => isSellable(row) && row.supply.is_active)
        .sort(
          (a, b) =>
            a.supply.sort_order - b.supply.sort_order ||
            a.supply_id - b.supply_id,
        )
        .map(row => ({
          type: SERVICE_SELECTION_TYPE.DOG_SUPPLY,
          id: row.supply_id,
          name: row.supply.name,
          price_cents: toCents(row.price),
          pricing_mode: row.pricing_mode ?? "per_stay",
        })),
      additionalServices: additionalServices
        .filter(row => isSellable(row) && row.additional_service.is_active)
        .sort(
          (a, b) =>
            a.additional_service.sort_order - b.additional_service.sort_order ||
            a.additional_service_id - b.additional_service_id,
        )
        .map(row => ({
          type: SERVICE_SELECTION_TYPE.ADDITIONAL_SERVICE,
          id: row.additional_service_id,
          name: row.additional_service.name,
          price_cents: toCents(row.price),
          pricing_mode: row.pricing_mode ?? "per_stay",
        })),
    };
  }
}
