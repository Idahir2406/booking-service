import type {
  ProvinceRecord,
  TownRecord,
} from "@/contexts/geography/types/geography.types";
import type { UpdateSitePropertyDto } from "../dto/update-site-property.dto";
import type {
  SiteWizardProperty,
  SiteWizardState,
} from "../types/site-wizard.types";

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";

import { LegacyDbService } from "@/shared/legacy-db/legacy-db.service";
import {
  LEGACY_CUSTOMER,
  LEGACY_TABLE,
  legacyTableSql,
} from "@/shared/legacy-db/legacy-tables";
import { parseCsvIds } from "@/shared/transformers/csv-ids.transformer";

import { GeographyService } from "@/contexts/geography/services/geography.service";
import { RoomEntity } from "@/contexts/rooms/entities/room.entity";

import { SiteSettingsEntity } from "../entities/site-settings.entity";
import {
  firstCsvId,
  formatWhatsapp,
  isTipoDeAlquiler,
  legacySlug,
  normalizeCsvIds,
  parseCoordinate,
  parseOptionalInt,
  parseWhatsapp,
  tiprentFromTipoDeAlquiler,
} from "../utils/site-property.utils";

const ACTIVE = "S";
/** Step reached once "Tu alojamiento" (step 1) has been saved. */
const STEP_AFTER_PROPERTY = 2;

interface RawSiteRow {
  id: number;
  name: string | null;
  email: string | null;
  email2: string | null;
  telefono: string | null;
  whatsapp_phone: string | null;
  tipsite: string | null;
  tipo_de_alquiler: string | null;
  id_provincia: number | null;
  provincia_label: string | null;
  id_poblacion: number | null;
  poblacion_label: string | null;
  geolat: string | null;
  geolng: string | null;
  interes: string | null;
  distancia: string | null;
  ubicacion: string | null;
  tipenv: string | null;
  tipdest: string | null;
}

interface CatalogStatusRow {
  id: number;
  active: string | null;
}

interface IdRow {
  id: number;
}

/** Columns step 1 is allowed to write in v4p_jsites1 (fixed whitelist). */
const PROPERTY_COLUMNS = [
  "name",
  "email",
  "email2",
  "telefono",
  "whatsapp_phone",
  "tipsite",
  "tipo_de_alquiler",
  "tiprent",
  "id_provincia",
  "provincia",
  "id_poblacion",
  "poblacio",
  "alias_poblacio",
  "geolat",
  "geolng",
  "interes",
  "alias_interes",
  "distancia",
  "ubicacion",
  "tipenv",
  "tipdest",
] as const;

type PropertyColumn = (typeof PROPERTY_COLUMNS)[number];
type PropertyUpdate = Record<PropertyColumn, string | number>;

interface ValidatedReferences {
  province: ProvinceRecord;
  town: TownRecord;
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function coordinateToLegacy(value: number | null): string {
  return value === null ? "" : String(value);
}

@Injectable()
export class SiteWizardService {
  constructor(
    private readonly legacyDb: LegacyDbService,
    private readonly geographyService: GeographyService,
    @InjectRepository(SiteSettingsEntity)
    private readonly siteSettingsRepository: Repository<SiteSettingsEntity>,
    @InjectRepository(RoomEntity)
    private readonly roomsRepository: Repository<RoomEntity>,
  ) {}

  async getState(siteId: number): Promise<SiteWizardState> {
    const site = await this.findSiteRow(siteId);
    if (!site) {
      throw new NotFoundException(`site ${siteId} not found`);
    }
    const [settings, unitsCount] = await Promise.all([
      this.siteSettingsRepository.findOne({ where: { site_id: siteId } }),
      this.roomsRepository.count({
        where: { site_id: siteId, is_active: true },
      }),
    ]);

    return {
      site_id: Number(site.id),
      wizard_step: settings?.wizard_step ?? 1,
      units_count: unitsCount,
      submitted_at: settings?.wizard_completed_at?.toISOString() ?? null,
      property: this.toProperty(site, settings),
    };
  }

  async updateProperty(
    siteId: number,
    dto: UpdateSitePropertyDto,
  ): Promise<SiteWizardState> {
    if (!(await this.siteExists(siteId))) {
      throw new NotFoundException(`site ${siteId} not found`);
    }

    const { province, town } = await this.validateReferences(dto);
    const values = this.buildPropertyUpdate(dto, province, town);

    await this.legacyDb.transaction(async manager => {
      // Lock the row so concurrent saves of the same draft serialize
      const locked = await this.legacyDb.queryOne<IdRow>(
        `SELECT id FROM ${legacyTableSql(LEGACY_TABLE.SITES1)}
         WHERE id = ? AND customer = ? FOR UPDATE`,
        [siteId, LEGACY_CUSTOMER],
        manager,
      );
      if (!locked) {
        throw new NotFoundException(`site ${siteId} not found`);
      }

      await this.writeLegacySite(manager, siteId, values);
      await this.upsertSettings(manager, siteId, dto.main_tipsite_id);
    });

    return this.getState(siteId);
  }

