import { config } from "dotenv";
import mysql from "mysql2/promise";
import { MigrationInterface, QueryRunner } from "typeorm";

config();

function parseSiteNightlyRate(precio: string | null | undefined): number {
  if (!precio) {
    return 0;
  }
  const cleaned = precio.replaceAll(/[^\d.,]/g, "").replace(",", ".");
  const rate = Number.parseFloat(cleaned);
  if (!Number.isFinite(rate) || rate <= 0) {
    return 0;
  }
  return rate;
}

async function fetchSitePrices(
  siteIds: number[],
): Promise<Map<number, number>> {
  const priceMap = new Map<number, number>();
  if (siteIds.length === 0) {
    return priceMap;
  }

  const prefix = process.env.DB_PREFIX ?? "v4p_j";
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    waitForConnections: true,
    connectionLimit: 2,
  });

  try {
    const placeholders = siteIds.map(() => "?").join(", ");
    const [rows] = await pool.query(
      `SELECT id, precio FROM ${prefix}sites1 WHERE id IN (${placeholders})`,
      siteIds,
    );
    for (const row of rows as { id: number; precio: string | null }[]) {
      priceMap.set(Number(row.id), parseSiteNightlyRate(row.precio));
    }
  } finally {
    await pool.end();
  }

  return priceMap;
}

export class RoomsAndRoomId1779400000000 implements MigrationInterface {
  name = "RoomsAndRoomId1779400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "rooms" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "site_id" integer NOT NULL,
        "name" text NOT NULL,
        "description" text,
        "price_per_night" numeric NOT NULL,
        "max_guests" integer NOT NULL DEFAULT 2,
        "max_pets" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        "image1" text,
        "image2" text,
        "image3" text,
        "image4" text,
        "image5" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rooms_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_rooms_site_id" ON "rooms" ("site_id")`,
    );

    await queryRunner.query(`ALTER TABLE "availability" ADD "room_id" uuid`);
    await queryRunner.query(`ALTER TABLE "blocks" ADD "room_id" uuid`);
    await queryRunner.query(`ALTER TABLE "reservations" ADD "room_id" uuid`);

    const siteRows = (await queryRunner.query(
      `SELECT DISTINCT site_id FROM availability
       UNION
       SELECT DISTINCT site_id FROM blocks
       UNION
       SELECT DISTINCT site_id FROM reservations`,
    )) as { site_id: number }[];

    const siteIds = [
      ...new Set(siteRows.map(row => Number(row.site_id)).filter(id => id > 0)),
    ];
    const priceMap = await fetchSitePrices(siteIds);

    const roomIdBySite = new Map<number, string>();

    for (const siteId of siteIds) {
      const price = priceMap.get(siteId) ?? 0;
      const insertResult = (await queryRunner.query(
        `INSERT INTO "rooms" ("site_id", "name", "price_per_night", "max_guests", "max_pets", "is_active", "sort_order")
         VALUES ($1, $2, $3, $4, $5, true, 0)
         RETURNING "id"`,
        [siteId, "Habitación principal", price, 2, 0],
      )) as { id: string }[];
      roomIdBySite.set(siteId, insertResult[0].id);
    }

    for (const [siteId, roomId] of roomIdBySite) {
      await queryRunner.query(
        `UPDATE "availability" SET "room_id" = $1 WHERE "site_id" = $2 AND "room_id" IS NULL`,
        [roomId, siteId],
      );
      await queryRunner.query(
        `UPDATE "blocks" SET "room_id" = $1 WHERE "site_id" = $2 AND "room_id" IS NULL`,
        [roomId, siteId],
      );
      await queryRunner.query(
        `UPDATE "reservations" SET "room_id" = $1 WHERE "site_id" = $2 AND "room_id" IS NULL`,
        [roomId, siteId],
      );
    }

    await queryRunner.query(
      `ALTER TABLE "availability" ALTER COLUMN "room_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "blocks" ALTER COLUMN "room_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ALTER COLUMN "room_id" SET NOT NULL`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_availability_site_room_date" ON "availability" ("site_id", "room_id", "date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_blocks_site_room_dates" ON "blocks" ("site_id", "room_id", "start_date", "end_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_reservations_site_room" ON "reservations" ("site_id", "room_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_reservations_site_room"`);
    await queryRunner.query(`DROP INDEX "public"."idx_blocks_site_room_dates"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_availability_site_room_date"`,
    );
    await queryRunner.query(`ALTER TABLE "reservations" DROP COLUMN "room_id"`);
    await queryRunner.query(`ALTER TABLE "blocks" DROP COLUMN "room_id"`);
    await queryRunner.query(`ALTER TABLE "availability" DROP COLUMN "room_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_rooms_site_id"`);
    await queryRunner.query(`DROP TABLE "rooms"`);
  }
}
