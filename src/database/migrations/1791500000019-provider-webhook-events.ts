import type { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. External providers phase 5 (plan
// scalable-discovering-riddle): provider_webhook_events deduplicates the
// Nuitee/LiteAPI webhook deliveries by (provider, event_id), same lifecycle
// as stripe_webhook_events. 1791500000018 is left free for the parallel
// admin-import work.
// down: drops the table.

export class ProviderWebhookEvents1791500000019 implements MigrationInterface {
  name = "ProviderWebhookEvents1791500000019";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`provider_webhook_events\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`provider\` varchar(32) NOT NULL,
        \`event_id\` varchar(128) NOT NULL,
        \`event_type\` varchar(128) NOT NULL,
        \`booking_id\` varchar(128) NULL,
        \`reservation_id\` int NULL,
        \`status\` enum('received','processing','processed','failed','ignored') NOT NULL DEFAULT 'received',
        \`signature_verified\` tinyint NOT NULL DEFAULT 0,
        \`attempts\` int NOT NULL DEFAULT 0,
        \`last_error\` text NULL,
        \`payload\` json NULL,
        \`received_at\` datetime NULL,
        \`processed_at\` datetime NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_provider_webhook_events_event\` (\`provider\`, \`event_id\`),
        KEY \`idx_provider_webhook_events_booking\` (\`booking_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`provider_webhook_events\``);
  }
}
