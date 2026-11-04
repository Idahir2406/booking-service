import type { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written. charge_mode: immediate (cobro actual) o flexible (reservado,
// sin flujo). El default rellena las filas existentes: siguen en immediate.
export class ChargeModeImmediate1791100000000 implements MigrationInterface {
  name = "ChargeModeImmediate1791100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`reservations\`
      ADD COLUMN IF NOT EXISTS \`charge_mode\` enum('immediate','flexible') NOT NULL DEFAULT 'immediate'
      AFTER \`payment_status\`
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`reservations\` DROP COLUMN IF EXISTS \`charge_mode\`
    `);
  }
}
