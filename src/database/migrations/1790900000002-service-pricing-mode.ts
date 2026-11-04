import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written. Wizard step 4 "Servicios": how a paid dog supply / additional
// service is charged (ServicePricingModeValue). NULL unless state = yes and
// is_paid = 1. The (site_id, supply_id) / (site_id, additional_service_id)
// unique keys already exist (uq_site_dog_supplies_site_supply,
// uq_site_additional_services_site_service), nothing to add.
// Column type matches what TypeORM generates for the entities.
const PRICING_MODE_ENUM = `enum ('per_stay', 'per_night', 'per_pet_night', 'per_pet_stay')`;

export class ServicePricingMode1790900000002 implements MigrationInterface {
    name = 'ServicePricingMode1790900000002'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`site_dog_supplies\` ADD \`pricing_mode\` ${PRICING_MODE_ENUM} NULL AFTER \`price\``);
        await queryRunner.query(`ALTER TABLE \`site_additional_services\` ADD \`pricing_mode\` ${PRICING_MODE_ENUM} NULL AFTER \`price\``);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`site_additional_services\` DROP COLUMN \`pricing_mode\``);
        await queryRunner.query(`ALTER TABLE \`site_dog_supplies\` DROP COLUMN \`pricing_mode\``);
    }
}
