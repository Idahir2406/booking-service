import { MigrationInterface, QueryRunner } from "typeorm";

export class ReservationGuestFields1779322000000 implements MigrationInterface {
  name = "ReservationGuestFields1779322000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "reservations" ADD "guest_name" text`);
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD "guest_email" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD "guest_phone" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD "guest_notes" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP COLUMN "guest_notes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP COLUMN "guest_phone"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP COLUMN "guest_email"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP COLUMN "guest_name"`,
    );
  }
}
