import type {
  SiteWizardState,
  WizardServiceAnswer,
  WizardServicesPayload,
  WizardServicesUpdate,
} from "../types/site-wizard.types";
import type { SlugAnswer } from "../utils/site-services.utils";

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";

import { LegacyDbService } from "@/shared/legacy-db/legacy-db.service";
import {
  BASE_LANG,
  LEGACY_CUSTOMER,
  LEGACY_TABLE,
  legacyTableSql,
} from "@/shared/legacy-db/legacy-tables";
import {
  type LoadedSiteFeatureGroup,
  SiteFeatureGroupsService,
} from "@/shared/legacy-db/site-feature-groups.service";
import { parseCsvIds } from "@/shared/transformers/csv-ids.transformer";

import { AdditionalServiceEntity } from "@/contexts/additional-services/entities/additional-service.entity";
import { SiteAdditionalServiceEntity } from "@/contexts/additional-services/entities/site-additional-service.entity";
import { DogSupplyEntity } from "@/contexts/dog-supplies/entities/dog-supply.entity";
import { SiteDogSupplyEntity } from "@/contexts/dog-supplies/entities/site-dog-supply.entity";
import { SpeciesEntity } from "@/contexts/species/entities/species.entity";

import { SiteSettingsEntity } from "../entities/site-settings.entity";
import {
  cribsFromRow,
  parseCribsInput,
  type SiteCribs,
  syncFamiliarCrib,
} from "../utils/site-cribs.utils";
import { normalizeCsvIds } from "../utils/site-property.utils";
import {
  deriveServicesTipspec,
  featureIdsFrom,
  parseServicesInput,
  SERVICE_TIPSPEC,
  serviceRowFor,
  SUPPLY_TIPSPEC,
  TIPSPEC_EXTRA_IDS,
  tipspecExtraFrom,
} from "../utils/site-services.utils";
import { SiteWizardService } from "./site-wizard.service";

/** Step reached once "Servicios" (step 4) has been confirmed. */
const STEP_AFTER_SERVICES = 5;
/** Step 4 only configures dogs (species catalog row "Perro"). */
const DOG_SPECIES_NAME = "Perro";
const ACTIVE = "S";

type RawSiteRow = Record<string, string | number | null>;

interface IdRow {
  id: number;
}

interface ServicesCatalog {
  supplies: DogSupplyEntity[];
  services: AdditionalServiceEntity[];
  groups: LoadedSiteFeatureGroup[];
  tipservIds: Set<number>;
  tipspecExtraIds: Set<number>;
}

interface StoredAnswer {
  state: WizardServiceAnswer["state"];
  is_paid: boolean | null;
  price: number | string | null;
  pricing_mode: WizardServiceAnswer["pricing_mode"];
}

function toAnswer(
  row: StoredAnswer | undefined,
): WizardServiceAnswer | undefined {
  if (!row) {
    return undefined;
  }
  return {
    state: row.state,
    is_paid: row.is_paid,
    price: row.price === null ? null : Number(row.price),
    pricing_mode: row.pricing_mode,
  };
}

