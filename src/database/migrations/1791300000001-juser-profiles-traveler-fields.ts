import type { MigrationInterface, QueryRunner } from "typeorm";

const TABLE = "v4p_juser_profiles";

/** [column, definition] — all nullable: existing rows (customers + hosts) keep working. */
const COLUMNS: readonly (readonly [string, string])[] = [
  ["surname", "varchar(120) NULL"],
  ["phone", "varchar(32) NULL"],
  ["avatar_path", "varchar(255) NULL"],
  ["updated_at", "datetime NULL"],
];

// Hand-written, idempotent. Panel del viajero (F-PV5, D6): extra profile
// fields on the PHP-owned legacy table (allowed by D-16). Read/written only by
// PHP (web/php/traveler_profile_api.php). Existence is checked through
// information_schema instead of ADD COLUMN IF NOT EXISTS so it also works on
// MySQL (only MariaDB supports IF NOT EXISTS there).
export class JuserProfilesTravelerFields1791300000001 implements MigrationInterface {
  name = "JuserProfilesTravelerFields1791300000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [column, definition] of COLUMNS) {
      if (await this.columnExists(queryRunner, column)) {
        continue;
      }
      await queryRunner.query(
        `ALTER TABLE \`${TABLE}\` ADD COLUMN \`${column}\` ${definition}`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [column] of [...COLUMNS].reverse()) {
      if (!(await this.columnExists(queryRunner, column))) {
        continue;
      }
      await queryRunner.query(
        `ALTER TABLE \`${TABLE}\` DROP COLUMN \`${column}\``,
      );
    }
  }

  private async columnExists(
    queryRunner: QueryRunner,
    column: string,
  ): Promise<boolean> {
    const rows = (await queryRunner.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
      [TABLE, column],
    )) as unknown[];
    return rows.length > 0;
  }
}
