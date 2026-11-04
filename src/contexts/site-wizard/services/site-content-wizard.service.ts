import type {
  SiteWizardState,
  WizardContentPayload,
} from "../types/site-wizard.types";
import type { ContentInput } from "../utils/site-content.utils";

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

import { SiteSettingsEntity } from "../entities/site-settings.entity";
import {
  contentImagesFrom,
  escapeHtmlText,
  maxPhotosFor,
  parseContentInput,
  sanitizeRichText,
  toShortDescription,
} from "../utils/site-content.utils";
import { SiteWizardService } from "./site-wizard.service";

/** Step reached once "Contenido" (step 5) has been confirmed. */
const STEP_AFTER_CONTENT = 6;

type Sites2Row = Record<string, unknown> & {
  id: number;
  description1_l1: string | null;
  description2_l1: string | null;
};

interface SiteRow {
  id: number;
  premium: number | null;
}

/**
 * Wizard step 5 ("Contenido"): descriptions of v4p_jsites2 (l1 = es only).
 * Photos are uploaded by PHP into the image1..image35 columns; here they are
 * only listed. Some sites have duplicated jsites2 rows (same idback): the
 * row with MIN(id) is always the one read and written.
 */
@Injectable()
export class SiteContentWizardService {
  constructor(
    private readonly legacyDb: LegacyDbService,
    private readonly siteWizardService: SiteWizardService,
    @InjectRepository(SiteSettingsEntity)
    private readonly siteSettingsRepository: Repository<SiteSettingsEntity>,
  ) {}

  async get(siteId: number): Promise<WizardContentPayload> {
    const site = await this.findSite(siteId);
    const row = await this.findContentRow(siteId);
    return this.toPayload(site, row);
  }

  async update(siteId: number, body: unknown): Promise<WizardContentPayload> {
    await this.findSite(siteId);
    const parsed = parseContentInput(body);
    if (!parsed.ok) {
      throw new BadRequestException(parsed.errors);
    }
    const input = parsed.value;

    await this.legacyDb.transaction(async manager => {
      await this.lockSite(manager, siteId);
      const rowId = await this.ensureContentRow(manager, siteId);
      await this.writeDescriptions(manager, rowId, input);
    });

    return this.get(siteId);
  }

  async confirm(siteId: number): Promise<SiteWizardState> {
    const content = await this.get(siteId);
    const errors: string[] = [];
    if (!content.images.some(image => image.slot === 1)) {
      errors.push("images: Sube al menos la foto de portada");
    }
    if (content.description_short === "") {
      errors.push("description_short: Obligatorio");
    }
    if (errors.length > 0) {
      throw new BadRequestException(errors);
    }

    const table = this.siteSettingsRepository.metadata.tableName;
    await this.siteSettingsRepository.manager.query(
      `INSERT INTO \`${table}\` (site_id, wizard_step)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         wizard_step = GREATEST(wizard_step, VALUES(wizard_step))`,
      [siteId, STEP_AFTER_CONTENT],
    );
    return this.siteWizardService.getState(siteId);
  }

  private toPayload(
    site: SiteRow,
    row: Sites2Row | undefined,
  ): WizardContentPayload {
    const premium = Number(site.premium ?? 0) || 0;
    return {
      description_short: toShortDescription(row?.description1_l1),
      description_long: sanitizeRichText(row?.description2_l1),
      images: contentImagesFrom(row),
      premium,
      max_photos: maxPhotosFor(premium),
    };
  }

  private async writeDescriptions(
    manager: EntityManager,
    rowId: number,
    input: ContentInput,
  ): Promise<void> {
    const assignments: string[] = [];
    const params: string[] = [];
    if (input.description_short !== undefined) {
      assignments.push("`description1_l1` = ?");
      params.push(escapeHtmlText(input.description_short));
    }
    if (input.description_long !== undefined) {
      assignments.push("`description2_l1` = ?");
      params.push(input.description_long);
    }
    if (assignments.length === 0) {
      return;
    }
    await this.legacyDb.query(
      `UPDATE ${legacyTableSql(LEGACY_TABLE.SITES2)}
       SET ${assignments.join(", ")}
       WHERE id = ?`,
      [...params, rowId],
      manager,
    );
  }

  /** MIN(id) jsites2 row of the site, created (customer v4p) if missing. */
  private async ensureContentRow(
    manager: EntityManager,
    siteId: number,
  ): Promise<number> {
    const existing = await this.findContentRow(siteId, manager);
    if (existing) {
      return Number(existing.id);
    }
    await this.legacyDb.query(
      `INSERT INTO ${legacyTableSql(LEGACY_TABLE.SITES2)}
         (customer, idback, description1_l1, description2_l1)
       VALUES (?, ?, '', '')`,
      [LEGACY_CUSTOMER, siteId],
      manager,
    );
    const created = await this.findContentRow(siteId, manager);
    if (!created) {
      throw new NotFoundException(`content of site ${siteId} not found`);
    }
    return Number(created.id);
  }

  private findContentRow(
    siteId: number,
    manager?: EntityManager,
  ): Promise<Sites2Row | undefined> {
    return this.legacyDb.queryOne<Sites2Row>(
      `SELECT * FROM ${legacyTableSql(LEGACY_TABLE.SITES2)}
       WHERE idback = ?
       ORDER BY id ASC
       LIMIT 1`,
      [siteId],
      manager,
    );
  }

  private async findSite(siteId: number): Promise<SiteRow> {
    const row = await this.legacyDb.queryOne<SiteRow>(
      `SELECT id, premium FROM ${legacyTableSql(LEGACY_TABLE.SITES1)}
       WHERE id = ? AND customer = ?`,
      [siteId, LEGACY_CUSTOMER],
    );
    if (!row) {
      throw new NotFoundException(`site ${siteId} not found`);
    }
    return row;
  }

  /** Serializes concurrent saves (avoids creating two jsites2 rows). */
  private async lockSite(
    manager: EntityManager,
    siteId: number,
  ): Promise<void> {
    const row = await this.legacyDb.queryOne<{ id: number }>(
      `SELECT id FROM ${legacyTableSql(LEGACY_TABLE.SITES1)}
       WHERE id = ? AND customer = ? FOR UPDATE`,
      [siteId, LEGACY_CUSTOMER],
      manager,
    );
    if (!row) {
      throw new NotFoundException(`site ${siteId} not found`);
    }
  }
}
