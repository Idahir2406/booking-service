import type { MigrationInterface, QueryRunner } from "typeorm";

const TABLE = "host_payout_failures";

// Hand-written, idempotent. Punto 9 del contrato (pagos fallidos al alojamiento):
// Stripe payout.failed of a connected (host) account = the bank rejected the
// payout of the host's Stripe balance. One row per Stripe payout; payout.paid
// on the same account resolves every open row. An open row older than
// platform_settings.payout_failure_days pauses the host's new reservations.
export class HostPayoutFailures1791500000000 implements MigrationInterface {
  name = "HostPayoutFailures1791500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`${TABLE}\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`stripe_account_id\` varchar(255) NOT NULL,
        \`user_id\` int NULL COMMENT 'v4p_juser_profiles.id (no FK: legacy table owned by PHP)',
        \`stripe_payout_id\` varchar(255) NOT NULL,
        \`amount_cents\` int NOT NULL DEFAULT 0,
        \`currency\` char(3) NOT NULL DEFAULT 'eur',
        \`failure_code\` varchar(128) NULL,
        \`failure_message\` text NULL,
        \`failed_at\` datetime NOT NULL,
        \`escalated_at\` datetime NULL,
        \`resolved_at\` datetime NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uq_host_payout_failures_payout\` (\`stripe_payout_id\`),
        INDEX \`idx_host_payout_failures_account\` (\`stripe_account_id\`, \`resolved_at\`),
        INDEX \`idx_host_payout_failures_user\` (\`user_id\`, \`resolved_at\`)
      ) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`${TABLE}\``);
  }
}
