import type { MigrationInterface, QueryRunner } from "typeorm";

const TABLE = "reservations";
const INDEX = "idx_reservations_user_checkin";

// Hand-written. Panel del viajero (F-PV1): listado por user_id ordenado por
// checkin. Idempotente: comprueba information_schema antes de crear/borrar.
export class ReservationsUserIndex1791200000000 implements MigrationInterface {
  name = "ReservationsUserIndex1791200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await this.indexExists(queryRunner)) {
      return;
    }
    await queryRunner.query(
      `CREATE INDEX \`${INDEX}\` ON \`${TABLE}\` (\`user_id\`, \`checkin\`)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.indexExists(queryRunner))) {
      return;
    }
    await queryRunner.query(`DROP INDEX \`${INDEX}\` ON \`${TABLE}\``);
  }

  private async indexExists(queryRunner: QueryRunner): Promise<boolean> {
    const rows = (await queryRunner.query(
      `SELECT 1 FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
      [TABLE, INDEX],
    )) as unknown[];
    return rows.length > 0;
  }
}