function csvOrNull(value: string | number | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** `ubicación_y_entorno` -> quoted identifier (namesql only from the whitelist). */
function columnSql(namesql: string): string {
  return `\`${namesql.replaceAll("`", "")}\``;
}

/**
 * Wizard step 4 ("Servicios"), optional: dog supplies + additional services
 * (new tables, with price/pricing mode when paid), generated multioption
 * feature columns of v4p_jsites1, nearby services (tipserv) and the manual +
 * derived tipspec ids. Feature column names only come from
 * SITE_FEATURE_GROUPS confirmed by v4p_jtables (SiteFeatureGroupsService).
 */
@Injectable()
export class SiteServicesWizardService {
  constructor(
    private readonly legacyDb: LegacyDbService,
    private readonly featureGroups: SiteFeatureGroupsService,
    private readonly siteWizardService: SiteWizardService,
    @InjectRepository(SiteSettingsEntity)
    private readonly siteSettingsRepository: Repository<SiteSettingsEntity>,
    @InjectRepository(SpeciesEntity)
    private readonly speciesRepository: Repository<SpeciesEntity>,
    @InjectRepository(DogSupplyEntity)
    private readonly suppliesRepository: Repository<DogSupplyEntity>,
    @InjectRepository(AdditionalServiceEntity)
    private readonly servicesRepository: Repository<AdditionalServiceEntity>,
    @InjectRepository(SiteDogSupplyEntity)
    private readonly siteSuppliesRepository: Repository<SiteDogSupplyEntity>,
    @InjectRepository(SiteAdditionalServiceEntity)
    private readonly siteServicesRepository: Repository<SiteAdditionalServiceEntity>,
  ) {}

  async get(siteId: number): Promise<WizardServicesPayload> {
    await this.assertSiteExists(siteId);
    return this.buildPayload(siteId, await this.loadCatalog());
  }

  async update(siteId: number, body: unknown): Promise<WizardServicesPayload> {
    await this.assertSiteExists(siteId);
    const catalog = await this.loadCatalog();
    const parsed = parseServicesInput(body, {
      supplyIds: new Set(catalog.supplies.map(row => row.id)),
      serviceIds: new Set(catalog.services.map(row => row.id)),
      featureOptions: new Map(
        catalog.groups.map(group => [group.namesql, group.aliases]),
      ),
      tipservIds: catalog.tipservIds,
      tipspecExtraIds: catalog.tipspecExtraIds,
    });
    const parsedCribs = parseCribsInput(body);
    if (!parsed.ok || !parsedCribs.ok) {
      throw new BadRequestException([
        ...(parsed.ok ? [] : parsed.errors),
        ...(parsedCribs.ok ? [] : parsedCribs.errors),
      ]);
    }
    const input = parsed.value;
    const cribs = parsedCribs.value;

    await this.legacyDb.transaction(async manager => {
      const site = await this.legacyDb.queryOne<RawSiteRow>(
        `SELECT id, tipspec FROM ${legacyTableSql(LEGACY_TABLE.SITES1)}
         WHERE id = ? AND customer = ? FOR UPDATE`,
        [siteId, LEGACY_CUSTOMER],
        manager,
      );
      if (!site) {
        throw new NotFoundException(`site ${siteId} not found`);
      }

      await this.saveAnswers(manager, siteId, input);
      await this.writeLegacySite(
        manager,
        siteId,
        input,
        csvOrNull(site.tipspec),
        catalog,
      );
      if (cribs !== undefined) {
        await this.saveCribs(manager, siteId, cribs);
      }
    });

    return this.buildPayload(siteId, catalog);
  }

  /** Step 4 is optional: nothing is required to move on. */
  async confirm(siteId: number): Promise<SiteWizardState> {
    await this.assertSiteExists(siteId);
    const table = this.siteSettingsRepository.metadata.tableName;
    await this.siteSettingsRepository.manager.query(
      `INSERT INTO \`${table}\` (site_id, wizard_step)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         wizard_step = GREATEST(wizard_step, VALUES(wizard_step))`,
      [siteId, STEP_AFTER_SERVICES],
    );
    return this.siteWizardService.getState(siteId);
  }

  private async saveAnswers(
    manager: EntityManager,
    siteId: number,
    input: WizardServicesUpdate,
  ): Promise<void> {
    const upsert = async (
      table: string,
      idColumn: string,
      rows: readonly (WizardServiceAnswer & { id: number })[],
    ) => {
      if (rows.length === 0) {
        return;
      }
      await manager.query(
        `INSERT INTO \`${table}\`
           (site_id, \`${idColumn}\`, state, is_paid, price, pricing_mode)
         VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?)").join(", ")}
         ON DUPLICATE KEY UPDATE
           state = VALUES(state),
           is_paid = VALUES(is_paid),
           price = VALUES(price),
           pricing_mode = VALUES(pricing_mode)`,
        rows.flatMap(row => [
          siteId,
          row.id,
          row.state,
          row.is_paid === null ? null : Number(row.is_paid),
          row.price,
          row.pricing_mode,
        ]),
      );
    };

    await upsert(
      this.siteSuppliesRepository.metadata.tableName,
      "supply_id",
      (input.dog_supplies ?? []).map(({ supply_id, ...answer }) => ({
        id: supply_id,
        ...answer,
      })),
    );
    await upsert(
      this.siteServicesRepository.metadata.tableName,
      "additional_service_id",
      (input.additional_services ?? []).map(({ service_id, ...answer }) => ({
        id: service_id,
        ...answer,
      })),
    );
  }

  private async writeLegacySite(
    manager: EntityManager,
    siteId: number,
    input: WizardServicesUpdate,
    currentTipspec: string | null,
    catalog: ServicesCatalog,
  ): Promise<void> {
    const assignments: string[] = [];
    const params: string[] = [];

    for (const group of catalog.groups) {
      const ids = input.features?.[group.namesql];
      if (ids !== undefined) {
        assignments.push(`${columnSql(group.namesql)} = ?`);
        params.push(normalizeCsvIds(ids));
      }
    }
    if (input.tipserv !== undefined) {
      assignments.push("`tipserv` = ?");
      params.push(normalizeCsvIds(input.tipserv));
    }

    const touchesTipspec =
      input.tipspec_extra !== undefined ||
      input.dog_supplies !== undefined ||
      input.additional_services !== undefined;
    if (touchesTipspec) {
      const supplySlug = new Map(
        catalog.supplies.map(row => [row.id, row.slug]),
      );
      const serviceSlug = new Map(
        catalog.services.map(row => [row.id, row.slug]),
      );
      const supplies: SlugAnswer[] = (input.dog_supplies ?? []).map(row => ({
        slug: supplySlug.get(row.supply_id) ?? "",
        state: row.state,
      }));
      const services: SlugAnswer[] = (input.additional_services ?? []).map(
        row => ({
          slug: serviceSlug.get(row.service_id) ?? "",
          state: row.state,
        }),
      );
      assignments.push("`tipspec` = ?");
      params.push(
        deriveServicesTipspec(currentTipspec, {
          tipspecExtra: input.tipspec_extra ?? null,
          supplies,
          services,
        }),
      );
    }

    if (assignments.length === 0) {
      return;
    }
    await this.legacyDb.query(
      `UPDATE ${legacyTableSql(LEGACY_TABLE.SITES1)}
       SET ${assignments.join(", ")}
       WHERE id = ? AND customer = ?`,
      [...params, siteId, LEGACY_CUSTOMER],
      manager,
    );
  }

  /**
   * site_settings.cribs_* + legacy "Cuna" option in jsites1.familiar (so the
   * public page / filters keep showing it). Runs after writeLegacySite, so it
   * wins over a `features.familiar` sent in the same request.
   */
  private async saveCribs(
    manager: EntityManager,
    siteId: number,
    cribs: SiteCribs,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO site_settings
         (site_id, cribs_offered, cribs_count, cribs_is_paid, cribs_price, cribs_pricing_mode, cribs_note)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         cribs_offered = VALUES(cribs_offered),
         cribs_count = VALUES(cribs_count),
         cribs_is_paid = VALUES(cribs_is_paid),
         cribs_price = VALUES(cribs_price),
         cribs_pricing_mode = VALUES(cribs_pricing_mode),
         cribs_note = VALUES(cribs_note)`,
      [
        siteId,
        cribs.offered ? 1 : 0,
        cribs.count,
        cribs.is_paid ? 1 : 0,
        cribs.price,
        cribs.pricing_mode,
        cribs.note,
      ],
    );
    const row = await this.legacyDb.queryOne<{ familiar: string | null }>(
      `SELECT familiar FROM ${legacyTableSql(LEGACY_TABLE.SITES1)}
       WHERE id = ? AND customer = ?`,
      [siteId, LEGACY_CUSTOMER],
      manager,
    );
    if (row) {
      await manager.query(
        `UPDATE ${legacyTableSql(LEGACY_TABLE.SITES1)}
         SET familiar = ? WHERE id = ? AND customer = ?`,
        [
          syncFamiliarCrib(row.familiar, cribs.offered),
          siteId,
          LEGACY_CUSTOMER,
        ],
      );
    }
  }

  private async buildPayload(
    siteId: number,
    catalog: ServicesCatalog,
  ): Promise<WizardServicesPayload> {
    const featureColumns = catalog.groups.map(group =>
      columnSql(group.namesql),
    );
    const [site, supplyRows, serviceRows, cribRows] = await Promise.all([
      this.legacyDb.queryOne<RawSiteRow>(
        `SELECT ${["`tipserv`", "`tipspec`", ...featureColumns].join(", ")}
         FROM ${legacyTableSql(LEGACY_TABLE.SITES1)}
         WHERE id = ? AND customer = ?`,
        [siteId, LEGACY_CUSTOMER],
      ),
      this.siteSuppliesRepository.find({ where: { site_id: siteId } }),
      this.siteServicesRepository.find({ where: { site_id: siteId } }),
      this.legacyDb.query<Parameters<typeof cribsFromRow>[0] & object>(
        `SELECT cribs_offered, cribs_count, cribs_is_paid, cribs_price, cribs_pricing_mode, cribs_note
         FROM site_settings WHERE site_id = ? LIMIT 1`,
        [siteId],
      ),
    ]);
    if (!site) {
      throw new NotFoundException(`site ${siteId} not found`);
    }

    const supplyById = new Map(supplyRows.map(row => [row.supply_id, row]));
    const serviceById = new Map(
      serviceRows.map(row => [row.additional_service_id, row]),
    );

    const features: Record<string, number[]> = {};
    for (const group of catalog.groups) {
      features[group.namesql] = featureIdsFrom(
        csvOrNull(site[group.namesql]),
        group.aliases,
      );
    }

    const tipspecIds = new Set(parseCsvIds(csvOrNull(site.tipspec)));

    return {
      dog_supplies: catalog.supplies.map(supply => ({
        supply_id: supply.id,
        ...serviceRowFor(
          toAnswer(supplyById.get(supply.id)),
          SUPPLY_TIPSPEC[supply.slug],
          tipspecIds,
        ),
      })),
      additional_services: catalog.services.map(service => ({
        service_id: service.id,
        ...serviceRowFor(
          toAnswer(serviceById.get(service.id)),
          SERVICE_TIPSPEC[service.slug],
          tipspecIds,
        ),
      })),
      features,
      tipserv: featureIdsFrom(
        csvOrNull(site.tipserv),
        new Map([...catalog.tipservIds].map(id => [id, id])),
      ),
      tipspec_extra: tipspecExtraFrom(
        csvOrNull(site.tipspec),
        catalog.tipspecExtraIds,
      ),
      cribs: cribsFromRow(cribRows[0] ?? null),
    };
  }

  private async loadCatalog(): Promise<ServicesCatalog> {
    const species = await this.speciesRepository.findOne({
      where: { name: DOG_SPECIES_NAME },
    });
    const speciesId = species?.id ?? -1;
    const [supplies, services, groups, tipserv, tipspec] = await Promise.all([
      this.suppliesRepository.find({
        where: { species_id: speciesId, is_active: true },
        order: { section: "ASC", sort_order: "ASC", id: "ASC" },
      }),
      this.servicesRepository.find({
        where: { species_id: speciesId, is_active: true },
        order: { sort_order: "ASC", id: "ASC" },
      }),
      this.featureGroups.load(BASE_LANG),
      this.legacyDb.query<IdRow>(
        `SELECT id FROM ${legacyTableSql(LEGACY_TABLE.TIPSERV)}
         WHERE customer = ? AND active = ?`,
        [LEGACY_CUSTOMER, ACTIVE],
      ),
      this.legacyDb.query<IdRow>(
        `SELECT id FROM ${legacyTableSql(LEGACY_TABLE.TIPSPEC)}
         WHERE customer = ? AND active = ? AND id IN (?)`,
        [LEGACY_CUSTOMER, ACTIVE, TIPSPEC_EXTRA_IDS],
      ),
    ]);
    return {
      supplies,
      services,
      groups,
      tipservIds: new Set(tipserv.map(row => Number(row.id))),
      tipspecExtraIds: new Set(tipspec.map(row => Number(row.id))),
    };
  }

  private async assertSiteExists(siteId: number): Promise<void> {
    const row = await this.legacyDb.queryOne<IdRow>(
      `SELECT id FROM ${legacyTableSql(LEGACY_TABLE.SITES1)}
       WHERE id = ? AND customer = ?`,
      [siteId, LEGACY_CUSTOMER],
    );
    if (!row) {
      throw new NotFoundException(`site ${siteId} not found`);
    }
  }
}
