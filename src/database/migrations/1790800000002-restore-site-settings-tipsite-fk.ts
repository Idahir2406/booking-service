import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written. NewFormTables1790716382883 (generated) dropped
// fk_site_settings_main_tipsite + idx_site_settings_main_tipsite because the FK was
// not modelled in SiteSettingsEntity. The entity now declares it (ManyToOne ->
// LegacyTipsiteEntity, synchronize: false). Idempotent: only adds the FK if missing.
// No explicit index: MariaDB auto-creates one named like the FK, and TypeORM ignores
// indexes named after a FK, so migration:generate stays clean.
const TABLE = 'site_settings';
const FK = 'fk_site_settings_main_tipsite';

export class RestoreSiteSettingsTipsiteFk1790800000002 implements MigrationInterface {
    name = 'RestoreSiteSettingsTipsiteFk1790800000002'

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await this.fkExists(queryRunner)) {
            return;
        }
        // Orphans would make ADD CONSTRAINT fail: null them (same as ON DELETE SET NULL)
        await queryRunner.query(
            `UPDATE \`${TABLE}\` s LEFT JOIN \`v4p_jtipsite\` t ON t.\`id\` = s.\`main_tipsite_id\`
             SET s.\`main_tipsite_id\` = NULL
             WHERE s.\`main_tipsite_id\` IS NOT NULL AND t.\`id\` IS NULL`,
        );
        await queryRunner.query(`ALTER TABLE \`${TABLE}\` ADD CONSTRAINT \`${FK}\` FOREIGN KEY (\`main_tipsite_id\`) REFERENCES \`v4p_jtipsite\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!(await this.fkExists(queryRunner))) {
            return;
        }
        await queryRunner.query(`ALTER TABLE \`${TABLE}\` DROP FOREIGN KEY \`${FK}\``);
        // Leaves the schema as NewFormTables1790716382883 left it (no FK, no index)
        const indexes = await queryRunner.query(
            `SELECT 1 FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
            [TABLE, FK],
        ) as unknown[];
        if (indexes.length > 0) {
            await queryRunner.query(`DROP INDEX \`${FK}\` ON \`${TABLE}\``);
        }
    }

    private async fkExists(queryRunner: QueryRunner): Promise<boolean> {
        const rows = await queryRunner.query(
            `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
             WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ?
               AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY' LIMIT 1`,
            [TABLE, FK],
        ) as unknown[];
        return rows.length > 0;
    }
}
