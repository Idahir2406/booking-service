import { MigrationInterface, QueryRunner } from "typeorm";

export class Availability1779305070820 implements MigrationInterface {
  name = "Availability1779305070820";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."reservations_source_enum" AS ENUM(
          'internal', 'airbnb', 'booking', 'vrbo'
        );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."reservations_status_enum" AS ENUM(
          'pending', 'confirmed', 'cancelled'
        );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."reservations_payment_status_enum" AS ENUM(
          'pending', 'paid', 'refunded'
        );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "reservations" (
        "id" SERIAL NOT NULL,
        "site_id" integer NOT NULL,
        "source" "public"."reservations_source_enum" NOT NULL,
        "external_reservation_id" text,
        "user_id" integer NOT NULL,
        "checkin" date NOT NULL,
        "checkout" date NOT NULL,
        "guests" integer NOT NULL,
        "pets" integer NOT NULL,
        "subtotal" numeric NOT NULL,
        "commission" numeric NOT NULL,
        "total" numeric NOT NULL,
        "status" "public"."reservations_status_enum" NOT NULL,
        "payment_status" "public"."reservations_payment_status_enum" NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_da95cef71b617ac35dc5bcda243" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "reservations"
      ADD COLUMN IF NOT EXISTS "user_id" integer
    `);
    await queryRunner.query(`
      UPDATE "reservations"
      SET "user_id" = 0
      WHERE "user_id" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "reservations"
      ALTER COLUMN "user_id" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "reservations"
      ALTER COLUMN "external_reservation_id" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "reservations"
      DROP COLUMN IF EXISTS "guest_name"
    `);
    await queryRunner.query(`
      ALTER TABLE "reservations"
      DROP COLUMN IF EXISTS "currency"
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "availability" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "date" date NOT NULL,
        "site_id" integer NOT NULL,
        "is_available" boolean NOT NULL DEFAULT false,
        "min_nights" integer NOT NULL,
        "max_nights" integer NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_05a8158cf1112294b1c86e7f1d3" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_availability_site_id"
      ON "availability" ("site_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "reservations"
      ADD COLUMN IF NOT EXISTS "guest_name" text
    `);
    await queryRunner.query(`
      ALTER TABLE "reservations"
      ADD COLUMN IF NOT EXISTS "currency" text
    `);
    await queryRunner.query(`
      ALTER TABLE "reservations"
      DROP COLUMN IF EXISTS "user_id"
    `);
  }
}
