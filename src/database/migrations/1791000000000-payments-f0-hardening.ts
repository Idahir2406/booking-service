import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written. Payments F0 (security + critical payment bugs):
// 1. stripe_webhook_events: lifecycle (status/attempts/last_error/lease) so a
//    failed event is reprocessed on Stripe retry and a processed one skipped.
//    Existing rows were fully processed by the old code -> status 'processed'.
// 2. reservations: refund_seq (idempotency key refund:{id}:{n}) and
//    amount_refunded (partial vs full refund from charge.refunded).
// 3. reservation_disputes: Stripe chargebacks share the table with guest
//    reports (source), unique stripe_dispute_id for idempotent upserts.
export class PaymentsF0Hardening1791000000000 implements MigrationInterface {
  name = "PaymentsF0Hardening1791000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- stripe_webhook_events -------------------------------------------
    await queryRunner.query(
      `ALTER TABLE \`stripe_webhook_events\` ADD \`status\` enum('received','processing','processed','failed') NOT NULL DEFAULT 'received'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`stripe_webhook_events\` ADD \`attempts\` int NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE \`stripe_webhook_events\` ADD \`last_error\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`stripe_webhook_events\` ADD \`processing_started_at\` datetime NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`stripe_webhook_events\` ADD \`received_at\` datetime NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`stripe_webhook_events\` MODIFY \`processed_at\` timestamp NULL DEFAULT NULL`,
    );
    await queryRunner.query(
      `UPDATE \`stripe_webhook_events\` SET \`status\` = 'processed', \`attempts\` = 1, \`received_at\` = \`processed_at\``,
    );
    await queryRunner.query(
      `CREATE INDEX \`idx_stripe_webhook_events_status\` ON \`stripe_webhook_events\` (\`status\`)`,
    );

    // --- reservations -------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE \`reservations\` ADD \`refund_seq\` int NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` ADD \`amount_refunded\` decimal(10,2) NULL`,
    );
    await queryRunner.query(
      `UPDATE \`reservations\` SET \`refund_seq\` = 1 WHERE \`stripe_refund_id\` IS NOT NULL`,
    );

    // --- reservation_disputes ----------------------------------------------
    await queryRunner.query(
      `ALTER TABLE \`reservation_disputes\` ADD \`source\` enum('guest_report','stripe') NOT NULL DEFAULT 'guest_report'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_disputes\` ADD \`stripe_dispute_id\` varchar(255) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_disputes\` ADD \`stripe_status\` varchar(64) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_disputes\` ADD \`closed_at\` datetime NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX \`uq_disputes_stripe_dispute\` ON \`reservation_disputes\` (\`stripe_dispute_id\`)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // --- reservation_disputes ----------------------------------------------
    await queryRunner.query(
      `DROP INDEX \`uq_disputes_stripe_dispute\` ON \`reservation_disputes\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_disputes\` DROP COLUMN \`closed_at\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_disputes\` DROP COLUMN \`stripe_status\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_disputes\` DROP COLUMN \`stripe_dispute_id\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_disputes\` DROP COLUMN \`source\``,
    );

    // --- reservations -------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE \`reservations\` DROP COLUMN \`amount_refunded\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` DROP COLUMN \`refund_seq\``,
    );

    // --- stripe_webhook_events -------------------------------------------
    await queryRunner.query(
      `DROP INDEX \`idx_stripe_webhook_events_status\` ON \`stripe_webhook_events\``,
    );
    // Old schema: processed_at NOT NULL. Rows never processed get their receive time.
    await queryRunner.query(
      `UPDATE \`stripe_webhook_events\` SET \`processed_at\` = COALESCE(\`processed_at\`, \`received_at\`, NOW())`,
    );
    await queryRunner.query(
      `ALTER TABLE \`stripe_webhook_events\` MODIFY \`processed_at\` timestamp NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`stripe_webhook_events\` DROP COLUMN \`received_at\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`stripe_webhook_events\` DROP COLUMN \`processing_started_at\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`stripe_webhook_events\` DROP COLUMN \`last_error\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`stripe_webhook_events\` DROP COLUMN \`attempts\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`stripe_webhook_events\` DROP COLUMN \`status\``,
    );
  }
}
