import { MigrationInterface, QueryRunner } from "typeorm";

export class Runmir1779308675237 implements MigrationInterface {
  name = "Runmir1779308675237";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD "expiration_date" TIMESTAMP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP COLUMN "expiration_date"`,
    );
  }
}
