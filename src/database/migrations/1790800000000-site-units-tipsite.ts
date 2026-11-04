import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written. Wizard step 2 "Unidades":
// - site_units now hangs from the legacy v4p_jtipsite (InnoDB, id int(11) signed)
//   instead of the never-used v4p_jtype_sites (empty, dropped here). Column
//   type_site_id -> tipsite_id, FK ON DELETE RESTRICT. Slug is unique per tipsite
//   (not globally: "apartamento" exists for several tipsites); that unique index
//   also serves the FK.
// - site_units gets sort_order / is_active; rooms gets bathrooms.
// The FK is modelled in SiteUnitEntity through LegacyTipsiteEntity
// (synchronize: false) so migration:generate does not drop it.
export class SiteUnitsTipsite1790800000000 implements MigrationInterface {
    name = 'SiteUnitsTipsite1790800000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const [{ total }] = await queryRunner.query(
            `SELECT COUNT(*) AS total FROM \`v4p_jtype_sites\``,
        ) as { total: number | string }[];
        if (Number(total) > 0) {
            throw new Error(`v4p_jtype_sites is not empty (${total} rows): migrate its data before dropping it`);
        }

        await queryRunner.query(`ALTER TABLE \`site_units\` DROP FOREIGN KEY \`FK_ffa145e83856478d7c85270cd42\``);
        await queryRunner.query(`DROP INDEX \`FK_ffa145e83856478d7c85270cd42\` ON \`site_units\``);
        await queryRunner.query(`ALTER TABLE \`site_units\` CHANGE \`type_site_id\` \`tipsite_id\` int NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`site_units\` ADD \`sort_order\` int NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE \`site_units\` ADD \`is_active\` tinyint NOT NULL DEFAULT 1`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uq_site_units_tipsite_slug\` ON \`site_units\` (\`tipsite_id\`, \`slug\`)`);
        await queryRunner.query(`ALTER TABLE \`site_units\` ADD CONSTRAINT \`fk_site_units_tipsite\` FOREIGN KEY (\`tipsite_id\`) REFERENCES \`v4p_jtipsite\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);

        await queryRunner.query(`DROP TABLE \`v4p_jtype_sites\``);

        await queryRunner.query(`ALTER TABLE \`rooms\` ADD \`bathrooms\` smallint NOT NULL DEFAULT 0`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // tipsite ids cannot be mapped back to the (empty) v4p_jtype_sites
        const [{ total }] = await queryRunner.query(
            `SELECT COUNT(*) AS total FROM \`site_units\``,
        ) as { total: number | string }[];
        if (Number(total) > 0) {
            throw new Error(`site_units has ${total} rows: revert the site_units seed (and reassign rooms) first`);
        }

        await queryRunner.query(`ALTER TABLE \`rooms\` DROP COLUMN \`bathrooms\``);

        await queryRunner.query(`CREATE TABLE \`v4p_jtype_sites\` (\`id\` int NOT NULL AUTO_INCREMENT, \`customer\` varchar(255) NOT NULL, \`name_l1\` varchar(255) NOT NULL, \`alias_l1\` varchar(255) NOT NULL, \`indexable\` tinyint NOT NULL, \`active\` tinyint NOT NULL DEFAULT 1, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);

        await queryRunner.query(`ALTER TABLE \`site_units\` DROP FOREIGN KEY \`fk_site_units_tipsite\``);
        await queryRunner.query(`DROP INDEX \`uq_site_units_tipsite_slug\` ON \`site_units\``);
        await queryRunner.query(`ALTER TABLE \`site_units\` DROP COLUMN \`is_active\``);
        await queryRunner.query(`ALTER TABLE \`site_units\` DROP COLUMN \`sort_order\``);
        await queryRunner.query(`ALTER TABLE \`site_units\` CHANGE \`tipsite_id\` \`type_site_id\` int NOT NULL`);
        await queryRunner.query(`CREATE INDEX \`FK_ffa145e83856478d7c85270cd42\` ON \`site_units\` (\`type_site_id\`)`);
        await queryRunner.query(`ALTER TABLE \`site_units\` ADD CONSTRAINT \`FK_ffa145e83856478d7c85270cd42\` FOREIGN KEY (\`type_site_id\`) REFERENCES \`v4p_jtype_sites\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }
}
