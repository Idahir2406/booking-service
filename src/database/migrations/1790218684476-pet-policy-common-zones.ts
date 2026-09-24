import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-cleaned: removed MariaDB drift ALTERs (DEFAULT 'NULL' / longtext / json DROP+ADD)
// generated against pre-existing tables. Only common zones (A1.6 / A1.6.1) changes remain.
export class PetPolicyCommonZones1790218684476 implements MigrationInterface {
    name = 'PetPolicyCommonZones1790218684476'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`unit_pet_policy_zones\` (\`id\` int NOT NULL AUTO_INCREMENT, \`policy_id\` int NOT NULL, \`zone_id\` int NOT NULL, \`allows_dining\` tinyint NOT NULL DEFAULT 0, \`other_text\` varchar(150) NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`uq_unit_pet_policy_zones_policy_zone\` (\`policy_id\`, \`zone_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`common_zones\` (\`id\` int NOT NULL AUTO_INCREMENT, \`slug\` varchar(60) NOT NULL, \`name\` varchar(100) NOT NULL, \`counts_as_extra_zone\` tinyint NOT NULL DEFAULT 0, \`is_dining_capable\` tinyint NOT NULL DEFAULT 0, \`requires_text\` tinyint NOT NULL DEFAULT 0, \`sort_order\` int NOT NULL DEFAULT '0', \`is_active\` tinyint NOT NULL DEFAULT 1, UNIQUE INDEX \`uq_common_zones_slug\` (\`slug\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`unit_pet_policies\` ADD \`common_zones_answered\` tinyint NULL`);
        await queryRunner.query(`ALTER TABLE \`unit_pet_policies\` ADD \`dining_zones_answered\` tinyint NULL`);
        await queryRunner.query(`ALTER TABLE \`unit_pet_policy_zones\` ADD CONSTRAINT \`FK_850cfeef28b2df06f07bc72ce9e\` FOREIGN KEY (\`policy_id\`) REFERENCES \`unit_pet_policies\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`unit_pet_policy_zones\` ADD CONSTRAINT \`FK_546d13e6630309a764b0a98e2df\` FOREIGN KEY (\`zone_id\`) REFERENCES \`common_zones\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);

        // Seed (spec C9: restaurant/breakfast = dining criterion only; terrace never an extra zone)
        await queryRunner.query(`INSERT INTO \`common_zones\` (\`slug\`, \`name\`, \`counts_as_extra_zone\`, \`is_dining_capable\`, \`requires_text\`, \`sort_order\`) VALUES
            ('restaurant', 'Restaurante', 0, 1, 0, 1),
            ('breakfast_area', 'Zona de desayunos', 0, 1, 0, 2),
            ('cafe_bar', 'Cafetería/bar', 1, 1, 0, 3),
            ('terrace', 'Terraza', 0, 1, 0, 4),
            ('pool_outdoor', 'Piscina (zona exterior)', 1, 0, 0, 5),
            ('spa', 'Spa / zona wellness', 1, 0, 0, 6),
            ('gym', 'Gimnasio', 1, 0, 0, 7),
            ('other', 'Otras', 1, 1, 1, 8)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`unit_pet_policy_zones\` DROP FOREIGN KEY \`FK_546d13e6630309a764b0a98e2df\``);
        await queryRunner.query(`ALTER TABLE \`unit_pet_policy_zones\` DROP FOREIGN KEY \`FK_850cfeef28b2df06f07bc72ce9e\``);
        await queryRunner.query(`ALTER TABLE \`unit_pet_policies\` DROP COLUMN \`dining_zones_answered\``);
        await queryRunner.query(`ALTER TABLE \`unit_pet_policies\` DROP COLUMN \`common_zones_answered\``);
        await queryRunner.query(`DROP INDEX \`uq_common_zones_slug\` ON \`common_zones\``);
        await queryRunner.query(`DROP TABLE \`common_zones\``);
        await queryRunner.query(`DROP INDEX \`uq_unit_pet_policy_zones_policy_zone\` ON \`unit_pet_policy_zones\``);
        await queryRunner.query(`DROP TABLE \`unit_pet_policy_zones\``);
    }
}
