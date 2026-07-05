import { MigrationInterface, QueryRunner } from "typeorm";

export class RoomServices1779500000000 implements MigrationInterface {
  name = "RoomServices1779500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."room_services_service_category_enum" AS ENUM('board_basis', 'extra')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."room_services_pricing_mode_enum" AS ENUM('included', 'per_night', 'per_night_per_guest', 'per_stay')`,
    );
    await queryRunner.query(`
      CREATE TABLE "room_services" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "room_id" uuid NOT NULL,
        "service_category" "public"."room_services_service_category_enum" NOT NULL,
        "code" text NOT NULL,
        "name" text NOT NULL,
        "pricing_mode" "public"."room_services_pricing_mode_enum" NOT NULL,
        "price" numeric NOT NULL DEFAULT 0,
        "is_default" boolean NOT NULL DEFAULT false,
        "is_active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_room_services_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_room_services_room_id" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_room_services_room_id" ON "room_services" ("room_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "reservations" ADD "board_service_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD "services_snapshot" jsonb`,
    );

    await queryRunner.query(`
      INSERT INTO "room_services" ("room_id", "service_category", "code", "name", "pricing_mode", "price", "is_default", "is_active", "sort_order")
      SELECT r."id", 'board_basis', 'room_only', 'Solo alojamiento', 'included', 0, true, true, 0
      FROM "rooms" r
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP COLUMN "services_snapshot"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP COLUMN "board_service_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_room_services_room_id"`);
    await queryRunner.query(`DROP TABLE "room_services"`);
    await queryRunner.query(
      `DROP TYPE "public"."room_services_pricing_mode_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."room_services_service_category_enum"`,
    );
  }
}
