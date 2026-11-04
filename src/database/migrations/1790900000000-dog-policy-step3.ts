import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written. Wizard step 3 "Perros":
// - unit_pet_policies.max_pets is dropped: the max number of dogs is a SITE-level
//   setting (site_settings.max_pets + max_pets_unlimited), synced to rooms.max_pets.
// - site_settings.max_pets_unlimited: "Sin límite" (max_pets stays NULL).
//   max_pets NULL + unlimited 0 = not answered yet.
// Column types match what TypeORM generates for the entities (boolean -> tinyint),
// so migration:generate shows no diff.
export class DogPolicyStep31790900000000 implements MigrationInterface {
    name = 'DogPolicyStep31790900000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`unit_pet_policies\` DROP COLUMN \`max_pets\``);
        await queryRunner.query(`ALTER TABLE \`site_settings\` ADD \`max_pets_unlimited\` tinyint NOT NULL DEFAULT 0`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`site_settings\` DROP COLUMN \`max_pets_unlimited\``);
        // Data of the dropped column is not recoverable: restored as NULL (= sin límite)
        await queryRunner.query(`ALTER TABLE \`unit_pet_policies\` ADD \`max_pets\` smallint NULL AFTER \`max_size_id\``);
    }
}
