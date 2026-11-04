import type { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. The V4P platform commission becomes an admin-editable
// legacy table so it can be maintained from the PHP backoffice (admino ->
// admSelect.php -> "PAGOS PLATAFORMA" -> jGlobal_data.php?dbtable=jplatform_commission).
//
// - Table name follows the legacy convention DB_PREFIX ("v4p_j") + name, like
//   v4p_jredirections / v4p_jlegal: admino builds every list/form/save from
//   v4p_jtables and always filters by `customer` and edits by `id`.
// - `percentage` is a human percent (12.00 = 12 %). booking reads it as
//   percentage / 100 (PlatformSettingsService); platform_settings.commission_rate
//   stays as fallback. It only applies to NEW reservations: every reservation
//   freezes its own commission_rate at creation.
// - Single row: the jtables "table" row has required = 'c' (edit only: no add,
//   duplicate or delete icons in admino).
// - validation_type 'percentage' on the field makes admino's jGlobal_updb.php
//   reject values outside [0, 100); the CHECK constraint is the last guard.
const TABLE = "v4p_jplatform_commission";
const JTABLES = "v4p_jtables";
const CUSTOMER = "v4p";
const DBTABLE = "jplatform_commission";
const DEFAULT_PERCENTAGE = "12.00";

/** [sequence, type, namesql, name, description, required, height, validation_type] */
type JtablesRow = readonly [
  sequence: number,
  type: string,
  namesql: string,
  name: string,
  description: string,
  required: string,
  height: number,
  validationType: string,
];

const JTABLES_ROWS: readonly JtablesRow[] = [
  [
    0,
    "table",
    TABLE,
    "COMISIÓN PLATAFORMA",
    "Comisión que V4P cobra sobre la base comisionable de cada reserva. Un único registro (solo edición).",
    "c",
    0,
    "",
  ],
  [
    10,
    "number",
    "percentage",
    "Comisión plataforma (%) - de 0 a 99.99, solo para reservas NUEVAS",
    "Porcentaje (12.00 = 12 %) que se aplica solo a las reservas creadas a partir del cambio (puede tardar hasta 1 minuto por la caché de booking). Las reservas existentes conservan la comisión congelada al crearse.",
    "required",
    // height 2 -> <input type="number" step="0.01"> in jGlobal_form.php
    2,
    "percentage",
  ],
];

export class PlatformCommissionAdmino1791400000004
  implements MigrationInterface
{
  name = "PlatformCommissionAdmino1791400000004";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`${TABLE}\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`customer\` varchar(99) NOT NULL DEFAULT '',
        \`percentage\` decimal(5,2) NOT NULL DEFAULT ${DEFAULT_PERCENTAGE} COMMENT 'Comisión V4P en % humano (12.00 = 12 %); solo reservas nuevas',
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`i_jplatform_commission_customer\` (\`customer\`),
        CONSTRAINT \`chk_jplatform_commission_percentage\` CHECK (\`percentage\` >= 0 AND \`percentage\` < 100)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    );

    // Seed the single row with the CURRENT commission (platform_settings is a
    // fraction: 0.12 -> 12.00). Invalid/missing -> 12.00. Only if empty.
    await queryRunner.query(
      `INSERT INTO \`${TABLE}\` (\`customer\`, \`percentage\`)
       SELECT ?, COALESCE(
         (SELECT ROUND(CAST(ps.\`value\` AS DECIMAL(10,6)) * 100, 2)
            FROM \`platform_settings\` ps
           WHERE ps.\`key\` = 'commission_rate'
             AND TRIM(ps.\`value\`) REGEXP '^[0-9]*[.]?[0-9]+$'
             AND CAST(ps.\`value\` AS DECIMAL(10,6)) >= 0
             AND CAST(ps.\`value\` AS DECIMAL(10,6)) < 1
           LIMIT 1),
         ${DEFAULT_PERCENTAGE})
       FROM DUAL
       WHERE NOT EXISTS (SELECT 1 FROM \`${TABLE}\` WHERE \`customer\` = ?)`,
      [CUSTOMER, CUSTOMER],
    );

    for (const [
      sequence,
      type,
      namesql,
      name,
      description,
      required,
      height,
      validationType,
    ] of JTABLES_ROWS) {
      await queryRunner.query(
        `INSERT INTO \`${JTABLES}\`
           (\`customer\`, \`dbtable\`, \`sequence\`, \`type\`, \`namesql\`, \`name\`, \`label\`,
            \`description\`, \`required\`, \`width\`, \`height\`, \`style\`, \`can_add_columns\`,
            \`is_generated\`, \`section\`, \`icon\`, \`validation_type\`)
         SELECT ?, ?, ?, ?, ?, ?, '', ?, ?, 0, ?, '', 0, 0, '', '', ?
         FROM DUAL
         WHERE NOT EXISTS (
           SELECT 1 FROM \`${JTABLES}\`
            WHERE \`customer\` = ? AND \`dbtable\` = ? AND \`namesql\` = ?
         )`,
        [
          CUSTOMER,
          DBTABLE,
          sequence,
          type,
          namesql,
          name,
          description,
          required,
          height,
          validationType,
          CUSTOMER,
          DBTABLE,
          namesql,
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM \`${JTABLES}\` WHERE \`customer\` = ? AND \`dbtable\` = ?`,
      [CUSTOMER, DBTABLE],
    );
    await queryRunner.query(`DROP TABLE IF EXISTS \`${TABLE}\``);
  }
}
