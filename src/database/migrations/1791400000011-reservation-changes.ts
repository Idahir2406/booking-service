import type { MigrationInterface, QueryRunner } from "typeorm";

const REQUESTS = "reservation_change_requests";
const PROPOSALS = "reservation_change_proposals";
const ALTERNATIVES = "reservation_alternatives";

// Hand-written, idempotent. Panel del viajero (F-PV7b): change requests
// ("¿Necesitas cambiar tu reserva?"), V4P change proposals and accommodation
// alternatives (PDF §8/§10). A request never touches the reservation; an
// accepted proposal/alternative writes a NEW reservation_snapshots version
// (resulting_snapshot_version) linked to based_on_snapshot_version.
// The plan proposed 1791400000002 for this migration; that timestamp was
// already used (seed-reserva-checkout-variables), so it ships as ...011.
export class ReservationChanges1791400000011 implements MigrationInterface {
  name = "ReservationChanges1791400000011";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`${REQUESTS}\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`reservation_id\` int NOT NULL,
        \`user_id\` int NOT NULL COMMENT 'v4p_juser_profiles.id (no FK: legacy table owned by PHP)',
        \`type\` enum('add_nights','change_dates','travelers','dogs','extras','other') NOT NULL,
        \`message\` text NULL,
        \`status\` enum('received','in_review','proposal_sent','accepted','rejected','cancelled') NOT NULL DEFAULT 'received',
        \`response_note\` text NULL,
        \`closed_at\` datetime NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_change_requests_reservation\` (\`reservation_id\`, \`status\`),
        INDEX \`idx_change_requests_user\` (\`user_id\`),
        CONSTRAINT \`fk_change_requests_reservation\` FOREIGN KEY (\`reservation_id\`) REFERENCES \`reservations\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`${PROPOSALS}\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`request_id\` int NOT NULL,
        \`reservation_id\` int NOT NULL,
        \`before_payload\` json NOT NULL,
        \`after_payload\` json NOT NULL,
        \`amount_delta_cents\` int NOT NULL,
        \`status\` enum('pending_traveler','accepted','rejected','expired') NOT NULL DEFAULT 'pending_traveler',
        \`expires_at\` datetime NOT NULL,
        \`based_on_snapshot_version\` int NOT NULL,
        \`resulting_snapshot_version\` int NULL,
        \`conditions\` text NULL,
        \`message\` text NULL,
        \`close_reason\` varchar(64) NULL,
        \`responded_at\` datetime NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_change_proposals_request\` (\`request_id\`, \`status\`),
        INDEX \`idx_change_proposals_reservation\` (\`reservation_id\`, \`status\`),
        CONSTRAINT \`fk_change_proposals_request\` FOREIGN KEY (\`request_id\`) REFERENCES \`${REQUESTS}\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT \`fk_change_proposals_reservation\` FOREIGN KEY (\`reservation_id\`) REFERENCES \`reservations\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION
      ) ENGINE=InnoDB`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`${ALTERNATIVES}\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`reservation_id\` int NOT NULL,
        \`incident_id\` int NULL,
        \`before_payload\` json NOT NULL,
        \`proposal_payload\` json NOT NULL,
        \`amount_delta_cents\` int NOT NULL,
        \`status\` enum('pending_traveler','accepted','rejected','expired') NOT NULL DEFAULT 'pending_traveler',
        \`expires_at\` datetime NOT NULL,
        \`compatible_with_dogs\` tinyint NULL,
        \`based_on_snapshot_version\` int NOT NULL,
        \`resulting_snapshot_version\` int NULL,
        \`conditions\` text NULL,
        \`message\` text NULL,
        \`close_reason\` varchar(64) NULL,
        \`responded_at\` datetime NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_alternatives_reservation\` (\`reservation_id\`, \`status\`),
        INDEX \`idx_alternatives_incident\` (\`incident_id\`),
        CONSTRAINT \`fk_alternatives_reservation\` FOREIGN KEY (\`reservation_id\`) REFERENCES \`reservations\` (\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT \`fk_alternatives_incident\` FOREIGN KEY (\`incident_id\`) REFERENCES \`reservation_incidents\` (\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION
      ) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`${ALTERNATIVES}\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`${PROPOSALS}\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`${REQUESTS}\``);
  }
}
