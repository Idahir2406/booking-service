import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written. New-platform settings per legacy site (v4p_jsites1), 1:1 by site_id.
// site_id has NO FK to v4p_jsites1 on purpose: the legacy PHP table must not get new
// constraints (PHP deletes/recreates sites on its own). main_tipsite_id -> v4p_jtipsite(id)
// (InnoDB, int(11) signed) with ON DELETE SET NULL.
export class SiteSettings1790400000000 implements MigrationInterface {
    name = 'SiteSettings1790400000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`site_settings\` (\`site_id\` int NOT NULL COMMENT 'v4p_jsites1.id (no FK: legacy table owned by PHP)', \`main_tipsite_id\` int NULL, \`max_pets\` smallint NULL, \`wizard_step\` tinyint NOT NULL DEFAULT 1, \`wizard_completed_at\` datetime NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`idx_site_settings_main_tipsite\` (\`main_tipsite_id\`), PRIMARY KEY (\`site_id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`site_settings\` ADD CONSTRAINT \`fk_site_settings_main_tipsite\` FOREIGN KEY (\`main_tipsite_id\`) REFERENCES \`v4p_jtipsite\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`site_settings\` DROP FOREIGN KEY \`fk_site_settings_main_tipsite\``);
        await queryRunner.query(`DROP TABLE \`site_settings\``);
    }
}
