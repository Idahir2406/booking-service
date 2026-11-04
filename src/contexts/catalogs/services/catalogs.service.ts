import type {
  AdditionalServiceOption,
  CatalogOption,
  CodeLabelOption,
  CommonZoneOption,
  DogSizeOption,
  DogSupplyOption,
  FeatureGroupOption,
  GeneratedField,
  SiteFormCatalog,
  SiteUnitOption,
  TipsiteOption,
  TipspecExtraOption,
} from "../types/site-form-catalog.types";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { LegacyDbService } from "@/shared/legacy-db/legacy-db.service";
import {
  JTABLES_DBTABLE_SITES1,
  LEGACY_CUSTOMER,
  LEGACY_TABLE,
  legacyTableSql,
  type SupportedLang,
} from "@/shared/legacy-db/legacy-tables";
import { SiteFeatureGroupsService } from "@/shared/legacy-db/site-feature-groups.service";

import { AdditionalServiceEntity } from "@/contexts/additional-services/entities/additional-service.entity";
import { CommonZoneEntity } from "@/contexts/common-zones/entities/common-zone.entity";
import { DogSizeEntity } from "@/contexts/dog-sizes/entities/dog-size.entity";
import { DogSupplyEntity } from "@/contexts/dog-supplies/entities/dog-supply.entity";
import {
  deposit_return_values,
  type DepositReturnValue,
  left_alone_values,
  type LeftAloneValue,
  supplement_mode_values,
  type SupplementModeValue,
} from "@/contexts/pet-policies/entities/unit-pet-policy.entity";
import {
  board_type_values,
  type BoardTypeValue,
} from "@/contexts/rooms/entities/room-board-option.entity";
import {
  extra_pricing_mode_values,
  type ExtraPricingModeValue,
} from "@/contexts/rooms/entities/room-extra.entity";
import {
  service_pricing_mode_values,
  type ServicePricingModeValue,
} from "@/contexts/shared/types/service-pricing-mode";
import { SiteUnitEntity } from "@/contexts/site-unit/entities/site-unit.entity";
import { TIPSPEC_EXTRA_IDS } from "@/contexts/site-wizard/utils/site-services.utils";
import { SpeciesEntity } from "@/contexts/species/entities/species.entity";

import { stripHtml } from "../utils/strip-html.util";
import { buildTipsiteTree, type TipsiteRow } from "../utils/tipsite-tree.util";

interface RawOptionRow {
  id: number;
  name: string | null;
}

interface RawTipsiteRow extends RawOptionRow {
  id_parent: number;
}

interface RawTipspecRow {
  id: number;
  label: string | null;
  description: string | null;
}

interface RawGeneratedFieldRow {
  id: number;
  namesql: string | null;
  name: string | null;
  label: string | null;
  description: string | null;
  type: string | null;
  validation_type: string | null;
  required: string | null;
}

const ACTIVE = "S";
/** Step 3 only configures dogs (species catalog row "Perro"). */
const DOG_SPECIES_NAME = "Perro";

/**
 * Board regime names. Its price is a SUPPLEMENT charged per night per unit
 * (not per guest): quote = price_per_night * nights + board.price * nights,
 * or 0 when is_included (RoomBoardOptionsService.calculateBoardAmount).
 */
const BOARD_CODE_LABELS: Record<BoardTypeValue, string> = {
  room_only: "Solo alojamiento",
  breakfast_included: "Desayuno",
  half_board: "Media pensión",
  full_board: "Pensión completa",
  all_inclusive: "Todo incluido",
};

const EXTRA_PRICING_MODE_LABELS: Record<ExtraPricingModeValue, string> = {
  per_night: "Por noche",
  per_night_per_guest: "Por noche y huésped",
  per_stay: "Por estancia",
};

const BOARD_CODES: readonly CodeLabelOption[] = board_type_values.map(code => ({
  code,
  label: BOARD_CODE_LABELS[code],
}));

const EXTRA_PRICING_MODES: readonly CodeLabelOption[] =
  extra_pricing_mode_values.map(code => ({
    code,
    label: EXTRA_PRICING_MODE_LABELS[code],
  }));

const SUPPLEMENT_MODE_LABELS: Record<SupplementModeValue, string> = {
  none: "No, gratis",
  per_pet_night: "Por perro y noche",
  per_pet_stay: "Por perro y estancia",
  fixed_stay: "Fijo por estancia",
};

