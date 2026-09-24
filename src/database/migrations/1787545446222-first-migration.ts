import { MigrationInterface, QueryRunner } from "typeorm";

export class FirstMigration1787545446222 implements MigrationInterface {
  name = "FirstMigration1787545446222";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`stripe_webhook_events\` (\`stripe_event_id\` varchar(255) NOT NULL, \`type\` varchar(255) NOT NULL, \`payload\` json NULL, \`processed_at\` timestamp NOT NULL, \`reservation_id\` int NULL, PRIMARY KEY (\`stripe_event_id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`room_extras\` (\`id\` int NOT NULL AUTO_INCREMENT, \`room_id\` int NOT NULL, \`name\` text NOT NULL, \`description\` text NULL, \`pricing_mode\` enum ('per_night', 'per_night_per_guest', 'per_stay') NOT NULL, \`price\` decimal NOT NULL DEFAULT '0', \`is_active\` tinyint NOT NULL DEFAULT 1, \`sort_order\` int NOT NULL DEFAULT '0', INDEX \`idx_room_extras_room_id\` (\`room_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`room_board_options\` (\`id\` int NOT NULL AUTO_INCREMENT, \`room_id\` int NOT NULL, \`code\` text NOT NULL, \`description\` text NULL, \`price\` decimal NOT NULL DEFAULT '0', \`is_included\` tinyint NOT NULL DEFAULT 0, \`is_default\` tinyint NOT NULL DEFAULT 0, \`is_active\` tinyint NOT NULL DEFAULT 1, \`sort_order\` int NOT NULL DEFAULT '0', INDEX \`idx_room_board_options_room_id\` (\`room_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`rooms\` (\`id\` int NOT NULL AUTO_INCREMENT, \`site_id\` int NOT NULL, \`name\` text NOT NULL, \`description\` text NULL, \`price_per_night\` decimal NOT NULL, \`max_guests\` int NOT NULL, \`max_pets\` int NOT NULL DEFAULT '0', \`is_active\` tinyint NOT NULL DEFAULT 1, \`sort_order\` int NOT NULL DEFAULT '0', \`image1\` text NULL, \`image2\` text NULL, \`image3\` text NULL, \`image4\` text NULL, \`image5\` text NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`idx_rooms_site_id\` (\`site_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`reservations\` (\`id\` int NOT NULL AUTO_INCREMENT, \`site_id\` int NOT NULL, \`room_id\` int NOT NULL, \`board_option_id\` int NULL, \`board_snapshot\` json NULL, \`extras_snapshot\` json NULL, \`source\` enum ('internal', 'airbnb', 'booking', 'vrbo') NOT NULL, \`external_reservation_id\` text NULL, \`user_id\` int NOT NULL, \`guest_name\` text NULL, \`guest_email\` text NULL, \`guest_phone\` text NULL, \`guest_notes\` text NULL, \`checkin\` date NOT NULL, \`checkout\` date NOT NULL, \`guests\` int NOT NULL, \`pets\` int NOT NULL, \`subtotal\` decimal NULL, \`commission\` decimal NULL, \`total\` decimal NULL, \`status\` enum ('pending', 'confirmed', 'cancelled', 'finalized') NOT NULL, \`payment_status\` enum ('pending', 'paid', 'refunded', 'partially_refunded') NOT NULL, \`payout_status\` enum ('held', 'released', 'blocked') NULL, \`finalized_at\` timestamp NULL, \`feedback_deadline_at\` timestamp NULL, \`payout_released_at\` timestamp NULL, \`stripe_transfer_id\` text NULL, \`stripe_refund_id\` text NULL, \`cancelled_at\` timestamp NULL, \`cancel_reason\` text NULL, \`refund_on_cancel\` tinyint NULL, \`expiration_date\` timestamp NOT NULL, \`stripe_checkout_session_id\` text NULL, \`stripe_payment_intent_id\` text NULL, \`paid_at\` timestamp NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`idx_reservations_site_room\` (\`site_id\`, \`room_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`reservation_guest_feedback\` (\`id\` int NOT NULL AUTO_INCREMENT, \`reservation_id\` int NOT NULL, \`type\` enum ('review', 'report') NOT NULL, \`rating\` int NULL, \`comment\` text NULL, \`report_reason\` text NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX \`idx_guest_feedback_reservation\` (\`reservation_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`reservation_feedback_tokens\` (\`id\` int NOT NULL AUTO_INCREMENT, \`reservation_id\` int NOT NULL, \`token_hash\` text NOT NULL, \`expires_at\` timestamp NOT NULL, \`used_at\` timestamp NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`idx_feedback_tokens_reservation\` (\`reservation_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`reservation_events\` (\`id\` int NOT NULL AUTO_INCREMENT, \`reservation_id\` int NOT NULL, \`event_type\` text NOT NULL, \`payload\` json NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`idx_reservation_events_reservation\` (\`reservation_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`reservation_disputes\` (\`id\` int NOT NULL AUTO_INCREMENT, \`reservation_id\` int NOT NULL, \`status\` enum ('open', 'resolved_release', 'resolved_refund') NOT NULL DEFAULT 'open', \`guest_report\` text NULL, \`admin_notes\` text NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`idx_disputes_reservation\` (\`reservation_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`blocks\` (\`id\` int NOT NULL AUTO_INCREMENT, \`site_id\` int NOT NULL, \`room_id\` int NOT NULL, \`start_date\` date NOT NULL, \`end_date\` date NOT NULL, \`type\` enum ('maintenance', 'manual_block') NOT NULL, \`reference_id\` int NOT NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, INDEX \`idx_blocks_site_room_dates\` (\`site_id\`, \`room_id\`, \`start_date\`, \`end_date\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`availability\` (\`id\` int NOT NULL AUTO_INCREMENT, \`date\` date NOT NULL, \`site_id\` int NOT NULL, \`room_id\` int NOT NULL, \`is_available\` tinyint NOT NULL DEFAULT 0, \`min_nights\` int NOT NULL, \`max_nights\` int NOT NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`idx_availability_site_room_date\` (\`site_id\`, \`room_id\`, \`date\`), INDEX \`idx_availability_site_id\` (\`site_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`room_extras\` ADD CONSTRAINT \`FK_06af1a1e1781248a4f517999867\` FOREIGN KEY (\`room_id\`) REFERENCES \`rooms\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`room_board_options\` ADD CONSTRAINT \`FK_ceed58c224b9f3763cb29e98854\` FOREIGN KEY (\`room_id\`) REFERENCES \`rooms\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`room_board_options\` DROP FOREIGN KEY \`FK_ceed58c224b9f3763cb29e98854\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`room_extras\` DROP FOREIGN KEY \`FK_06af1a1e1781248a4f517999867\``,
    );
    await queryRunner.query(
      `DROP INDEX \`idx_availability_site_id\` ON \`availability\``,
    );
    await queryRunner.query(
      `DROP INDEX \`idx_availability_site_room_date\` ON \`availability\``,
    );
    await queryRunner.query(`DROP TABLE \`availability\``);
    await queryRunner.query(
      `DROP INDEX \`idx_blocks_site_room_dates\` ON \`blocks\``,
    );
    await queryRunner.query(`DROP TABLE \`blocks\``);
    await queryRunner.query(
      `DROP INDEX \`idx_disputes_reservation\` ON \`reservation_disputes\``,
    );
    await queryRunner.query(`DROP TABLE \`reservation_disputes\``);
    await queryRunner.query(
      `DROP INDEX \`idx_reservation_events_reservation\` ON \`reservation_events\``,
    );
    await queryRunner.query(`DROP TABLE \`reservation_events\``);
    await queryRunner.query(
      `DROP INDEX \`idx_feedback_tokens_reservation\` ON \`reservation_feedback_tokens\``,
    );
    await queryRunner.query(`DROP TABLE \`reservation_feedback_tokens\``);
    await queryRunner.query(
      `DROP INDEX \`idx_guest_feedback_reservation\` ON \`reservation_guest_feedback\``,
    );
    await queryRunner.query(`DROP TABLE \`reservation_guest_feedback\``);
    await queryRunner.query(
      `DROP INDEX \`idx_reservations_site_room\` ON \`reservations\``,
    );
    await queryRunner.query(`DROP TABLE \`reservations\``);
    await queryRunner.query(`DROP INDEX \`idx_rooms_site_id\` ON \`rooms\``);
    await queryRunner.query(`DROP TABLE \`rooms\``);
    await queryRunner.query(
      `DROP INDEX \`idx_room_board_options_room_id\` ON \`room_board_options\``,
    );
    await queryRunner.query(`DROP TABLE \`room_board_options\``);
    await queryRunner.query(
      `DROP INDEX \`idx_room_extras_room_id\` ON \`room_extras\``,
    );
    await queryRunner.query(`DROP TABLE \`room_extras\``);
    await queryRunner.query(`DROP TABLE \`stripe_webhook_events\``);
  }
}
