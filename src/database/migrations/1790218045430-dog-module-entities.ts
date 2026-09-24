import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-cleaned: MariaDB drift ALTERs (DEFAULT 'NULL' / json<->longtext churn on existing
// tables) removed. facilities + dog_services dropped by hand (TypeORM never drops tables
// without an entity); they were empty and are fused into dog_supplies / additional_services.
export class DogModuleEntities1790218045430 implements MigrationInterface {
    name = 'DogModuleEntities1790218045430'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Obsolete catalogs (empty)
        await queryRunner.query(`DROP TABLE \`facilities\``);
        await queryRunner.query(`DROP TABLE \`dog_services\``);

        // New tables
        await queryRunner.query(`CREATE TABLE \`unit_pet_policies\` (\`id\` int NOT NULL AUTO_INCREMENT, \`room_id\` int NOT NULL, \`species_id\` int NOT NULL, \`max_size_id\` int NULL, \`max_pets\` smallint NULL, \`ppp_allowed\` tinyint NULL, \`supplement_mode\` enum ('none', 'per_pet_night', 'per_pet_stay', 'fixed_stay') NULL, \`supplement_amount\` decimal(10,2) NULL, \`left_alone\` enum ('yes', 'no', 'conditional') NULL, \`left_alone_conditions\` text NULL, \`full_unit_access\` tinyint NULL, \`deposit_required\` tinyint NULL, \`deposit_amount\` decimal(10,2) NULL, \`deposit_return\` enum ('end_of_stay', 'days') NULL, \`deposit_return_days\` smallint NULL, \`notes\` text NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`uq_unit_pet_policies_room_species\` (\`room_id\`, \`species_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`faq\` (\`id\` int NOT NULL AUTO_INCREMENT, \`species_id\` int NOT NULL, \`question\` text NOT NULL, \`slug\` varchar(255) NOT NULL, \`input_type\` enum ('bool', 'bool_text') NOT NULL DEFAULT 'bool', \`derived_from\` varchar(60) NULL, \`sort_order\` int NOT NULL DEFAULT '0', \`is_active\` tinyint NOT NULL DEFAULT 1, UNIQUE INDEX \`uq_faq_species_slug\` (\`species_id\`, \`slug\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`faq_answers\` (\`id\` int NOT NULL AUTO_INCREMENT, \`site_id\` int NOT NULL, \`faq_id\` int NOT NULL, \`state\` enum ('unanswered', 'no', 'yes') NOT NULL DEFAULT 'unanswered', \`text_value\` text NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`uq_faq_answers_site_faq\` (\`site_id\`, \`faq_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`site_dog_supplies\` (\`id\` int NOT NULL AUTO_INCREMENT, \`site_id\` int NOT NULL, \`supply_id\` int NOT NULL, \`state\` enum ('unanswered', 'no', 'yes') NOT NULL DEFAULT 'unanswered', \`is_paid\` tinyint NULL, \`price\` decimal(10,2) NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`uq_site_dog_supplies_site_supply\` (\`site_id\`, \`supply_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`dog_supplies\` (\`id\` int NOT NULL AUTO_INCREMENT, \`species_id\` int NOT NULL, \`name\` varchar(255) NOT NULL, \`slug\` varchar(255) NOT NULL, \`section\` enum ('amenity', 'facility') NOT NULL, \`score_points\` decimal(4,1) NOT NULL DEFAULT '0.0', \`is_public\` tinyint NOT NULL DEFAULT 1, \`is_filter\` tinyint NOT NULL DEFAULT 0, \`is_badge\` tinyint NOT NULL DEFAULT 0, \`is_scoring\` tinyint NOT NULL DEFAULT 0, \`completeness_weight\` decimal(5,2) NOT NULL DEFAULT '0.00', \`sort_order\` int NOT NULL DEFAULT '0', \`is_active\` tinyint NOT NULL DEFAULT 1, UNIQUE INDEX \`uq_dog_supplies_species_slug\` (\`species_id\`, \`slug\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`site_closest_services\` (\`id\` int NOT NULL AUTO_INCREMENT, \`site_id\` int NOT NULL, \`closest_service_id\` int NOT NULL, \`name\` varchar(150) NOT NULL, \`distance_km\` decimal(6,2) NULL, \`lat\` decimal(10,7) NULL, \`lng\` decimal(10,7) NULL, \`sort_order\` int NOT NULL DEFAULT '0', \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`idx_site_closest_services_site_id\` (\`site_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`closest_services\` (\`id\` int NOT NULL AUTO_INCREMENT, \`species_id\` int NOT NULL, \`name\` varchar(255) NOT NULL, \`slug\` varchar(255) NOT NULL, \`section\` enum ('environment', 'nearby_service') NOT NULL, \`sort_order\` int NOT NULL DEFAULT '0', \`is_active\` tinyint NOT NULL DEFAULT 1, UNIQUE INDEX \`uq_closest_services_species_slug\` (\`species_id\`, \`slug\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`site_additional_services\` (\`id\` int NOT NULL AUTO_INCREMENT, \`site_id\` int NOT NULL, \`additional_service_id\` int NOT NULL, \`state\` enum ('unanswered', 'no', 'yes') NOT NULL DEFAULT 'unanswered', \`is_paid\` tinyint NULL, \`price\` decimal(10,2) NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`uq_site_additional_services_site_service\` (\`site_id\`, \`additional_service_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`additional_services\` (\`id\` int NOT NULL AUTO_INCREMENT, \`species_id\` int NOT NULL, \`name\` varchar(255) NOT NULL, \`slug\` varchar(255) NOT NULL, \`score_points\` decimal(4,1) NOT NULL DEFAULT '1.0', \`is_public\` tinyint NOT NULL DEFAULT 1, \`is_filter\` tinyint NOT NULL DEFAULT 0, \`sort_order\` int NOT NULL DEFAULT '0', \`is_active\` tinyint NOT NULL DEFAULT 1, UNIQUE INDEX \`uq_additional_services_species_slug\` (\`species_id\`, \`slug\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);

        // site_units: unit type flags; FK to v4p_jtype_sites becomes RESTRICT
        await queryRunner.query(`ALTER TABLE \`site_units\` DROP FOREIGN KEY \`FK_ffa145e83856478d7c85270cd42\``);
        await queryRunner.query(`ALTER TABLE \`site_units\` ADD \`slug\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`site_units\` ADD \`is_full_use\` tinyint NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE \`rooms\` ADD \`site_unit_id\` int NULL`);

        // dog_sizes: configurable kg ranges per species (spec C2); table is empty
        await queryRunner.query(`ALTER TABLE \`dog_sizes\` MODIFY \`name\` varchar(60) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`dog_sizes\` MODIFY \`slug\` varchar(60) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`dog_sizes\` ADD \`species_id\` int NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`dog_sizes\` ADD \`description\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`dog_sizes\` ADD \`rank\` smallint NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`dog_sizes\` ADD \`min_kg\` decimal(5,2) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`dog_sizes\` ADD \`max_kg\` decimal(5,2) NULL`);

        // Money: decimal without scale was decimal(10,0) and dropped cents
        await queryRunner.query(`ALTER TABLE \`room_board_options\` CHANGE \`price\` \`price\` decimal(10,2) NOT NULL DEFAULT '0.00'`);
        await queryRunner.query(`ALTER TABLE \`room_extras\` CHANGE \`price\` \`price\` decimal(10,2) NOT NULL DEFAULT '0.00'`);
        await queryRunner.query(`ALTER TABLE \`rooms\` CHANGE \`price_per_night\` \`price_per_night\` decimal(10,2) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`reservations\` CHANGE \`subtotal\` \`subtotal\` decimal(10,2) NULL`);
        await queryRunner.query(`ALTER TABLE \`reservations\` CHANGE \`commission\` \`commission\` decimal(10,2) NULL`);
        await queryRunner.query(`ALTER TABLE \`reservations\` CHANGE \`total\` \`total\` decimal(10,2) NULL`);

        // Indexes and FKs
        await queryRunner.query(`CREATE UNIQUE INDEX \`uq_dog_sizes_species_rank\` ON \`dog_sizes\` (\`species_id\`, \`rank\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uq_dog_sizes_species_slug\` ON \`dog_sizes\` (\`species_id\`, \`slug\`)`);
        await queryRunner.query(`ALTER TABLE \`site_units\` ADD CONSTRAINT \`FK_ffa145e83856478d7c85270cd42\` FOREIGN KEY (\`type_site_id\`) REFERENCES \`v4p_jtype_sites\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`rooms\` ADD CONSTRAINT \`FK_739c1b7b1c30643c3c283100383\` FOREIGN KEY (\`site_unit_id\`) REFERENCES \`site_units\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`unit_pet_policies\` ADD CONSTRAINT \`FK_bef1ff13b51fff1bbbc700f50aa\` FOREIGN KEY (\`room_id\`) REFERENCES \`rooms\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`unit_pet_policies\` ADD CONSTRAINT \`FK_e2095cfff0274304a6d57d77ebf\` FOREIGN KEY (\`species_id\`) REFERENCES \`species\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`unit_pet_policies\` ADD CONSTRAINT \`FK_22d823f885b1955b08cc1f4d697\` FOREIGN KEY (\`max_size_id\`) REFERENCES \`dog_sizes\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`faq\` ADD CONSTRAINT \`FK_6bbac161f9dc21cd6b7a4a598fb\` FOREIGN KEY (\`species_id\`) REFERENCES \`species\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`faq_answers\` ADD CONSTRAINT \`FK_ec580d2aed46e28b97512576a0b\` FOREIGN KEY (\`faq_id\`) REFERENCES \`faq\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`site_dog_supplies\` ADD CONSTRAINT \`FK_45c9d8f680ea25a638e5d5c5cad\` FOREIGN KEY (\`supply_id\`) REFERENCES \`dog_supplies\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`dog_supplies\` ADD CONSTRAINT \`FK_49fd173bdd8a867a4efe896468b\` FOREIGN KEY (\`species_id\`) REFERENCES \`species\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`dog_sizes\` ADD CONSTRAINT \`FK_c96ee6603ec9f43b19ef00b78fc\` FOREIGN KEY (\`species_id\`) REFERENCES \`species\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`site_closest_services\` ADD CONSTRAINT \`FK_9f59363b07940f663fc8a9702f2\` FOREIGN KEY (\`closest_service_id\`) REFERENCES \`closest_services\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`closest_services\` ADD CONSTRAINT \`FK_33e0c867113e2f7faf2accf0c6a\` FOREIGN KEY (\`species_id\`) REFERENCES \`species\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`site_additional_services\` ADD CONSTRAINT \`FK_649f6fea288d487ec665e9ee9ac\` FOREIGN KEY (\`additional_service_id\`) REFERENCES \`additional_services\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`additional_services\` ADD CONSTRAINT \`FK_38f8ed0092b8437649525b24817\` FOREIGN KEY (\`species_id\`) REFERENCES \`species\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);

        // Seed: dog species + size categories (A1.1). max_kg NULL = no upper bound
        await queryRunner.query(`INSERT INTO \`species\` (\`name\`) VALUES ('Perro')`);
        await queryRunner.query(`INSERT INTO \`dog_sizes\` (\`species_id\`, \`name\`, \`slug\`, \`rank\`, \`min_kg\`, \`max_kg\`) SELECT s.\`id\`, v.\`name\`, v.\`slug\`, v.\`rank\`, v.\`min_kg\`, v.\`max_kg\` FROM \`species\` s CROSS JOIN (SELECT 'Pequeño' AS \`name\`, 'pequeno' AS \`slug\`, 1 AS \`rank\`, 0 AS \`min_kg\`, 10 AS \`max_kg\` UNION ALL SELECT 'Mediano', 'mediano', 2, 10.01, 20 UNION ALL SELECT 'Grande', 'grande', 3, 20.01, 40 UNION ALL SELECT 'Extra grande', 'extra-grande', 4, 40.01, NULL) v WHERE s.\`name\` = 'Perro'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM \`dog_sizes\``);
        await queryRunner.query(`DELETE FROM \`species\` WHERE \`name\` = 'Perro'`);

        await queryRunner.query(`ALTER TABLE \`additional_services\` DROP FOREIGN KEY \`FK_38f8ed0092b8437649525b24817\``);
        await queryRunner.query(`ALTER TABLE \`site_additional_services\` DROP FOREIGN KEY \`FK_649f6fea288d487ec665e9ee9ac\``);
        await queryRunner.query(`ALTER TABLE \`closest_services\` DROP FOREIGN KEY \`FK_33e0c867113e2f7faf2accf0c6a\``);
        await queryRunner.query(`ALTER TABLE \`site_closest_services\` DROP FOREIGN KEY \`FK_9f59363b07940f663fc8a9702f2\``);
        await queryRunner.query(`ALTER TABLE \`dog_sizes\` DROP FOREIGN KEY \`FK_c96ee6603ec9f43b19ef00b78fc\``);
        await queryRunner.query(`ALTER TABLE \`dog_supplies\` DROP FOREIGN KEY \`FK_49fd173bdd8a867a4efe896468b\``);
        await queryRunner.query(`ALTER TABLE \`site_dog_supplies\` DROP FOREIGN KEY \`FK_45c9d8f680ea25a638e5d5c5cad\``);
        await queryRunner.query(`ALTER TABLE \`faq_answers\` DROP FOREIGN KEY \`FK_ec580d2aed46e28b97512576a0b\``);
        await queryRunner.query(`ALTER TABLE \`faq\` DROP FOREIGN KEY \`FK_6bbac161f9dc21cd6b7a4a598fb\``);
        await queryRunner.query(`ALTER TABLE \`unit_pet_policies\` DROP FOREIGN KEY \`FK_22d823f885b1955b08cc1f4d697\``);
        await queryRunner.query(`ALTER TABLE \`unit_pet_policies\` DROP FOREIGN KEY \`FK_e2095cfff0274304a6d57d77ebf\``);
        await queryRunner.query(`ALTER TABLE \`unit_pet_policies\` DROP FOREIGN KEY \`FK_bef1ff13b51fff1bbbc700f50aa\``);
        await queryRunner.query(`ALTER TABLE \`rooms\` DROP FOREIGN KEY \`FK_739c1b7b1c30643c3c283100383\``);
        await queryRunner.query(`ALTER TABLE \`site_units\` DROP FOREIGN KEY \`FK_ffa145e83856478d7c85270cd42\``);
        await queryRunner.query(`DROP INDEX \`uq_dog_sizes_species_slug\` ON \`dog_sizes\``);
        await queryRunner.query(`DROP INDEX \`uq_dog_sizes_species_rank\` ON \`dog_sizes\``);

        await queryRunner.query(`ALTER TABLE \`reservations\` CHANGE \`total\` \`total\` decimal(10,0) NULL`);
        await queryRunner.query(`ALTER TABLE \`reservations\` CHANGE \`commission\` \`commission\` decimal(10,0) NULL`);
        await queryRunner.query(`ALTER TABLE \`reservations\` CHANGE \`subtotal\` \`subtotal\` decimal(10,0) NULL`);
        await queryRunner.query(`ALTER TABLE \`rooms\` CHANGE \`price_per_night\` \`price_per_night\` decimal(10,0) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`room_extras\` CHANGE \`price\` \`price\` decimal(10,0) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`room_board_options\` CHANGE \`price\` \`price\` decimal(10,0) NOT NULL DEFAULT '0'`);

        await queryRunner.query(`ALTER TABLE \`dog_sizes\` DROP COLUMN \`max_kg\``);
        await queryRunner.query(`ALTER TABLE \`dog_sizes\` DROP COLUMN \`min_kg\``);
        await queryRunner.query(`ALTER TABLE \`dog_sizes\` DROP COLUMN \`rank\``);
        await queryRunner.query(`ALTER TABLE \`dog_sizes\` DROP COLUMN \`description\``);
        await queryRunner.query(`ALTER TABLE \`dog_sizes\` DROP COLUMN \`species_id\``);
        await queryRunner.query(`ALTER TABLE \`dog_sizes\` MODIFY \`slug\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`dog_sizes\` MODIFY \`name\` varchar(255) NOT NULL`);

        await queryRunner.query(`ALTER TABLE \`rooms\` DROP COLUMN \`site_unit_id\``);
        await queryRunner.query(`ALTER TABLE \`site_units\` DROP COLUMN \`is_full_use\``);
        await queryRunner.query(`ALTER TABLE \`site_units\` DROP COLUMN \`slug\``);
        await queryRunner.query(`ALTER TABLE \`site_units\` ADD CONSTRAINT \`FK_ffa145e83856478d7c85270cd42\` FOREIGN KEY (\`type_site_id\`) REFERENCES \`v4p_jtype_sites\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);

        await queryRunner.query(`DROP INDEX \`uq_additional_services_species_slug\` ON \`additional_services\``);
        await queryRunner.query(`DROP TABLE \`additional_services\``);
        await queryRunner.query(`DROP INDEX \`uq_site_additional_services_site_service\` ON \`site_additional_services\``);
        await queryRunner.query(`DROP TABLE \`site_additional_services\``);
        await queryRunner.query(`DROP INDEX \`uq_closest_services_species_slug\` ON \`closest_services\``);
        await queryRunner.query(`DROP TABLE \`closest_services\``);
        await queryRunner.query(`DROP INDEX \`idx_site_closest_services_site_id\` ON \`site_closest_services\``);
        await queryRunner.query(`DROP TABLE \`site_closest_services\``);
        await queryRunner.query(`DROP INDEX \`uq_dog_supplies_species_slug\` ON \`dog_supplies\``);
        await queryRunner.query(`DROP TABLE \`dog_supplies\``);
        await queryRunner.query(`DROP INDEX \`uq_site_dog_supplies_site_supply\` ON \`site_dog_supplies\``);
        await queryRunner.query(`DROP TABLE \`site_dog_supplies\``);
        await queryRunner.query(`DROP INDEX \`uq_faq_answers_site_faq\` ON \`faq_answers\``);
        await queryRunner.query(`DROP TABLE \`faq_answers\``);
        await queryRunner.query(`DROP INDEX \`uq_faq_species_slug\` ON \`faq\``);
        await queryRunner.query(`DROP TABLE \`faq\``);
        await queryRunner.query(`DROP INDEX \`uq_unit_pet_policies_room_species\` ON \`unit_pet_policies\``);
        await queryRunner.query(`DROP TABLE \`unit_pet_policies\``);

        await queryRunner.query(`CREATE TABLE \`dog_services\` (\`id\` int NOT NULL AUTO_INCREMENT, \`name\` varchar(255) NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`facilities\` (\`id\` int NOT NULL AUTO_INCREMENT, \`name\` varchar(255) NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
    }

}
