import { Injectable } from "@nestjs/common";

import { LegacyDbService } from "./legacy-db.service";
import {
  JTABLES_DBTABLE_SITES1,
  LEGACY_CUSTOMER,
  LEGACY_TABLE,
  legacyTable,
  legacyTableSql,
  type SupportedLang,
} from "./legacy-tables";
import {
  dedupeFeatureOptions,
  expectedRequiredValue,
  type FeatureOption,
  type FeatureOptionRow,
  SITE_FEATURE_GROUPS,
  type SiteFeatureGroupDefinition,
} from "./site-feature-groups";

interface JtablesGroupRow {
  id: number;
  namesql: string | null;
  name: string | null;
  label: string | null;
  required: string | null;
}

export interface LoadedSiteFeatureGroup extends SiteFeatureGroupDefinition {
  label: string;
  options: FeatureOption[];
  /** Every id of the aux table -> canonical option id. */
  aliases: ReadonlyMap<number, number>;
}

function clean(value: string | null): string {
  return (value ?? "").trim();
}

/**
 * Loads the step-4 feature groups (SITE_FEATURE_GROUPS) that are still
 * declared in v4p_jtables as generated multioption fields of jsites1 pointing
 * to the expected aux table. Groups missing from jtables are skipped, so a
 * column is never touched unless both the code and the legacy metadata agree.
 */
@Injectable()
export class SiteFeatureGroupsService {
  constructor(private readonly legacyDb: LegacyDbService) {}

  async load(lang: SupportedLang): Promise<LoadedSiteFeatureGroup[]> {
    const [rows, labels] = await Promise.all([
      this.legacyDb.query<JtablesGroupRow>(
        `SELECT id, namesql, name, label, required
         FROM ${legacyTableSql(LEGACY_TABLE.TABLES)}
         WHERE customer = ? AND dbtable = ? AND is_generated = 1
           AND type = 'multioption' AND namesql IN (?)`,
        [
          LEGACY_CUSTOMER,
          JTABLES_DBTABLE_SITES1,
          SITE_FEATURE_GROUPS.map(group => group.namesql),
        ],
      ),
      this.legacyDb.getTranslations(LEGACY_TABLE.TABLES, lang, "label"),
    ]);
    const rowByNamesql = new Map(rows.map(row => [clean(row.namesql), row]));

    const declared = SITE_FEATURE_GROUPS.flatMap(group => {
      const row = rowByNamesql.get(group.namesql);
      const expected = expectedRequiredValue(legacyTable(group.table));
      return row && clean(row.required) === expected ? [{ group, row }] : [];
    });

    return Promise.all(
      declared.map(async ({ group, row }) => {
        const { options, aliases } = await this.loadOptions(group, lang);
        return {
          ...group,
          label:
            labels.get(String(row.id)) ?? (clean(row.label) || clean(row.name)),
          options,
          aliases,
        };
      }),
    );
  }

  private async loadOptions(
    group: SiteFeatureGroupDefinition,
    lang: SupportedLang,
  ): Promise<{ options: FeatureOption[]; aliases: Map<number, number> }> {
    // No active/sequence columns in the aux tables
    const rows = await this.legacyDb.query<FeatureOptionRow>(
      `SELECT id, name_l1 AS name
       FROM ${legacyTableSql(group.table)}
       WHERE customer = ?
       ORDER BY TRIM(name_l1), id`,
      [LEGACY_CUSTOMER],
    );
    const deduped = dedupeFeatureOptions(rows);
    const options = await this.legacyDb.translateRows(
      group.table,
      lang,
      deduped.options,
    );
    return { options, aliases: deduped.aliases };
  }
}
