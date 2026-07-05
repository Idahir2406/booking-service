import { MigrationInterface, QueryRunner } from "typeorm";

export class SplitBoardAndExtras1779600000000 implements MigrationInterface {
  name = "SplitBoardAndExtras1779600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "room_services" RENAME TO "room_board_options"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."room_services_pricing_mode_enum" RENAME TO "room_board_options_pricing_mode_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_board_options" DROP COLUMN "service_category"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."room_services_service_category_enum"`,
    );
    await queryRunner.query(
      `ALTER INDEX "idx_room_services_room_id" RENAME TO "idx_room_board_options_room_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_board_options" RENAME CONSTRAINT "PK_room_services_id" TO "PK_room_board_options_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_board_options" RENAME CONSTRAINT "FK_room_services_room_id" TO "FK_room_board_options_room_id"`,
    );

    await queryRunner.query(
      `ALTER TABLE "reservations" RENAME COLUMN "board_service_id" TO "board_option_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" RENAME COLUMN "services_snapshot" TO "board_snapshot"`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."room_extras_pricing_mode_enum" AS ENUM('per_night', 'per_night_per_guest', 'per_stay')`,
    );
    await queryRunner.query(`
      CREATE TABLE "room_extras" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "room_id" uuid NOT NULL,
        "name" text NOT NULL,
        "description" text,
        "pricing_mode" "public"."room_extras_pricing_mode_enum" NOT NULL,
        "price" numeric NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_room_extras_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_room_extras_room_id" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_room_extras_room_id" ON "room_extras" ("room_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "reservations" ADD "extras_snapshot" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP COLUMN "extras_snapshot"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_room_extras_room_id"`);
    await queryRunner.query(`DROP TABLE "room_extras"`);
    await queryRunner.query(
      `DROP TYPE "public"."room_extras_pricing_mode_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "reservations" RENAME COLUMN "board_snapshot" TO "services_snapshot"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" RENAME COLUMN "board_option_id" TO "board_service_id"`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."room_services_service_category_enum" AS ENUM('board_basis', 'extra')`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_board_options" RENAME CONSTRAINT "FK_room_board_options_room_id" TO "FK_room_services_room_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_board_options" RENAME CONSTRAINT "PK_room_board_options_id" TO "PK_room_services_id"`,
    );
    await queryRunner.query(
      `ALTER INDEX "idx_room_board_options_room_id" RENAME TO "idx_room_services_room_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_board_options" ADD "service_category" "public"."room_services_service_category_enum" NOT NULL DEFAULT 'board_basis'`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_board_options" ALTER COLUMN "service_category" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."room_board_options_pricing_mode_enum" RENAME TO "room_services_pricing_mode_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_board_options" RENAME TO "room_services"`,
    );
  }
}
