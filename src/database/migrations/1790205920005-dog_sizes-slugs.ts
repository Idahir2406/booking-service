import { MigrationInterface, QueryRunner } from "typeorm";

export class DogSizesSlugs1790205920005 implements MigrationInterface {
  name = "DogSizesSlugs1790205920005";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`site_units\` (\`id\` int NOT NULL AUTO_INCREMENT, \`name\` varchar(255) NOT NULL, \`type_site_id\` int NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`v4p_jtype_sites\` (\`id\` int NOT NULL AUTO_INCREMENT, \`customer\` varchar(255) NOT NULL, \`name_l1\` varchar(255) NOT NULL, \`alias_l1\` varchar(255) NOT NULL, \`indexable\` tinyint NOT NULL, \`active\` tinyint NOT NULL DEFAULT 1, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`species\` (\`id\` int NOT NULL AUTO_INCREMENT, \`name\` varchar(255) NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`facilities\` (\`id\` int NOT NULL AUTO_INCREMENT, \`name\` varchar(255) NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`dog_sizes\` (\`id\` int NOT NULL AUTO_INCREMENT, \`name\` varchar(255) NOT NULL, \`slug\` varchar(255) NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`dog_services\` (\`id\` int NOT NULL AUTO_INCREMENT, \`name\` varchar(255) NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`stripe_webhook_events\` DROP COLUMN \`payload\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`stripe_webhook_events\` ADD \`payload\` json NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`stripe_webhook_events\` CHANGE \`processed_at\` \`processed_at\` timestamp NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`stripe_webhook_events\` CHANGE \`reservation_id\` \`reservation_id\` int NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`room_board_options\` CHANGE \`description\` \`description\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`room_extras\` CHANGE \`description\` \`description\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`rooms\` CHANGE \`description\` \`description\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`rooms\` CHANGE \`image1\` \`image1\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`rooms\` CHANGE \`image2\` \`image2\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`rooms\` CHANGE \`image3\` \`image3\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`rooms\` CHANGE \`image4\` \`image4\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`rooms\` CHANGE \`image5\` \`image5\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`board_option_id\` \`board_option_id\` int NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` DROP COLUMN \`board_snapshot\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` ADD \`board_snapshot\` json NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` DROP COLUMN \`extras_snapshot\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` ADD \`extras_snapshot\` json NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`external_reservation_id\` \`external_reservation_id\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`guest_name\` \`guest_name\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`guest_email\` \`guest_email\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`guest_phone\` \`guest_phone\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`guest_notes\` \`guest_notes\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`subtotal\` \`subtotal\` decimal NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`commission\` \`commission\` decimal NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`total\` \`total\` decimal NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`payout_status\` \`payout_status\` enum ('held', 'released', 'blocked') NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`finalized_at\` \`finalized_at\` timestamp NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`feedback_deadline_at\` \`feedback_deadline_at\` timestamp NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`payout_released_at\` \`payout_released_at\` timestamp NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`stripe_transfer_id\` \`stripe_transfer_id\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`stripe_refund_id\` \`stripe_refund_id\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`cancelled_at\` \`cancelled_at\` timestamp NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`cancel_reason\` \`cancel_reason\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`refund_on_cancel\` \`refund_on_cancel\` tinyint NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`expiration_date\` \`expiration_date\` timestamp NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`stripe_checkout_session_id\` \`stripe_checkout_session_id\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`stripe_payment_intent_id\` \`stripe_payment_intent_id\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`paid_at\` \`paid_at\` timestamp NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_guest_feedback\` CHANGE \`rating\` \`rating\` int NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_guest_feedback\` CHANGE \`comment\` \`comment\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_guest_feedback\` CHANGE \`report_reason\` \`report_reason\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_feedback_tokens\` CHANGE \`expires_at\` \`expires_at\` timestamp NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_feedback_tokens\` CHANGE \`used_at\` \`used_at\` timestamp NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_events\` DROP COLUMN \`payload\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_events\` ADD \`payload\` json NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_disputes\` CHANGE \`guest_report\` \`guest_report\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_disputes\` CHANGE \`admin_notes\` \`admin_notes\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`blocks\` CHANGE \`deleted_at\` \`deleted_at\` datetime(6) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`site_units\` ADD CONSTRAINT \`FK_ffa145e83856478d7c85270cd42\` FOREIGN KEY (\`type_site_id\`) REFERENCES \`v4p_jtype_sites\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`site_units\` DROP FOREIGN KEY \`FK_ffa145e83856478d7c85270cd42\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`blocks\` CHANGE \`deleted_at\` \`deleted_at\` datetime(6) NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_disputes\` CHANGE \`admin_notes\` \`admin_notes\` text NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_disputes\` CHANGE \`guest_report\` \`guest_report\` text NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_events\` DROP COLUMN \`payload\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_events\` ADD \`payload\` longtext COLLATE "utf8mb4_bin" NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_feedback_tokens\` CHANGE \`used_at\` \`used_at\` timestamp NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_feedback_tokens\` CHANGE \`expires_at\` \`expires_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP() ON UPDATE CURRENT_TIMESTAMP()`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_guest_feedback\` CHANGE \`report_reason\` \`report_reason\` text NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_guest_feedback\` CHANGE \`comment\` \`comment\` text NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservation_guest_feedback\` CHANGE \`rating\` \`rating\` int NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`paid_at\` \`paid_at\` timestamp NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`stripe_payment_intent_id\` \`stripe_payment_intent_id\` text NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`stripe_checkout_session_id\` \`stripe_checkout_session_id\` text NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`expiration_date\` \`expiration_date\` timestamp NOT NULL DEFAULT ''0000-00-00 00:00:00''`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`refund_on_cancel\` \`refund_on_cancel\` tinyint NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`cancel_reason\` \`cancel_reason\` text NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`cancelled_at\` \`cancelled_at\` timestamp NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`stripe_refund_id\` \`stripe_refund_id\` text NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`stripe_transfer_id\` \`stripe_transfer_id\` text NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`payout_released_at\` \`payout_released_at\` timestamp NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`feedback_deadline_at\` \`feedback_deadline_at\` timestamp NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`finalized_at\` \`finalized_at\` timestamp NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`payout_status\` \`payout_status\` enum ('held', 'released', 'blocked') NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`total\` \`total\` decimal(10,0) NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`commission\` \`commission\` decimal(10,0) NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`subtotal\` \`subtotal\` decimal(10,0) NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`guest_notes\` \`guest_notes\` text NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`guest_phone\` \`guest_phone\` text NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`guest_email\` \`guest_email\` text NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`guest_name\` \`guest_name\` text NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`external_reservation_id\` \`external_reservation_id\` text NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` DROP COLUMN \`extras_snapshot\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` ADD \`extras_snapshot\` longtext COLLATE "utf8mb4_bin" NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` DROP COLUMN \`board_snapshot\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` ADD \`board_snapshot\` longtext COLLATE "utf8mb4_bin" NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`reservations\` CHANGE \`board_option_id\` \`board_option_id\` int NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`rooms\` CHANGE \`image5\` \`image5\` text NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`rooms\` CHANGE \`image4\` \`image4\` text NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`rooms\` CHANGE \`image3\` \`image3\` text NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`rooms\` CHANGE \`image2\` \`image2\` text NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`rooms\` CHANGE \`image1\` \`image1\` text NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`rooms\` CHANGE \`description\` \`description\` text NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`room_extras\` CHANGE \`description\` \`description\` text NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`room_board_options\` CHANGE \`description\` \`description\` text NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`stripe_webhook_events\` CHANGE \`reservation_id\` \`reservation_id\` int NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`stripe_webhook_events\` CHANGE \`processed_at\` \`processed_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP() ON UPDATE CURRENT_TIMESTAMP()`,
    );
    await queryRunner.query(
      `ALTER TABLE \`stripe_webhook_events\` DROP COLUMN \`payload\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`stripe_webhook_events\` ADD \`payload\` longtext COLLATE "utf8mb4_bin" NULL DEFAULT 'NULL'`,
    );
    await queryRunner.query(`DROP TABLE \`dog_services\``);
    await queryRunner.query(`DROP TABLE \`dog_sizes\``);
    await queryRunner.query(`DROP TABLE \`facilities\``);
    await queryRunner.query(`DROP TABLE \`species\``);
    await queryRunner.query(`DROP TABLE \`v4p_jtype_sites\``);
    await queryRunner.query(`DROP TABLE \`site_units\``);
  }
}