  private async findSiteRow(siteId: number): Promise<RawSiteRow | undefined> {
    return this.legacyDb.queryOne<RawSiteRow>(
      `SELECT s.id, s.name, s.email, s.email2, s.telefono, s.whatsapp_phone,
              s.tipsite, s.tipo_de_alquiler, s.id_provincia,
              p.xt_provincia AS provincia_label, s.id_poblacion,
              t.xt_poblacion AS poblacion_label, s.geolat, s.geolng,
              s.interes, s.distancia, s.ubicacion, s.tipenv, s.tipdest
       FROM ${legacyTableSql(LEGACY_TABLE.SITES1)} s
       LEFT JOIN ${legacyTableSql(LEGACY_TABLE.PROVINCIAS)} p
         ON p.id = s.id_provincia
       LEFT JOIN ${legacyTableSql(LEGACY_TABLE.POBLACIONES)} t
         ON t.id = s.id_poblacion
       WHERE s.id = ? AND s.customer = ?`,
      [siteId, LEGACY_CUSTOMER],
    );
  }

  private async siteExists(siteId: number): Promise<boolean> {
    const row = await this.legacyDb.queryOne<IdRow>(
      `SELECT id FROM ${legacyTableSql(LEGACY_TABLE.SITES1)}
       WHERE id = ? AND customer = ?`,
      [siteId, LEGACY_CUSTOMER],
    );
    return row !== undefined;
  }

  private toProperty(
    site: RawSiteRow,
    settings: SiteSettingsEntity | null,
  ): SiteWizardProperty {
    const tipsite = parseCsvIds(site.tipsite);
    const whatsapp = parseWhatsapp(site.whatsapp_phone);
    const tipoDeAlquiler = parseOptionalInt(site.tipo_de_alquiler);

    return {
      main_tipsite_id: settings?.main_tipsite_id ?? tipsite.at(0) ?? null,
      tipsite,
      tipo_de_alquiler: isTipoDeAlquiler(tipoDeAlquiler)
        ? tipoDeAlquiler
        : null,
      name: clean(site.name),
      email: clean(site.email),
      email2: clean(site.email2),
      telefono: clean(site.telefono),
      whatsapp_prefix: whatsapp.prefix,
      whatsapp_number: whatsapp.number,
      id_provincia: parseOptionalInt(site.id_provincia),
      provincia_label: clean(site.provincia_label),
      id_poblacion: parseOptionalInt(site.id_poblacion),
      poblacion_label: clean(site.poblacion_label),
      geolat: parseCoordinate(site.geolat),
      geolng: parseCoordinate(site.geolng),
      interes: clean(site.interes),
      distancia: clean(site.distancia),
      ubicacion: clean(site.ubicacion),
      tipenv: firstCsvId(site.tipenv),
      tipdest: parseCsvIds(site.tipdest),
    };
  }

  /**
   * Semantic checks against legacy catalogs. Collects every error so the
   * frontend can flag all fields at once. Messages are "field: reason".
   */
  private async validateReferences(
    dto: UpdateSitePropertyDto,
  ): Promise<ValidatedReferences> {
    const errors: string[] = [];
    const tipsiteIds = [
      ...new Set([dto.main_tipsite_id, ...(dto.tipsite ?? [])]),
    ];
    const tipdestIds = [...new Set(dto.tipdest ?? [])];

    const [tipsiteRows, tipenvRows, tipdestRows, province, town] =
      await Promise.all([
        this.findCatalogStatus(LEGACY_TABLE.TIPSITE, tipsiteIds),
        this.findCatalogStatus(LEGACY_TABLE.TIPENV, [dto.tipenv], false),
        this.findCatalogStatus(LEGACY_TABLE.TIPDEST, tipdestIds),
        this.geographyService.findActiveProvince(dto.id_provincia),
        this.geographyService.findTown(dto.id_poblacion),
      ]);

    const tipsiteById = new Map(tipsiteRows.map(row => [row.id, row]));
    if (tipsiteById.get(dto.main_tipsite_id)?.active !== ACTIVE) {
      errors.push("main_tipsite_id: unknown or inactive accommodation type");
    }
    const unknownTipsite = (dto.tipsite ?? []).filter(
      id => !tipsiteById.has(id),
    );
    if (unknownTipsite.length > 0) {
      errors.push(`tipsite: unknown ids ${unknownTipsite.join(",")}`);
    }

    if (tipenvRows.length === 0) {
      errors.push("tipenv: unknown environment type");
    }

    const activeTipdest = new Set(
      tipdestRows.filter(row => row.active === ACTIVE).map(row => row.id),
    );
    const invalidTipdest = tipdestIds.filter(id => !activeTipdest.has(id));
    if (invalidTipdest.length > 0) {
      errors.push(
        `tipdest: unknown or inactive ids ${invalidTipdest.join(",")}`,
      );
    }

    if (!province) {
      errors.push("id_provincia: unknown or inactive province");
    }
    if (!town) {
      errors.push("id_poblacion: unknown town");
    } else if (province && town.id_provincia !== province.id) {
      errors.push(
        "id_poblacion: town does not belong to the selected province",
      );
    }

    const hasNumber = Boolean(dto.whatsapp_number);
    if (hasNumber && !dto.whatsapp_prefix) {
      errors.push("whatsapp_prefix: required when whatsapp_number is set");
    }

    if (errors.length > 0 || !province || !town) {
      throw new BadRequestException(errors);
    }
    return { province, town };
  }

