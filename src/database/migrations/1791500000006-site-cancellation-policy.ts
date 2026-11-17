import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written. Structured cancellation policy of a site (wizard step 6) +
// platform settings of the deferred charge (A5/A6/A7).
// 1. site_settings: nullable columns. cancellation_policy_type NULL = legacy
//    rule (no structured policy), so existing sites keep working unchanged.
// 2. platform_settings: deferred_charge_enabled (off by default),
//    deferred_min_lead_hours. INSERT IGNORE keeps any value an admin already
//    set; down only removes these two keys.
// 3. regularization_window_hours (A7, seeded by 1791000000100 as 12) moves to
//    24 h only if it still holds the old default; down reverts 24 -> 12.

const COLUMNS: readonly [string, string][] = [
  ["cancellation_policy_type", "varchar(30) NULL"],
  ["cancellation_deadline_days", "tinyint NULL"],
  ["cancellation_penalty_type", "varchar(20) NULL"],
  ["no_show_policy", "varchar(30) NULL"],
  ["grace_after_booking_hours", "tinyint NULL"],
  ["early_cancellation_weeks", "tinyint NULL"],
  ["timezone", "varchar(64) NULL"],
];

const SETTINGS_SEED: readonly [string, string, string, string][] = [
  [
    "deferred_charge_enabled",
    "false",
    "string",
    "A5: cobro diferido de tarifas con cancelación gratuita (true/false)",
  ],
  [
    "deferred_min_lead_hours",
    "48",
    "integer",
    "A6: horas mínimas hasta el plazo para cobrar en diferido",
  ],
];

export class SiteCancellationPolicy1791500000006 implements MigrationInterface {
  name = "SiteCancellationPolicy1791500000006";

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [column, definition] of COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE \`site_settings\` ADD \`${column}\` ${definition}`,
      );
    }
    for (const [key, value, type, description] of SETTINGS_SEED) {
      await queryRunner.query(
        `INSERT IGNORE INTO \`platform_settings\` (\`key\`, \`value\`, \`value_type\`, \`description\`) VALUES (?, ?, ?, ?)`,
        [key, value, type, description],
      );
    }
    await queryRunner.query(
      `UPDATE \`platform_settings\` SET \`value\` = '24' WHERE \`key\` = 'regularization_window_hours' AND \`value\` = '12'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE \`platform_settings\` SET \`value\` = '12' WHERE \`key\` = 'regularization_window_hours' AND \`value\` = '24'`,
    );
    await queryRunner.query(
      `DELETE FROM \`platform_settings\` WHERE \`key\` IN (?, ?)`,
      SETTINGS_SEED.map(([key]) => key),
    );
    for (const [column] of [...COLUMNS].reverse()) {
      await queryRunner.query(
        `ALTER TABLE \`site_settings\` DROP COLUMN \`${column}\``,
      );
    }
  }
}