const LEFT_ALONE_LABELS: Record<LeftAloneValue, string> = {
  yes: "Sí",
  no: "No",
  conditional: "Con condiciones",
};

const DEPOSIT_RETURN_LABELS: Record<DepositReturnValue, string> = {
  end_of_stay: "Al finalizar la estancia",
  days: "En un máximo de N días tras la salida",
};

const SERVICE_PRICING_MODE_LABELS: Record<ServicePricingModeValue, string> = {
  per_stay: "Por estancia",
  per_night: "Por noche",
  per_pet_night: "Por perro y noche",
  per_pet_stay: "Por perro y estancia",
};

const SERVICE_PRICING_MODES: readonly CodeLabelOption[] =
  service_pricing_mode_values.map(code => ({
    code,
    label: SERVICE_PRICING_MODE_LABELS[code],
  }));

const SUPPLEMENT_MODES: readonly CodeLabelOption[] = supplement_mode_values.map(
  code => ({ code, label: SUPPLEMENT_MODE_LABELS[code] }),
);

const LEFT_ALONE_OPTIONS: readonly CodeLabelOption[] = left_alone_values.map(
  code => ({ code, label: LEFT_ALONE_LABELS[code] }),
);

const DEPOSIT_RETURN_OPTIONS: readonly CodeLabelOption[] =
  deposit_return_values.map(code => ({
    code,
    label: DEPOSIT_RETURN_LABELS[code],
  }));

function clean(value: string | null): string {
  return (value ?? "").trim();
}

function toOptions(rows: readonly RawOptionRow[]): CatalogOption[] {
  return rows.map(row => ({ id: Number(row.id), name: clean(row.name) }));
}

@Injectable()
export class CatalogsService {
  constructor(
    private readonly legacyDb: LegacyDbService,
    @InjectRepository(SiteUnitEntity)
    private readonly siteUnitsRepository: Repository<SiteUnitEntity>,
    @InjectRepository(SpeciesEntity)
    private readonly speciesRepository: Repository<SpeciesEntity>,
    @InjectRepository(DogSizeEntity)
    private readonly dogSizesRepository: Repository<DogSizeEntity>,
    @InjectRepository(CommonZoneEntity)
    private readonly commonZonesRepository: Repository<CommonZoneEntity>,
    @InjectRepository(DogSupplyEntity)
    private readonly dogSuppliesRepository: Repository<DogSupplyEntity>,
    @InjectRepository(AdditionalServiceEntity)
    private readonly additionalServicesRepository: Repository<AdditionalServiceEntity>,
    private readonly siteFeatureGroups: SiteFeatureGroupsService,
  ) {}

  async getSiteFormCatalog(lang: SupportedLang): Promise<SiteFormCatalog> {
    const [
      tipsite,
      tipo_de_alquiler,
      tipenv,
      tipdest,
      generated_fields,
      site_units,
      dog_sizes,
      common_zones,
      dog_supplies,
      additional_services,
      feature_groups,
      tipserv,
      tipspec_extra,
    ] = await Promise.all([
      this.getTipsite(lang),
      this.getTipoDeAlquiler(lang),
      this.getTipenv(lang),
      this.getTipdest(lang),
      this.getGeneratedFields(lang),
      this.getSiteUnits(),
      this.getDogSizes(),
      this.getCommonZones(),
      this.getDogSupplies(),
      this.getAdditionalServices(),
      this.getFeatureGroups(lang),
      this.getTipserv(lang),
      this.getTipspecExtra(lang),
    ]);

    return {
      tipsite,
      tipo_de_alquiler,
      tipenv,
      tipdest,
      generated_fields,
      site_units,
      board_codes: [...BOARD_CODES],
      extra_pricing_modes: [...EXTRA_PRICING_MODES],
      dog_sizes,
      common_zones,
      supplement_modes: [...SUPPLEMENT_MODES],
      left_alone_options: [...LEFT_ALONE_OPTIONS],
      deposit_return_options: [...DEPOSIT_RETURN_OPTIONS],
      dog_supplies,
      additional_services,
      service_pricing_modes: [...SERVICE_PRICING_MODES],
      feature_groups,
      tipserv,
      tipspec_extra,
    };
  }

