import type { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. External accommodation providers, phase 1
// (Nuitee / LiteAPI, plan scalable-discovering-riddle):
// 1. provider_properties: v4p_jsites1 profile <-> provider hotel id.
// 2. provider_offers: offer frozen at quote/prebook (net, markup, sell,
//    cancellation policy, taxes paid at the property).
// 3. reservations: source enum gains 'nuitee'; provider_status,
//    client_reference (UNIQUE, V4P-<id>), provider_booking_json.
// 4. v4p_jsites1.profile_mode (varchar(10)) accepts 'provider': only the
//    admino manualoption list changes (legacy|booking|provider).
// 5. platform_settings.provider_markup_rate (key/value row, fraction).
// down: drops everything above and restores the enum/options (the enum
// change fails while 'nuitee' reservations exist, on purpose).

const SOURCE_WITH = "'internal','airbnb','booking','vrbo','nuitee'";
const SOURCE_WITHOUT = "'internal','airbnb','booking','vrbo'";

const RESERVATION_COLUMNS: readonly (readonly [column: string, ddl: string])[] =
  [
    [
      "provider_status",
      "enum('prebooked','booking','confirmed','failed','cancelled') NULL",
    ],
    ["client_reference", "varchar(64) NULL"],
    ["provider_booking_json", "json NULL"],
  ];
const CLIENT_REFERENCE_INDEX = "uq_reservations_client_reference";

const JTABLES = "v4p_jtables";
const CUSTOMER = "v4p";
const SITES_DBTABLE = "jsites1";
const PROFILE_MODE = "profile_mode";
const PROFILE_OPTIONS_WITH = "legacy|booking|provider";
const PROFILE_OPTIONS_WITHOUT = "legacy|booking";
const PROFILE_NAME_WITH =
  "MODO PERFIL (legacy = clásico sin reservas · booking = sistema de reservas · provider = hotel de proveedor externo)";
const PROFILE_NAME_WITHOUT =
  "MODO PERFIL (legacy = clásico sin reservas · booking = sistema de reservas)";

const MARKUP_KEY = "provider_markup_rate";
const MARKUP_DEFAULT = "0.15";

export class ProviderNuiteeBase1791500000017 implements MigrationInterface {
  name = "ProviderNuiteeBase1791500000017";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- 1. provider_properties -------------------------------------------
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`provider_properties\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`provider\` varchar(32) NOT NULL,
        \`provider_hotel_id\` varchar(64) NOT NULL,
        \`site_id\` int NOT NULL,
        \`status\` enum('draft','active','paused','delisted') NOT NULL DEFAULT 'draft',
        \`pets_snapshot\` json NULL,
        \`content_snapshot\` json NULL,
        \`last_synced_at\` datetime NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_provider_properties_site\` (\`site_id\`),
        UNIQUE KEY \`uq_provider_properties_provider_hotel\` (\`provider\`, \`provider_hotel_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
    );

    // --- 2. provider_offers ---------------------------------------------------
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`provider_offers\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`reservation_id\` int NULL,
        \`provider\` varchar(32) NOT NULL,
        \`provider_hotel_id\` varchar(64) NULL,
        \`offer_id\` text NOT NULL,
        \`prebook_id\` varchar(128) NULL,
        \`prebook_at\` datetime NULL,
        \`expires_at\` datetime NULL,
        \`net_cents\` int NOT NULL,
        \`sell_cents\` int NOT NULL,
        \`markup_cents\` int NOT NULL,
        \`markup_rate\` decimal(5,4) NULL,
        \`currency\` char(3) NOT NULL,
        \`room_name\` varchar(255) NULL,
        \`board_code\` varchar(16) NULL,
        \`board_name\` varchar(128) NULL,
        \`refundable\` tinyint NOT NULL DEFAULT 0,
        \`cancellation_json\` json NOT NULL,
        \`taxes_not_included_json\` json NOT NULL,
        \`raw_prebook_json\` json NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`idx_provider_offers_reservation\` (\`reservation_id\`),
        KEY \`idx_provider_offers_prebook\` (\`prebook_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
    );

    // --- 3. reservations ------------------------------------------------------
    // MODIFY with the full list is idempotent (re-running is a no-op).
    await queryRunner.query(
      `ALTER TABLE \`reservations\` MODIFY \`source\` enum(${SOURCE_WITH}) NOT NULL`,
    );
    for (const [column, ddl] of RESERVATION_COLUMNS) {
      if (!(await this.columnExists(queryRunner, "reservations", column))) {
        await queryRunner.query(
          `ALTER TABLE \`reservations\` ADD COLUMN \`${column}\` ${ddl}`,
        );
      }
    }
    if (
      !(await this.indexExists(
        queryRunner,
        "reservations",
        CLIENT_REFERENCE_INDEX,
      ))
    ) {
      await queryRunner.query(
        `CREATE UNIQUE INDEX \`${CLIENT_REFERENCE_INDEX}\` ON \`reservations\` (\`client_reference\`)`,
      );
    }

    // --- 4. v4p_jsites1.profile_mode: 'provider' option -------------------------
    await queryRunner.query(
      `UPDATE \`${JTABLES}\`
          SET \`description\` = ?, \`name\` = ?
        WHERE \`customer\` = ? AND \`dbtable\` = ? AND \`namesql\` = ?
          AND \`type\` = 'manualoption' AND \`description\` = ?`,
      [
        PROFILE_OPTIONS_WITH,
        PROFILE_NAME_WITH,
        CUSTOMER,
        SITES_DBTABLE,
        PROFILE_MODE,
        PROFILE_OPTIONS_WITHOUT,
      ],
    );

    // --- 5. platform_settings.provider_markup_rate -----------------------------
    await queryRunner.query(
      `INSERT IGNORE INTO \`platform_settings\` (\`key\`, \`value\`, \`value_type\`, \`description\`) VALUES (?, ?, 'number', ?)`,
      [
        MARKUP_KEY,
        MARKUP_DEFAULT,
        "Margen V4P sobre la tarifa neta del proveedor (Nuitee). Fracción: 0.15 = 15 %",
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM \`platform_settings\` WHERE \`key\` = ?`,
      [MARKUP_KEY],
    );

    await queryRunner.query(
      `UPDATE \`${JTABLES}\`
          SET \`description\` = ?, \`name\` = ?
        WHERE \`customer\` = ? AND \`dbtable\` = ? AND \`namesql\` = ?
          AND \`type\` = 'manualoption' AND \`description\` = ?`,
      [
        PROFILE_OPTIONS_WITHOUT,
        PROFILE_NAME_WITHOUT,
        CUSTOMER,
        SITES_DBTABLE,
        PROFILE_MODE,
        PROFILE_OPTIONS_WITH,
      ],
    );

    if (
      await this.indexExists(
        queryRunner,
        "reservations",
        CLIENT_REFERENCE_INDEX,
      )
    ) {
      await queryRunner.query(
        `DROP INDEX \`${CLIENT_REFERENCE_INDEX}\` ON \`reservations\``,
      );
    }
    for (const [column] of [...RESERVATION_COLUMNS].reverse()) {
      if (await this.columnExists(queryRunner, "reservations", column)) {
        await queryRunner.query(
          `ALTER TABLE \`reservations\` DROP COLUMN \`${column}\``,
        );
      }
    }
    await queryRunner.query(
      `ALTER TABLE \`reservations\` MODIFY \`source\` enum(${SOURCE_WITHOUT}) NOT NULL`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS \`provider_offers\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`provider_properties\``);
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

  private async indexExists(
    queryRunner: QueryRunner,
    table: string,
    index: string,
  ): Promise<boolean> {
    const rows = (await queryRunner.query(
      `SELECT 1 FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
      [table, index],
    )) as unknown[];
    return rows.length > 0;
  }
}
