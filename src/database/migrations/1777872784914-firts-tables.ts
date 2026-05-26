import { MigrationInterface, QueryRunner } from "typeorm";

export class FirtsTables1777872784914 implements MigrationInterface {
  name = "FirtsTables1777872784914";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "prices" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "site_id" integer NOT NULL, "start_date" date NOT NULL, "end_date" date NOT NULL, "price" numeric NOT NULL, "currency" character varying NOT NULL, CONSTRAINT "PK_2e40b9e4e631a53cd514d82ccd2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."blocks_type_enum" AS ENUM('booking', 'maintenance', 'manual_block')`,
    );
    await queryRunner.query(
      `CREATE TABLE "blocks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "site_id" integer NOT NULL, "start_date" date NOT NULL, "end_date" date NOT NULL, "type" "public"."blocks_type_enum" NOT NULL, "reference_id" uuid NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_8244fa1495c4e9222a01059244b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "availability" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "accommodation_id" uuid NOT NULL, "is_available" boolean NOT NULL DEFAULT true, "min_nights" integer NOT NULL, "max_nights" integer NOT NULL, "check_in_allowed" boolean NOT NULL DEFAULT true, "check_out_allowed" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_05a8158cf1112294b1c86e7f1d3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_accommodation_availability_accommodation_id" ON "availability" ("accommodation_id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_accommodation_availability_accommodation_id"`,
    );
    await queryRunner.query(`DROP TABLE "availability"`);
    await queryRunner.query(`DROP TABLE "blocks"`);
    await queryRunner.query(`DROP TYPE "public"."blocks_type_enum"`);
    await queryRunner.query(`DROP TABLE "prices"`);
  }
}