  /**
   * Status rows for the given ids. `withActive` = false for catalogs without
   * an `active` column (jtipenv).
   */
  private async findCatalogStatus(
    table:
      | typeof LEGACY_TABLE.TIPSITE
      | typeof LEGACY_TABLE.TIPENV
      | typeof LEGACY_TABLE.TIPDEST,
    ids: readonly number[],
    withActive = true,
  ): Promise<{ id: number; active: string }[]> {
    if (ids.length === 0) {
      return [];
    }
    const activeColumn = withActive ? "active" : `'${ACTIVE}'`;
    const rows = await this.legacyDb.query<CatalogStatusRow>(
      `SELECT id, ${activeColumn} AS active FROM ${legacyTableSql(table)}
       WHERE customer = ? AND id IN (?)`,
      [LEGACY_CUSTOMER, ids],
    );
    return rows.map(row => ({ id: Number(row.id), active: clean(row.active) }));
  }

  private buildPropertyUpdate(
    dto: UpdateSitePropertyDto,
    province: ProvinceRecord,
    town: TownRecord,
  ): PropertyUpdate {
    // tipo_de_alquiler already validated by the DTO (@IsIn)
    const tipoDeAlquiler = isTipoDeAlquiler(dto.tipo_de_alquiler)
      ? dto.tipo_de_alquiler
      : null;
    if (tipoDeAlquiler === null) {
      throw new BadRequestException(["tipo_de_alquiler: must be 1 or 2"]);
    }

    // Coordinates are a pair: if either is missing, fall back to the town centre
    const hasCoordinates =
      dto.geolat !== null &&
      dto.geolat !== undefined &&
      dto.geolng !== null &&
      dto.geolng !== undefined;
    const geolat = hasCoordinates ? (dto.geolat ?? null) : town.lat;
    const geolng = hasCoordinates ? (dto.geolng ?? null) : town.lng;
    const interes = clean(dto.interes);

    return {
      name: dto.name,
      email: dto.email,
      email2: clean(dto.email2),
      telefono: dto.telefono.replaceAll(/\s+/g, " "),
      whatsapp_phone: formatWhatsapp(dto.whatsapp_prefix, dto.whatsapp_number),
      tipsite: normalizeCsvIds(dto.tipsite ?? [], [dto.main_tipsite_id]),
      tipo_de_alquiler: String(tipoDeAlquiler),
      tiprent: String(tiprentFromTipoDeAlquiler(tipoDeAlquiler)),
      id_provincia: province.id,
      provincia: province.provincia,
      id_poblacion: town.id,
      poblacio: town.name,
      alias_poblacio: town.alias,
      geolat: coordinateToLegacy(geolat),
      geolng: coordinateToLegacy(geolng),
      interes,
      alias_interes: legacySlug(interes),
      distancia: clean(dto.distancia),
      ubicacion: clean(dto.ubicacion),
      tipenv: String(dto.tipenv),
      tipdest: normalizeCsvIds(dto.tipdest ?? []),
    };
  }

  private async writeLegacySite(
    manager: EntityManager,
    siteId: number,
    values: PropertyUpdate,
  ): Promise<void> {
    const assignments = PROPERTY_COLUMNS.map(column => `\`${column}\` = ?`);
    const params = PROPERTY_COLUMNS.map(column => values[column]);

    await this.legacyDb.query(
      `UPDATE ${legacyTableSql(LEGACY_TABLE.SITES1)}
       SET ${assignments.join(", ")}
       WHERE id = ? AND customer = ?`,
      [...params, siteId, LEGACY_CUSTOMER],
      manager,
    );
  }

  private async upsertSettings(
    manager: EntityManager,
    siteId: number,
    mainTipsiteId: number,
  ): Promise<void> {
    const table = manager.getRepository(SiteSettingsEntity).metadata.tableName;
    await manager.query(
      `INSERT INTO \`${table}\` (site_id, main_tipsite_id, wizard_step)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         main_tipsite_id = VALUES(main_tipsite_id),
         wizard_step = GREATEST(wizard_step, VALUES(wizard_step))`,
      [siteId, mainTipsiteId, STEP_AFTER_PROPERTY],
    );
  }
}