  private async findDogSpeciesId(): Promise<number | null> {
    const species = await this.speciesRepository.findOne({
      where: { name: DOG_SPECIES_NAME },
    });
    return species?.id ?? null;
  }

  // dog_supplies / additional_services have no translations yet: names in es
  private async getDogSupplies(): Promise<DogSupplyOption[]> {
    const speciesId = await this.findDogSpeciesId();
    if (speciesId === null) {
      return [];
    }
    const rows = await this.dogSuppliesRepository.find({
      where: { species_id: speciesId, is_active: true },
      order: { sort_order: "ASC", id: "ASC" },
    });
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      section: row.section,
      sort_order: row.sort_order,
    }));
  }

  private async getAdditionalServices(): Promise<AdditionalServiceOption[]> {
    const speciesId = await this.findDogSpeciesId();
    if (speciesId === null) {
      return [];
    }
    const rows = await this.additionalServicesRepository.find({
      where: { species_id: speciesId, is_active: true },
      order: { sort_order: "ASC", id: "ASC" },
    });
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      sort_order: row.sort_order,
    }));
  }

  /** Step-4 multioption groups of jsites1 (whitelist ∩ jtables), empty ones omitted. */
  private async getFeatureGroups(
    lang: SupportedLang,
  ): Promise<FeatureGroupOption[]> {
    const groups = await this.siteFeatureGroups.load(lang);
    return groups
      .filter(group => group.options.length > 0)
      .map(group => ({
        namesql: group.namesql,
        label: group.label,
        block: group.block,
        multiple: true,
        options: group.options,
      }));
  }

  private async getTipserv(lang: SupportedLang): Promise<CatalogOption[]> {
    const rows = await this.legacyDb.query<RawOptionRow>(
      `SELECT id, label_l1 AS name
       FROM ${legacyTableSql(LEGACY_TABLE.TIPSERV)}
       WHERE customer = ? AND active = ?
       ORDER BY sequence, id`,
      [LEGACY_CUSTOMER, ACTIVE],
    );
    return this.legacyDb.translateRows(
      LEGACY_TABLE.TIPSERV,
      lang,
      toOptions(rows),
      "label_l1",
    );
  }

  private async getTipspecExtra(
    lang: SupportedLang,
  ): Promise<TipspecExtraOption[]> {
    const [rows, labels, descriptions] = await Promise.all([
      this.legacyDb.query<RawTipspecRow>(
        `SELECT id, label_l1 AS label, name_l1 AS description
         FROM ${legacyTableSql(LEGACY_TABLE.TIPSPEC)}
         WHERE customer = ? AND active = ? AND id IN (?)
         ORDER BY sequence, id`,
        [LEGACY_CUSTOMER, ACTIVE, TIPSPEC_EXTRA_IDS],
      ),
      this.legacyDb.getTranslations(LEGACY_TABLE.TIPSPEC, lang, "label_l1"),
      this.legacyDb.getTranslations(LEGACY_TABLE.TIPSPEC, lang, "name_l1"),
    ]);
    return rows.map(row => {
      const id = String(row.id);
      return {
        id: Number(row.id),
        label: labels.get(id) ?? clean(row.label),
        description: stripHtml(descriptions.get(id) ?? row.description),
      };
    });
  }

  /** Dog sizes ordered by rank (cumulative: a policy stores the max rank). */
  private async getDogSizes(): Promise<DogSizeOption[]> {
    const species = await this.speciesRepository.findOne({
      where: { name: DOG_SPECIES_NAME },
    });
    if (!species) {
      return [];
    }
    const rows = await this.dogSizesRepository.find({
      where: { species_id: species.id },
      order: { rank: "ASC", id: "ASC" },
    });
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      rank: Number(row.rank),
      min_kg: Number(row.min_kg),
      max_kg: row.max_kg === null ? null : Number(row.max_kg),
    }));
  }

  private async getCommonZones(): Promise<CommonZoneOption[]> {
    const rows = await this.commonZonesRepository.find({
      where: { is_active: true },
      order: { sort_order: "ASC", id: "ASC" },
    });
    return rows.map(row => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      is_dining_capable: row.is_dining_capable,
      requires_text: row.requires_text,
      sort_order: row.sort_order,
    }));
  }

  /** Active unit types of every tipsite; the frontend filters by main tipsite. */
  private async getSiteUnits(): Promise<SiteUnitOption[]> {
    const rows = await this.siteUnitsRepository.find({
      where: { is_active: true },
      order: { tipsite_id: "ASC", sort_order: "ASC", id: "ASC" },
    });
    return rows.map(row => ({
      id: row.id,
      tipsite_id: row.tipsite_id,
      name: row.name,
      slug: row.slug,
      is_full_use: row.is_full_use,
      sort_order: row.sort_order,
    }));
  }

  private async getTipsite(lang: SupportedLang): Promise<TipsiteOption[]> {
    const rows = await this.legacyDb.query<RawTipsiteRow>(
      `SELECT id, id_parent, name_l1 AS name
       FROM ${legacyTableSql(LEGACY_TABLE.TIPSITE)}
       WHERE customer = ? AND active = ?
       ORDER BY sequence, id`,
      [LEGACY_CUSTOMER, ACTIVE],
    );
    const normalized: TipsiteRow[] = rows.map(row => ({
      id: Number(row.id),
      id_parent: Number(row.id_parent),
      name: clean(row.name),
    }));
    const translated = await this.legacyDb.translateRows(
      LEGACY_TABLE.TIPSITE,
      lang,
      normalized,
    );
    return buildTipsiteTree(translated);
  }

  // No `active` column in jtipo_de_alquiler / jtipenv
  private async getTipoDeAlquiler(
    lang: SupportedLang,
  ): Promise<CatalogOption[]> {
    const rows = await this.legacyDb.query<RawOptionRow>(
      `SELECT id, name_l1 AS name
       FROM ${legacyTableSql(LEGACY_TABLE.TIPO_DE_ALQUILER)}
       WHERE customer = ?
       ORDER BY id`,
      [LEGACY_CUSTOMER],
    );
    return this.legacyDb.translateRows(
      LEGACY_TABLE.TIPO_DE_ALQUILER,
      lang,
      toOptions(rows),
    );
  }

  private async getTipenv(lang: SupportedLang): Promise<CatalogOption[]> {
    const rows = await this.legacyDb.query<RawOptionRow>(
      `SELECT id, name_l1 AS name
       FROM ${legacyTableSql(LEGACY_TABLE.TIPENV)}
       WHERE customer = ?
       ORDER BY name_l1, id`,
      [LEGACY_CUSTOMER],
    );
    return this.legacyDb.translateRows(
      LEGACY_TABLE.TIPENV,
      lang,
      toOptions(rows),
    );
  }

  private async getTipdest(lang: SupportedLang): Promise<CatalogOption[]> {
    const rows = await this.legacyDb.query<RawOptionRow>(
      `SELECT id, name_l1 AS name
       FROM ${legacyTableSql(LEGACY_TABLE.TIPDEST)}
       WHERE customer = ? AND active = ?
       ORDER BY sequence, id`,
      [LEGACY_CUSTOMER, ACTIVE],
    );
    return this.legacyDb.translateRows(
      LEGACY_TABLE.TIPDEST,
      lang,
      toOptions(rows),
    );
  }

  private async getGeneratedFields(
    lang: SupportedLang,
  ): Promise<GeneratedField[]> {
    const [rows, labels, descriptions] = await Promise.all([
      this.legacyDb.query<RawGeneratedFieldRow>(
        `SELECT id, namesql, name, label, description, type, validation_type, required
         FROM ${legacyTableSql(LEGACY_TABLE.TABLES)}
         WHERE customer = ? AND dbtable = ? AND is_generated = 1
           AND type IN ('text', 'number')
         ORDER BY sequence, id`,
        [LEGACY_CUSTOMER, JTABLES_DBTABLE_SITES1],
      ),
      this.legacyDb.getTranslations(LEGACY_TABLE.TABLES, lang, "label"),
      this.legacyDb.getTranslations(LEGACY_TABLE.TABLES, lang, "description"),
    ]);

    return rows.map(row => {
      const id = String(row.id);
      const validationType = clean(row.validation_type);
      return {
        namesql: clean(row.namesql),
        label: labels.get(id) ?? (clean(row.label) || clean(row.name)),
        description: descriptions.get(id) ?? clean(row.description),
        type: clean(row.type),
        validation_type: validationType === "" ? null : validationType,
        // jtables.required is free text; only the literal "required" means it
        required: clean(row.required).toLowerCase() === "required",
      };
    });
  }
}
