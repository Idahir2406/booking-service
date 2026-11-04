import { Injectable, Logger } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, EntityManager } from "typeorm";

import {
  BASE_LANG,
  LEGACY_TABLE,
  type LegacyTable,
  legacyTable,
  legacyTableSql,
  type SupportedLang,
} from "./legacy-tables";

const TRANSLATIONS_TTL_MS = 10 * 60 * 1000;

export interface TranslatableRow {
  id: number;
  name: string;
}

interface TranslationRow {
  identifier: string;
  value: string;
}

interface CacheEntry {
  expiresAt: number;
  value: Promise<ReadonlyMap<string, string>>;
}

/**
 * Raw, parametrized access to legacy PHP tables (v4p_j*). Values always go as
 * `?` params; identifiers only come from LEGACY_TABLE constants.
 */
@Injectable()
export class LegacyDbService {
  private readonly logger = new Logger(LegacyDbService.name);
  private readonly translationsCache = new Map<string, CacheEntry>();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async query<T>(
    sql: string,
    params: readonly unknown[] = [],
    manager?: EntityManager,
  ): Promise<T[]> {
    const runner = manager ?? this.dataSource.manager;
    return runner.query<T[]>(sql, [...params]);
  }

  async queryOne<T>(
    sql: string,
    params: readonly unknown[] = [],
    manager?: EntityManager,
  ): Promise<T | undefined> {
    const rows = await this.query<T>(sql, params, manager);
    return rows[0];
  }

  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  /**
   * identifier -> translated value for one (table, field, lang). The
   * translations table has no indexes, so each combination is loaded once and
   * cached in memory for TTL_MS. Base lang (es) returns an empty map.
   */
  getTranslations(
    table: LegacyTable,
    lang: SupportedLang,
    field = "name_l1",
  ): Promise<ReadonlyMap<string, string>> {
    if (lang === BASE_LANG) {
      return Promise.resolve(new Map());
    }

    const key = `${table}|${field}|${lang}`;
    const now = Date.now();
    const cached = this.translationsCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const value = this.loadTranslations(table, lang, field);
    this.translationsCache.set(key, {
      expiresAt: now + TRANSLATIONS_TTL_MS,
      value,
    });
    value.catch((error: unknown) => {
      this.translationsCache.delete(key);
      this.logger.error(`failed to load translations ${key}`, error);
    });
    return value;
  }

  /** Replaces `name` with its translation (falls back to base name_l1). */
  async translateRows<T extends TranslatableRow>(
    table: LegacyTable,
    lang: SupportedLang,
    rows: readonly T[],
    field = "name_l1",
  ): Promise<T[]> {
    const translations = await this.getTranslations(table, lang, field);
    return rows.map(row => ({
      ...row,
      name: translations.get(String(row.id)) ?? row.name,
    }));
  }

  private async loadTranslations(
    table: LegacyTable,
    lang: SupportedLang,
    field: string,
  ): Promise<ReadonlyMap<string, string>> {
    const rows = await this.query<TranslationRow>(
      `SELECT identifier, value FROM ${legacyTableSql(LEGACY_TABLE.TRANSLATIONS)}
       WHERE table_name = ? AND lang = ? AND field = ?`,
      [legacyTable(table), lang, field],
    );

    const map = new Map<string, string>();
    for (const row of rows) {
      const value = row.value.trim();
      if (value !== "") {
        map.set(String(row.identifier).trim(), value);
      }
    }
    return map;
  }
}
