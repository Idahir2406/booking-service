import type { MigrationInterface, QueryRunner } from "typeorm";

const TABLE = "v4p_juser_profiles";

/**
 * [column, definition]. GDPR: consent is OFF by default (0) and NULL is read
 * as "not given". marketing_opt_in_at = last time the traveler changed it.
 */
const COLUMNS: readonly (readonly [string, string])[] = [
  ["marketing_opt_in", "TINYINT(1) NULL DEFAULT 0"],
  ["marketing_opt_in_at", "DATETIME NULL"],
];

// Hand-written, idempotent. Panel del viajero §12 "Preferencias de
// comunicaciones": marketing/newsletter opt-in on the PHP-owned legacy table
// (D6/D-16), read/written only by web/php/traveler_profile_api.php
// (comms_get / comms_update). No existing table stores this consent:
// v4p_jnewsletter0 only logs visits (ip/day) and v4p_jmarketing0 is the legacy
// Club member list keyed by email (dead code per plan §6). Transactional
// emails are not optional and are not governed by this flag. Same
// information_schema guard as JuserProfilesTravelerFields1791300000001.
export class JuserProfilesMarketingOptIn1791400000007 implements MigrationInterface {
  name = "JuserProfilesMarketingOptIn1791400000007";

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
