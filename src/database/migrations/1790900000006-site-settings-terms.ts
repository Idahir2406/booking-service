import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written. Wizard step 7 "Revisión": terms accepted when the owner
// submits the site for admin review. terms_accepted_by = legacy user id
// (no FK on purpose: users live in PHP-owned tables).
export class SiteSettingsTerms1790900000006 implements MigrationInterface {
  name = "SiteSettingsTerms1790900000006";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`site_settings\` ADD \`terms_accepted_at\` datetime NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`site_settings\` ADD \`terms_version\` varchar(20) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`site_settings\` ADD \`terms_accepted_by\` int NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`site_settings\` DROP COLUMN \`terms_accepted_by\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`site_settings\` DROP COLUMN \`terms_version\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`site_settings\` DROP COLUMN \`terms_accepted_at\``,
    );
  }
}
