import type { MigrationInterface, QueryRunner } from "typeorm";

const INCIDENTS = "reservation_incidents";
const ATTACHMENTS = "reservation_incident_attachments";
const MESSAGES = "reservation_incident_messages";

// Hand-written, idempotent. Panel del viajero (F-PV7a, D4): traveler incidents
// ("Tengo un problema") with their own UI life cycle (received -> in_review ->
// needs_info -> resolved), linked to reservation_disputes only when the
// incident holds money (D7 types, or the force_majeure cancellation).
// Attachments: only the random storage key of a file kept by PHP OUTSIDE the
// public web root (D5); never a path or URL.
export class ReservationIncidents1791400000000 implements MigrationInterface {
  name = "ReservationIncidents1791400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`${INCIDENTS}\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`reservation_id\` int NOT NULL,
        \`user_id\` int NOT NULL COMMENT 'v4p_juser_profiles.id (no FK: legacy table owned by PHP)',
        \`type\` enum('before_arrival','during_stay','dog_issue','conditions_not_respected','charge_issue','refund_issue','force_majeure_cancellation','other') NOT NULL,
        \`status\` enum('received','in_review','needs_info','resolved') NOT NULL DEFAULT 'received',
        \`description\` text NOT NULL,
        \`dispute_id\` int NULL,
        \`blocks_payout\` tinyint NOT NULL DEFAULT 0,
        \`resolution_note\` text NULL,
        \`resolved_at\` datetime NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_incidents_reservation\` (\`reservation_id\`, \`status\`),
        INDEX \`idx_incidents_user\` (\`user_id\`, \`created_at\`),
        INDEX \`idx_incidents_dispute\` (\`dispute_id\`),
        CONSTRAINT \`fk_incidents_reservation\` FOREIGN KEY (\`reservation_id\`) REFERENCES \`reservations\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT \`fk_incidents_dispute\` FOREIGN KEY (\`dispute_id\`) REFERENCES \`reservation_disputes\` (\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION
      ) ENGINE=InnoDB`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`${ATTACHMENTS}\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`incident_id\` int NOT NULL,
        \`storage_key\` varchar(128) NOT NULL COMMENT 'random key of the private file kept by PHP (D5), never a path',
        \`original_name\` varchar(255) NOT NULL,
        \`mime\` varchar(64) NOT NULL,
        \`size_bytes\` int NOT NULL,
        \`uploaded_by\` enum('traveler','admin') NOT NULL DEFAULT 'traveler',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_incident_attachments_incident\` (\`incident_id\`),
        UNIQUE INDEX \`uq_incident_attachments_storage_key\` (\`storage_key\`),
        CONSTRAINT \`fk_incident_attachments_incident\` FOREIGN KEY (\`incident_id\`) REFERENCES \`${INCIDENTS}\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`${MESSAGES}\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`incident_id\` int NOT NULL,
        \`author_type\` enum('traveler','admin') NOT NULL,
        \`body\` text NOT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_incident_messages_incident\` (\`incident_id\`),
        CONSTRAINT \`fk_incident_messages_incident\` FOREIGN KEY (\`incident_id\`) REFERENCES \`${INCIDENTS}\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`${MESSAGES}\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`${ATTACHMENTS}\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`${INCIDENTS}\``);
  }
}
