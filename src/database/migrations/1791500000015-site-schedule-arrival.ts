import type { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Check-in / check-out schedule (2026-11-16):
// - site_settings.checkin_from / checkin_until / checkout_until (TIME, local to
//   the accommodation): set by the host in wizard step 6.
// - reservations.arrival_time (TIME): optional estimated arrival given by the
//   traveler at checkout, inside the check-in window.
// - reservations.checkout_until (TIME): site check-out time frozen at booking;
//   "Finalizar estancia" opens at that local time on the check-out day.
// The schedule itself is frozen per reservation in the snapshot (`schedule`).
const COLUMNS: readonly (readonly [
  table: string,
  column: string,
  ddl: string,
])[] = [
  ["site_settings", "checkin_from", "TIME NULL"],
  ["site_settings", "checkin_until", "TIME NULL"],
  ["site_settings", "checkout_until", "TIME NULL"],
  ["reservations", "arrival_time", "TIME NULL"],
  ["reservations", "checkout_until", "TIME NULL"],
];

export class SiteScheduleArrival1791500000015 implements MigrationInterface {
  name = "SiteScheduleArrival1791500000015";

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column, ddl] of COLUMNS) {
      if (!(await this.columnExists(queryRunner, table, column))) {
        await queryRunner.query(
          `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of [...COLUMNS].reverse()) {
      if (await this.columnExists(queryRunner, table, column)) {
        await queryRunner.query(
          `ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``,
        );
      }
    }
  }

  private async columnExists(
    queryRunner: QueryRunner,
    table: string,
    column: string,
  ): Promise<boolean> {
    const rows = (await queryRunner.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
      [table, column],
    )) as unknown[];
    return rows.length > 0;
  }
}
