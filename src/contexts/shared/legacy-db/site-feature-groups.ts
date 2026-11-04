import { LEGACY_TABLE, type LegacyTable } from "./legacy-tables";

/**
 * Generated multioption fields of v4p_jsites1 shown in wizard step 4
 * ("Servicios"). Each one is a CSV column of jsites1 whose options live in an
 * auxiliary table (v4p_jtables.required = "file:<aux table>"). This hardcoded
 * list is the ONLY source of SQL identifiers for these columns/tables; at
 * runtime it is intersected with v4p_jtables (never with request input).
 * Order = display order. comodidades_para_tu_perro (replaced by dog_supplies)
 * and tipo_de_alquiler (step 1) are intentionally absent.
 */
export const SITE_FEATURE_BLOCK = {
  SITE: "site",
  ENV: "env",
} as const;

export type SiteFeatureBlock =
  (typeof SITE_FEATURE_BLOCK)[keyof typeof SITE_FEATURE_BLOCK];

export interface SiteFeatureGroupDefinition {
  /** v4p_jtables.namesql = v4p_jsites1 column. */
  namesql: string;
  /** Auxiliary options table. */
  table: LegacyTable;
  block: SiteFeatureBlock;
}

export const SITE_FEATURE_GROUPS: readonly SiteFeatureGroupDefinition[] = [
  {
    namesql: "comodidades",
    table: LEGACY_TABLE.COMODIDADES,
    block: SITE_FEATURE_BLOCK.SITE,
  },
  {
    namesql: "exterior",
    table: LEGACY_TABLE.EXTERIOR,
    block: SITE_FEATURE_BLOCK.SITE,
  },
  {
    namesql: "familiar",
    table: LEGACY_TABLE.FAMILIAR,
    block: SITE_FEATURE_BLOCK.SITE,
  },
  {
    namesql: "comida_y_bebida",
    table: LEGACY_TABLE.COMIDA_Y_BEBIDA,
    block: SITE_FEATURE_BLOCK.SITE,
  },
  {
    namesql: "sostenibilidad",
    table: LEGACY_TABLE.SOSTENIBILIDAD,
    block: SITE_FEATURE_BLOCK.SITE,
  },
  {
    namesql: "servicios_de_actividad",
    table: LEGACY_TABLE.SERVICIOS_DE_ACTIVIDAD,
    block: SITE_FEATURE_BLOCK.SITE,
  },
  {
    namesql: "ubicación_y_entorno",
    table: LEGACY_TABLE.UBICACION_Y_ENTORNO,
    block: SITE_FEATURE_BLOCK.ENV,
  },
  {
    namesql: "actividades",
    table: LEGACY_TABLE.ACTIVIDADES,
    block: SITE_FEATURE_BLOCK.ENV,
  },
  {
    namesql: "experiencia",
    table: LEGACY_TABLE.EXPERIENCIA,
    block: SITE_FEATURE_BLOCK.ENV,
  },
];

export interface FeatureOptionRow {
  id: number;
  name: string | null;
}

export interface FeatureOption {
  id: number;
  name: string;
}

export interface DedupedFeatureOptions {
  /** Unique trimmed names, input order kept, lowest id wins. */
  options: FeatureOption[];
  /** Every known id -> canonical (lowest) id of its trimmed name. */
  aliases: Map<number, number>;
}

/**
 * Aux tables have no unique name: trims names (some end in spaces) and folds
 * duplicates into the lowest id. Empty names are dropped.
 */
export function dedupeFeatureOptions(
  rows: readonly FeatureOptionRow[],
): DedupedFeatureOptions {
  const canonicalByName = new Map<string, number>();
  for (const row of rows) {
    const name = (row.name ?? "").trim();
    const id = Number(row.id);
    if (name === "" || !Number.isInteger(id) || id < 1) {
      continue;
    }
    const current = canonicalByName.get(name);
    if (current === undefined || id < current) {
      canonicalByName.set(name, id);
    }
  }

  const options: FeatureOption[] = [];
  const aliases = new Map<number, number>();
  const emitted = new Set<number>();
  for (const row of rows) {
    const name = (row.name ?? "").trim();
    const canonical = canonicalByName.get(name);
    if (canonical === undefined) {
      continue;
    }
    aliases.set(Number(row.id), canonical);
    if (!emitted.has(canonical)) {
      emitted.add(canonical);
      options.push({ id: canonical, name });
    }
  }
  return { options, aliases };
}

/** jtables.required of a group, e.g. "file:v4p_jcomodidades". */
export function expectedRequiredValue(physicalTable: string): string {
  return `file:${physicalTable}`;
}
