import type { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Cribs / cots (2026-11-16, wizard step 4):
// - site_settings.cribs_*: offered, how many (max per reservation, no per-night
//   inventory), free or paid (price + per_stay|per_night), how to request them.
// - reservations.cribs: cribs requested by the traveler (paid ones are an
//   `extra` price line with metadata.crib; free ones only this column + snapshot).
const COLUMNS: readonly (readonly [
  table: string,
  column: string,
  ddl: string,
])[] = [
  ["site_settings", "cribs_offered", "TINYINT(1) NOT NULL DEFAULT 0"],
  ["site_settings", "cribs_count", "TINYINT NULL"],
  ["site_settings", "cribs_is_paid", "TINYINT(1) NOT NULL DEFAULT 0"],
  ["site_settings", "cribs_price", "DECIMAL(10,2) NULL"],
  ["site_settings", "cribs_pricing_mode", "VARCHAR(20) NULL"],
  ["site_settings", "cribs_note", "VARCHAR(255) NULL"],
  ["reservations", "cribs", "SMALLINT NOT NULL DEFAULT 0"],
];

export class SiteCribs1791500000016 implements MigrationInterface {
  name = "SiteCribs1791500000016";

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column, ddl] of COLUMNS) {
      if (!(await this.columnExists(queryRunner, table, column))) {
        await queryRunner.query(
          `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of [...COLUMNS].reverse()) {
      if (await this.columnExists(queryRunner, table, column)) {
        await queryRunner.query(
          `ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``,
        );
      }
    }
  }

  private async columnExists(
    queryRunner: QueryRunner,
    table: string,
    column: string,
  ): Promise<boolean> {
    const rows = (await queryRunner.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
      [table, column],
    )) as unknown[];
    return rows.length > 0;
  }
}
