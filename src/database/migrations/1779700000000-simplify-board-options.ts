import { MigrationInterface, QueryRunner } from "typeorm";

export class SimplifyBoardOptions1779700000000 implements MigrationInterface {
  name = "SimplifyBoardOptions1779700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "room_board_options" ADD "description" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_board_options" ADD "is_included" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`
      UPDATE "room_board_options"
      SET "is_included" = ("pricing_mode" = 'included'),
          "price" = 0
      WHERE "pricing_mode" = 'included'
    `);
    await queryRunner.query(`
      UPDATE "room_board_options"
      SET "code" = 'breakfast_included'
      WHERE "code" = 'breakfast'
    `);
    await queryRunner.query(
      `ALTER TABLE "room_board_options" DROP COLUMN "name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_board_options" DROP COLUMN "pricing_mode"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."room_board_options_pricing_mode_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."room_board_options_pricing_mode_enum" AS ENUM('included', 'per_night', 'per_night_per_guest', 'per_stay')`,
    );
    await queryRunner.query(`ALTER TABLE "room_board_options" ADD "name" text`);
    await queryRunner.query(
      `ALTER TABLE "room_board_options" ADD "pricing_mode" "public"."room_board_options_pricing_mode_enum" NOT NULL DEFAULT 'per_night'`,
    );
    await queryRunner.query(`
      UPDATE "room_board_options"
      SET "pricing_mode" = 'included',
          "price" = 0
      WHERE "is_included" = true
    `);
    await queryRunner.query(`
      UPDATE "room_board_options"
      SET "code" = 'breakfast'
      WHERE "code" = 'breakfast_included'
    `);
    await queryRunner.query(`
      UPDATE "room_board_options"
      SET "name" = CASE "code"
        WHEN 'room_only' THEN 'Solo alojamiento'
        WHEN 'breakfast' THEN 'Con desayuno'
        WHEN 'half_board' THEN 'Media pensión'
        WHEN 'full_board' THEN 'Pensión completa'
        WHEN 'all_inclusive' THEN 'Todo incluido'
        ELSE "code"
      END
    `);
    await queryRunner.query(
      `ALTER TABLE "room_board_options" ALTER COLUMN "name" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_board_options" ALTER COLUMN "pricing_mode" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_board_options" DROP COLUMN "description"`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_board_options" DROP COLUMN "is_included"`,
    );
  }
}
