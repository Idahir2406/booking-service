import { MigrationInterface, QueryRunner } from "typeorm";

export class Reservations1779127544922 implements MigrationInterface {
  name = "Reservations1779127544922";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."reservations_source_enum" AS ENUM('internal', 'airbnb', 'booking', 'vrbo')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."reservations_status_enum" AS ENUM('pending', 'confirmed', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."reservations_payment_status_enum" AS ENUM('pending', 'paid', 'refunded')`,
    );
    await queryRunner.query(
      `CREATE TABLE "reservations" ("id" SERIAL NOT NULL, "site_id" integer NOT NULL, "source" "public"."reservations_source_enum" NOT NULL, "external_reservation_id" text NOT NULL, "guest_name" text NOT NULL, "checkin" date NOT NULL, "checkout" date NOT NULL, "guests" integer NOT NULL, "pets" integer NOT NULL, "subtotal" numeric NOT NULL, "commission" numeric NOT NULL, "total" numeric NOT NULL, "currency" text NOT NULL, "status" "public"."reservations_status_enum" NOT NULL, "payment_status" "public"."reservations_payment_status_enum" NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_da95cef71b617ac35dc5bcda243" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."blocks_type_enum" RENAME TO "blocks_type_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."blocks_type_enum" AS ENUM('maintenance', 'manual_block')`,
    );
    await queryRunner.query(
      `ALTER TABLE "blocks" ALTER COLUMN "type" TYPE "public"."blocks_type_enum" USING "type"::"text"::"public"."blocks_type_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."blocks_type_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."blocks_type_enum_old" AS ENUM('booking', 'maintenance', 'manual_block')`,
    );
    await queryRunner.query(
      `ALTER TABLE "blocks" ALTER COLUMN "type" TYPE "public"."blocks_type_enum_old" USING "type"::"text"::"public"."blocks_type_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."blocks_type_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."blocks_type_enum_old" RENAME TO "blocks_type_enum"`,
    );
    await queryRunner.query(`DROP TABLE "reservations"`);
    await queryRunner.query(
      `DROP TYPE "public"."reservations_payment_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."reservations_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."reservations_source_enum"`);
  }
}
