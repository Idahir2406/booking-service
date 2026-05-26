import { MigrationInterface, QueryRunner } from "typeorm";

export class NullableReservationValues1779310781377 implements MigrationInterface {
  name = "NullableReservationValues1779310781377";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reservations" ALTER COLUMN "subtotal" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ALTER COLUMN "commission" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ALTER COLUMN "total" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reservations" ALTER COLUMN "total" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ALTER COLUMN "commission" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ALTER COLUMN "subtotal" SET NOT NULL`,
    );
  }
}
