import { MigrationInterface, QueryRunner } from "typeorm";

export class SiteId1779126332558 implements MigrationInterface {
  name = "SiteId1779126332558";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_availability_accommodation_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "availability" RENAME COLUMN "accommodation_id" TO "site_id"`,
    );
    await queryRunner.query(`ALTER TABLE "availability" DROP COLUMN "site_id"`);
    await queryRunner.query(
      `ALTER TABLE "availability" ADD "site_id" integer NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_availability_site_id" ON "availability" ("site_id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_availability_site_id"`);
    await queryRunner.query(`ALTER TABLE "availability" DROP COLUMN "site_id"`);
    await queryRunner.query(
      `ALTER TABLE "availability" ADD "site_id" uuid NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "availability" RENAME COLUMN "site_id" TO "accommodation_id"`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_availability_accommodation_id" ON "availability" ("accommodation_id") `,
    );
  }
}
