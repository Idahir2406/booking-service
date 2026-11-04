import type { MigrationInterface, QueryRunner } from "typeorm";

const TABLE = "traveler_dogs";

// Hand-written, idempotent. Panel del viajero (F-PV5, D1 = B): saved dogs of
// a traveler. user_id points to v4p_juser_profiles.id WITHOUT FK on purpose
// (legacy table owned by PHP; same exception as site_settings.site_id).
// photo_path stores only the random storage key of a file kept by PHP
// outside the public web root (D5); the browser never sees a real path.
export class TravelerDogs1791300000000 implements MigrationInterface {
  name = "TravelerDogs1791300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`${TABLE}\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`user_id\` int NOT NULL COMMENT 'v4p_juser_profiles.id (no FK: legacy table owned by PHP)',
        \`name\` varchar(60) NOT NULL,
        \`weight_kg\` decimal(5,2) NOT NULL,
        \`is_ppp\` tinyint NOT NULL DEFAULT 0,
        \`photo_path\` varchar(255) NULL COMMENT 'storage key of the private photo kept by PHP',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\` datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_traveler_dogs_user\` (\`user_id\`, \`deleted_at\`)
      ) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`${TABLE}\``);
  }
}
