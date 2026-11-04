import { envs } from "../configs/envs";

/**
 * Whitelist of legacy PHP tables (without DB_PREFIX, which already ends in "j":
 * "v4p_j" + "sites1" = "v4p_jsites1"). SQL identifiers are only ever built from
 * these constants, never from user input.
 */
export const LEGACY_TABLE = {
  SITES1: "sites1",
  /** Descriptions + photos of a site (idback = sites1.id). */
  SITES2: "sites2",
  TIPSITE: "tipsite",
  TIPENV: "tipenv",
  TIPDEST: "tipdest",
  TIPO_DE_ALQUILER: "tipo_de_alquiler",
  PROVINCIAS: "provincias",
  POBLACIONES: "poblaciones",
  TABLES: "tables",
  TRANSLATIONS: "clientes_translations",
  TIPSERV: "tipserv",
  TIPSPEC: "tipspec",
  // Option tables of the generated multioption fields of jsites1 (step 4)
  COMODIDADES: "comodidades",
  EXTERIOR: "exterior",
  FAMILIAR: "familiar",
  ACTIVIDADES: "actividades",
  EXPERIENCIA: "experiencia",
  SERVICIOS_DE_ACTIVIDAD: "servicios_de_actividad",
  UBICACION_Y_ENTORNO: "ubicación_y_entorno",
  COMIDA_Y_BEBIDA: "comida_y_bebida",
  SOSTENIBILIDAD: "sostenibilidad",
  /** Single-row V4P commission (human %), editable from admino. */
  PLATFORM_COMMISSION: "platform_commission",
} as const;

/** Value of v4p_jtables.dbtable for fields that live in v4p_jsites1. */
export const JTABLES_DBTABLE_SITES1 = "jsites1";

export type LegacyTable = (typeof LEGACY_TABLE)[keyof typeof LEGACY_TABLE];

/** Customer discriminator used by every legacy row of this site. */
export const LEGACY_CUSTOMER = "v4p";

/** Physical table name, e.g. "v4p_jsites1". */
export function legacyTable(table: LegacyTable): string {
  return `${envs.DB_PREFIX}${table}`;
}

/** Quoted physical table name for SQL: `v4p_jsites1`. */
export function legacyTableSql(table: LegacyTable): string {
  return `\`${legacyTable(table)}\``;
}

export const SUPPORTED_LANG = {
  ES: "es",
  CA: "ca",
  EN: "en",
  FR: "fr",
  PT: "pt",
} as const;

export type SupportedLang =
  (typeof SUPPORTED_LANG)[keyof typeof SUPPORTED_LANG];

export const SUPPORTED_LANGS: readonly SupportedLang[] =
  Object.values(SUPPORTED_LANG);

/** Base language: stored in the `*_l1` columns, no rows in translations. */
export const BASE_LANG: SupportedLang = SUPPORTED_LANG.ES;
