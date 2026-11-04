import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { envs } from "../../shared/configs/envs";
import {
  LEGACY_CUSTOMER,
  LEGACY_TABLE,
  legacyTable,
  legacyTableSql,
} from "../../shared/legacy-db/legacy-tables";
import {
  commissionRateFromPercentage,
  parsePlatformSettings,
  PLATFORM_SETTING_DEFAULTS,
  type PlatformSettings,
} from "../domain/platform-settings";
import { PlatformSettingEntity } from "../entities/platform-setting.entity";

export {
  PLATFORM_SETTING_DEFAULTS,
  PLATFORM_SETTING_KEY,
  type PlatformSettings,
} from "../domain/platform-settings";

interface CommissionRow {
  percentage: unknown;
}

interface SettingsCache {
  value: PlatformSettings;
  expiresAt: number;
}

/**
 * Platform settings with a short in-memory cache (PLATFORM_SETTINGS_CACHE_TTL_MS,
 * default 60 s): an admin change is picked up by new reservations within one TTL.
 *
 * commission_rate resolution order:
 *   1. v4p_jplatform_commission.percentage / 100 (admin-editable in admino),
 *   2. platform_settings.commission_rate,
 *   3. PLATFORM_SETTING_DEFAULTS.commission_rate.
 * Reservations freeze their own commission_rate at creation, so a change here
 * never affects existing reservations.
 */
@Injectable()
export class PlatformSettingsService {
  private readonly logger = new Logger(PlatformSettingsService.name);
  private cache: SettingsCache | null = null;

  constructor(
    @InjectRepository(PlatformSettingEntity)
    private readonly repository: Repository<PlatformSettingEntity>,
  ) {}

  async getAll(): Promise<PlatformSettings> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.value;
    }
    let value: PlatformSettings;
    try {
      const rows = await this.repository.find();
      value = parsePlatformSettings(rows, (key, raw) => {
        this.logger.warn(
          `Invalid platform setting ${key}=${raw}; using default`,
        );
      });
    } catch (error) {
      // Stale cache beats defaults; defaults beat a broken checkout.
      if (this.cache) {
        return this.cache.value;
      }
      this.logger.error(
        "Could not load platform_settings; using code defaults",
        error instanceof Error ? error.message : String(error),
      );
      return { ...PLATFORM_SETTING_DEFAULTS };
    }
    const adminCommissionRate = await this.loadAdminCommissionRate();
    if (adminCommissionRate !== null) {
      value.commission_rate = adminCommissionRate;
    }
    this.cache = {
      value,
      expiresAt: now + envs.PLATFORM_SETTINGS_CACHE_TTL_MS,
    };
    return value;
  }

  async get<K extends keyof PlatformSettings>(
    key: K,
  ): Promise<PlatformSettings[K]> {
    const settings = await this.getAll();
    return settings[key];
  }

  /**
   * Reads the single admino row. Never throws: a missing table (migration not
   * run yet), missing row or invalid value returns null -> fallback.
   */
  private async loadAdminCommissionRate(): Promise<number | null> {
    let rows: CommissionRow[];
    try {
      rows = await this.repository.query(
        `SELECT \`percentage\` FROM ${legacyTableSql(LEGACY_TABLE.PLATFORM_COMMISSION)}
          WHERE \`customer\` = ? ORDER BY \`id\` ASC LIMIT 1`,
        [LEGACY_CUSTOMER],
      );
    } catch (error) {
      this.logger.warn(
        `Could not read ${legacyTable(LEGACY_TABLE.PLATFORM_COMMISSION)}; using platform_settings.commission_rate: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) {
      return null;
    }
    const rate = commissionRateFromPercentage(row.percentage);
    if (rate === null) {
      this.logger.warn(
        `Invalid ${legacyTable(LEGACY_TABLE.PLATFORM_COMMISSION)}.percentage=${String(row.percentage)} (expected 0 <= % < 100); using platform_settings.commission_rate`,
      );
    }
    return rate;
  }

  invalidate(): void {
    this.cache = null;
  }
}
