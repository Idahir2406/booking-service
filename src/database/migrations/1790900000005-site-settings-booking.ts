import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written. Wizard step 6 "Reservas": availability rule chosen by the
// owner (only 'all_year' for now) + min/max nights applied to the
// `availability` rows of every active unit. NULL = not configured.
export class SiteSettingsBooking1790900000005 implements MigrationInterface {
  name = "SiteSettingsBooking1790900000005";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`site_settings\` ADD \`availability_mode\` varchar(20) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`site_settings\` ADD \`min_nights\` smallint NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`site_settings\` ADD \`max_nights\` smallint NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`site_settings\` DROP COLUMN \`max_nights\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`site_settings\` DROP COLUMN \`min_nights\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`site_settings\` DROP COLUMN \`availability_mode\``,
    );
  }
}
