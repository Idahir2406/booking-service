import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written. Fase 4 · deferred charge (A5/A6/A7) of `flexible` reservations:
// - stripe_customer_id / stripe_payment_method_id / stripe_setup_intent_id:
//   card saved by the Checkout Session in `setup` mode, charged off-session.
// - charge_at: when the cron charges the reservation (UTC). NULL for every
//   immediate reservation (legacy rows untouched).
// - regularization_deadline_at: set when the off-session charge failed; the
//   traveler can pay until then (min(now + regularization_window_hours,
//   check-in start)), after that the reservation is cancelled.
// - index for the cron query (charge_mode, payment_status, charge_at).

const COLUMNS: readonly [string, string][] = [
  ["stripe_customer_id", "varchar(255) NULL"],
  ["stripe_payment_method_id", "varchar(255) NULL"],
  ["stripe_setup_intent_id", "varchar(255) NULL"],
  ["charge_at", "datetime NULL"],
  ["regularization_deadline_at", "datetime NULL"],
];

const INDEX = "idx_reservations_deferred_charge";

export class DeferredCharge1791500000007 implements MigrationInterface {
  name = "DeferredCharge1791500000007";

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [column, definition] of COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE \`reservations\` ADD \`${column}\` ${definition}`,
      );
    }
    await queryRunner.query(
      `CREATE INDEX \`${INDEX}\` ON \`reservations\` (\`charge_mode\`, \`payment_status\`, \`charge_at\`)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX \`${INDEX}\` ON \`reservations\``);
    for (const [column] of [...COLUMNS].reverse()) {
      await queryRunner.query(
        `ALTER TABLE \`reservations\` DROP COLUMN \`${column}\``,
      );
    }
  }
}
