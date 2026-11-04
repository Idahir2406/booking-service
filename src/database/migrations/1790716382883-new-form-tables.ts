import { MigrationInterface, QueryRunner } from "typeorm";

export class NewFormTables1790716382883 implements MigrationInterface {
    name = 'NewFormTables1790716382883'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`site_settings\` DROP FOREIGN KEY \`fk_site_settings_main_tipsite\``);
        await queryRunner.query(`DROP INDEX \`idx_site_settings_main_tipsite\` ON \`site_settings\``);
        await queryRunner.query(`ALTER TABLE \`site_settings\` CHANGE \`site_id\` \`site_id\` int NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`site_settings\` CHANGE \`site_id\` \`site_id\` int NOT NULL COMMENT 'v4p_jsites1.id (no FK: legacy table owned by PHP)'`);
        await queryRunner.query(`CREATE INDEX \`idx_site_settings_main_tipsite\` ON \`site_settings\` (\`main_tipsite_id\`)`);
        await queryRunner.query(`ALTER TABLE \`site_settings\` ADD CONSTRAINT \`fk_site_settings_main_tipsite\` FOREIGN KEY (\`main_tipsite_id\`) REFERENCES \`v4p_jtipsite\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

}
