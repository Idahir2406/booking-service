import { MigrationInterface, QueryRunner } from "typeorm";

export class NewAvailability1779125638685 implements MigrationInterface {
  name = "NewAvailability1779125638685";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_accommodation_availability_accommodation_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "availability" DROP COLUMN "check_in_allowed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "availability" DROP COLUMN "check_out_allowed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "availability" ADD "date" date NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "availability" ALTER COLUMN "is_available" SET DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_availability_accommodation_id" ON "availability" ("accommodation_id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_availability_accommodation_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "availability" ALTER COLUMN "is_available" SET DEFAULT true`,
    );
    await queryRunner.query(`ALTER TABLE "availability" DROP COLUMN "date"`);
    await queryRunner.query(
      `ALTER TABLE "availability" ADD "check_out_allowed" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "availability" ADD "check_in_allowed" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_accommodation_availability_accommodation_id" ON "availability" ("accommodation_id") `,
    );
  }
}
