import { MigrationInterface, QueryRunner } from "typeorm";

import {
  type LegacyReservationRow,
  planLegacyBackfill,
} from "../../contexts/payments/domain/legacy-backfill";
import { PLATFORM_SETTING_DEFAULTS } from "../../contexts/payments/domain/platform-settings";
import { envs } from "../../contexts/shared/configs/envs";

// Hand-written. Payments F1 (economic model base):
// 1. platform_settings (typed key/value, seeded with A2/A6/A7/A19/A22 defaults)
// 2. reservation_price_lines (immutable, cents), reservation_snapshots (versioned),
//    payments (B3), refunds (B4), audit_log (append-only)
// 3. reservations: commission_rate, commission_cents, total_cents, currency,
//    snapshot_version, timezone (frozen at creation)
// 4. Idempotent backfill of existing reservations (planLegacyBackfill):
//    accommodation line, payment mapped from payment_status, refund if any,
//    snapshot v1 'legacy_backfill', commission from env COMMISSION_PERCENTAGE.
//    Only rows with snapshot_version IS NULL are touched; every insert is
//    guarded (INSERT IGNORE on unique keys / NOT EXISTS), so re-running it
//    (or running it after new F1 rows exist) never duplicates anything.

const BATCH_SIZE = 500;

const SETTINGS_SEED: readonly [string, string, string, string][] = [
  [
    "commission_rate",
    String(PLATFORM_SETTING_DEFAULTS.commission_rate),
    "number",
    "A2: comisión V4P sobre la base comisionable (0.12 = 12 %)",
  ],
  [
    "deadline_local_time",
    PLATFORM_SETTING_DEFAULTS.deadline_local_time,
    "string",
    "A6: hora local del deadline de cancelación gratuita",
  ],
  [
    "default_timezone",
    PLATFORM_SETTING_DEFAULTS.default_timezone,
    "string",
    "Timezone por defecto del alojamiento",
  ],
  [
    "available_after_checkout_hours",
    String(PLATFORM_SETTING_DEFAULTS.available_after_checkout_hours),
    "integer",
    "A19: horas tras checkout para quedar disponible para liquidar",
  ],
  [
    "regularization_window_hours",
    String(PLATFORM_SETTING_DEFAULTS.regularization_window_hours),
    "integer",
    "A7: ventana de regularización tras cobro fallido",
  ],
  [
    "payout_failure_days",
    String(PLATFORM_SETTING_DEFAULTS.payout_failure_days),
    "integer",
    "A22: días de payout fallido antes de escalar",
  ],
];

const ACTOR_ENUM = "'system','traveler','host','admin','stripe'";

export class PaymentsF1EconomicModel1791000000100 implements MigrationInterface {
  name = "PaymentsF1EconomicModel1791000000100";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- platform_settings -----------------------------------------------
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`platform_settings\` (
        \`key\` varchar(64) NOT NULL,
        \`value\` varchar(255) NOT NULL,
        \`value_type\` enum('string','number','integer') NOT NULL DEFAULT 'string',
        \`description\` varchar(255) NULL,
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
    );
    for (const [key, value, type, description] of SETTINGS_SEED) {
      await queryRunner.query(
        `INSERT IGNORE INTO \`platform_settings\` (\`key\`, \`value\`, \`value_type\`, \`description\`) VALUES (?, ?, ?, ?)`,
        [key, value, type, description],
      );
    }

    // --- reservation_price_lines --------------------------------------------
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`reservation_price_lines\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`reservation_id\` int NOT NULL,
        \`type\` enum('accommodation','board','dog_supplement','dog_service','additional_service','extra','tourist_tax','discount','adjustment') NOT NULL,
        \`description\` varchar(255) NOT NULL,
        \`quantity\` decimal(10,3) NOT NULL DEFAULT 1.000,
        \`unit_amount_cents\` int NOT NULL,
        \`amount_cents\` int NOT NULL,
        \`currency\` char(3) NOT NULL DEFAULT 'eur',
        \`is_optional\` tinyint NOT NULL DEFAULT 0,
        \`is_commissionable\` tinyint NOT NULL DEFAULT 1,
        \`is_penalizable\` tinyint NOT NULL DEFAULT 1,
        \`metadata\` json NULL,
        \`created_by_type\` enum(${ACTOR_ENUM}) NOT NULL DEFAULT 'system',
        \`created_by_id\` varchar(64) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`idx_price_lines_reservation\` (\`reservation_id\`),
        CONSTRAINT \`fk_price_lines_reservation\` FOREIGN KEY (\`reservation_id\`) REFERENCES \`reservations\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
    );

    // --- reservation_snapshots ------------------------------------------------
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`reservation_snapshots\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`reservation_id\` int NOT NULL,
        \`version\` int NOT NULL,
        \`reason\` varchar(64) NOT NULL,
        \`payload\` json NOT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_reservation_snapshots_version\` (\`reservation_id\`, \`version\`),
        CONSTRAINT \`fk_snapshots_reservation\` FOREIGN KEY (\`reservation_id\`) REFERENCES \`reservations\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
    );

    // --- payments ------------------------------------------------------------
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`payments\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`reservation_id\` int NOT NULL,
        \`type\` enum('charge') NOT NULL DEFAULT 'charge',
        \`status\` enum('method_validated','pending_charge','processing','paid','failed','pending_regularization','definitive_unpaid') NOT NULL,
        \`amount_cents\` int NOT NULL,
        \`currency\` char(3) NOT NULL DEFAULT 'eur',
        \`stripe_checkout_session_id\` varchar(255) NULL,
        \`stripe_payment_intent_id\` varchar(255) NULL,
        \`stripe_charge_id\` varchar(255) NULL,
        \`idempotency_key\` varchar(255) NOT NULL,
        \`failure_code\` varchar(128) NULL,
        \`failure_message\` text NULL,
        \`attempts\` int NOT NULL DEFAULT 0,
        \`paid_at\` datetime NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_payments_idempotency_key\` (\`idempotency_key\`),
        KEY \`idx_payments_reservation\` (\`reservation_id\`),
        KEY \`idx_payments_payment_intent\` (\`stripe_payment_intent_id\`),
        KEY \`idx_payments_checkout_session\` (\`stripe_checkout_session_id\`),
        CONSTRAINT \`fk_payments_reservation\` FOREIGN KEY (\`reservation_id\`) REFERENCES \`reservations\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
    );

    // --- refunds -------------------------------------------------------------
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`refunds\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`reservation_id\` int NOT NULL,
        \`payment_id\` int NULL,
        \`status\` enum('none','pending','processing','partial_completed','total_completed','failed') NOT NULL,
        \`amount_cents\` int NOT NULL,
        \`currency\` char(3) NOT NULL DEFAULT 'eur',
        \`reason\` varchar(128) NULL,
        \`requested_by_type\` enum(${ACTOR_ENUM}) NULL,
        \`requested_by_id\` varchar(64) NULL,
        \`approved_by_type\` enum(${ACTOR_ENUM}) NULL,
        \`approved_by_id\` varchar(64) NULL,
        \`responsible\` enum('host','platform','traveler') NULL,
        \`stripe_refund_id\` varchar(255) NULL,
        \`idempotency_key\` varchar(255) NOT NULL,
        \`failure_reason\` text NULL,
        \`completed_at\` datetime NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_refunds_idempotency_key\` (\`idempotency_key\`),
        UNIQUE KEY \`uq_refunds_stripe_refund\` (\`stripe_refund_id\`),
        KEY \`idx_refunds_reservation\` (\`reservation_id\`),
        KEY \`idx_refunds_payment\` (\`payment_id\`),
        CONSTRAINT \`fk_refunds_reservation\` FOREIGN KEY (\`reservation_id\`) REFERENCES \`reservations\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_refunds_payment\` FOREIGN KEY (\`payment_id\`) REFERENCES \`payments\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
    );

    // --- audit_log -----------------------------------------------------------
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`audit_log\` (
        \`id\` bigint NOT NULL AUTO_INCREMENT,
        \`entity\` varchar(32) NOT NULL,
        \`entity_id\` varchar(64) NOT NULL,
        \`action\` varchar(64) NOT NULL,
        \`actor_type\` enum(${ACTOR_ENUM}) NOT NULL,
        \`actor_id\` varchar(64) NULL,
        \`before\` json NULL,
        \`after\` json NULL,
        \`metadata\` json NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`idx_audit_log_entity\` (\`entity\`, \`entity_id\`),
        KEY \`idx_audit_log_created_at\` (\`created_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
    );

    // --- reservations: frozen economic fields ---------------------------------
    await queryRunner.query(
      `ALTER TABLE \`reservations\`
        ADD COLUMN IF NOT EXISTS \`commission_rate\` decimal(5,4) NULL,
        ADD COLUMN IF NOT EXISTS \`commission_cents\` int NULL,
        ADD COLUMN IF NOT EXISTS \`total_cents\` int NULL,
        ADD COLUMN IF NOT EXISTS \`currency\` char(3) NULL,
        ADD COLUMN IF NOT EXISTS \`snapshot_version\` int NULL,
        ADD COLUMN IF NOT EXISTS \`timezone\` varchar(64) NULL`,
    );

    await this.backfill(queryRunner);
  }

  private async backfill(queryRunner: QueryRunner): Promise<void> {
    const defaults = {
      commissionRate: envs.COMMISSION_PERCENTAGE,
      currency: envs.CURRENCY.toLowerCase(),
      timezone: PLATFORM_SETTING_DEFAULTS.default_timezone,
      deadlineLocalTime: PLATFORM_SETTING_DEFAULTS.deadline_local_time,
    };

    let lastId = 0;
    for (;;) {
      const rows = (await queryRunner.query(
        `SELECT r.id, r.site_id, r.room_id, r.source,
                DATE_FORMAT(r.checkin, '%Y-%m-%d') AS checkin,
                DATE_FORMAT(r.checkout, '%Y-%m-%d') AS checkout,
                r.guests, r.pets, r.subtotal, r.commission, r.total,
                r.status, r.payment_status, r.cancel_reason, r.amount_refunded,
                r.stripe_checkout_session_id, r.stripe_payment_intent_id,
                r.stripe_refund_id, r.paid_at, r.cancelled_at, r.created_at,
                r.updated_at, r.board_snapshot
           FROM \`reservations\` r
          WHERE r.snapshot_version IS NULL AND r.id > ?
          ORDER BY r.id ASC
          LIMIT ${BATCH_SIZE}`,
        [lastId],
      )) as LegacyReservationRow[];
      if (rows.length === 0) {
        break;
      }
      for (const row of rows) {
        await this.backfillReservation(queryRunner, row, defaults);
        lastId = row.id;
      }
    }
  }

  private async backfillReservation(
    queryRunner: QueryRunner,
    row: LegacyReservationRow,
    defaults: Parameters<typeof planLegacyBackfill>[1],
  ): Promise<void> {
    const plan = planLegacyBackfill(row, defaults);
    const id = plan.reservationId;

    // Lines: only if the reservation has none (F1 checkouts already have them).
    const existingLines = (await queryRunner.query(
      `SELECT COUNT(*) AS n FROM \`reservation_price_lines\` WHERE reservation_id = ?`,
      [id],
    )) as { n: number | string }[];
    if (Number(existingLines[0]?.n ?? 0) === 0) {
      for (const line of plan.lines) {
        await queryRunner.query(
          `INSERT INTO \`reservation_price_lines\`
             (reservation_id, type, description, quantity, unit_amount_cents, amount_cents,
              currency, is_optional, is_commissionable, is_penalizable, metadata, created_by_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system')`,
          [
            id,
            line.type,
            line.description,
            line.quantity,
            line.unit_amount_cents,
            line.amount_cents,
            plan.reservation.currency,
            line.is_optional ? 1 : 0,
            line.is_commissionable ? 1 : 0,
            line.is_penalizable ? 1 : 0,
            JSON.stringify(line.metadata ?? null),
          ],
        );
      }
    }

    let paymentId: number | null = null;
    if (plan.payment) {
      const payment = plan.payment;
      await queryRunner.query(
        `INSERT IGNORE INTO \`payments\`
           (reservation_id, type, status, amount_cents, currency, stripe_checkout_session_id,
            stripe_payment_intent_id, idempotency_key, failure_code, attempts, paid_at)
         SELECT ?, 'charge', ?, ?, ?, ?, ?, ?, ?, 1, ? FROM DUAL
          WHERE NOT EXISTS (SELECT 1 FROM \`payments\` WHERE reservation_id = ?)`,
        [
          id,
          payment.status,
          payment.amount_cents,
          plan.reservation.currency,
          payment.stripe_checkout_session_id,
          payment.stripe_payment_intent_id,
          payment.idempotency_key,
          payment.failure_code,
          payment.paid_at,
          id,
        ],
      );
      const found = (await queryRunner.query(
        `SELECT id FROM \`payments\` WHERE reservation_id = ? ORDER BY id ASC LIMIT 1`,
        [id],
      )) as { id: number }[];
      paymentId = found[0]?.id ?? null;
    }

    if (plan.refund) {
      const refund = plan.refund;
      await queryRunner.query(
        `INSERT IGNORE INTO \`refunds\`
           (reservation_id, payment_id, status, amount_cents, currency, reason,
            requested_by_type, responsible, stripe_refund_id, idempotency_key, completed_at)
         SELECT ?, ?, ?, ?, ?, ?, 'system', NULL, ?, ?, ? FROM DUAL
          WHERE NOT EXISTS (SELECT 1 FROM \`refunds\` WHERE reservation_id = ?)`,
        [
          id,
          paymentId,
          refund.status,
          refund.amount_cents,
          plan.reservation.currency,
          refund.reason.slice(0, 128),
          refund.stripe_refund_id,
          refund.idempotency_key,
          refund.completed_at,
          id,
        ],
      );
    }

    const snapshotInsert = (await queryRunner.query(
      `INSERT IGNORE INTO \`reservation_snapshots\` (reservation_id, version, reason, payload)
       VALUES (?, 1, 'legacy_backfill', ?)`,
      [id, JSON.stringify(plan.snapshot)],
    )) as { affectedRows?: number };

    if (snapshotInsert.affectedRows === 1) {
      await queryRunner.query(
        `INSERT INTO \`audit_log\` (entity, entity_id, action, actor_type, actor_id, after, metadata)
         VALUES ('reservation', ?, 'reservation.legacy_backfill', 'system', 'migration:1791000000100', ?, ?)`,
        [
          String(id),
          JSON.stringify(plan.reservation),
          JSON.stringify({
            payment_status: row.payment_status,
            status: row.status,
            payment: plan.payment?.status ?? null,
            refund: plan.refund?.status ?? null,
          }),
        ],
      );
    }

    await queryRunner.query(
      `UPDATE \`reservations\`
          SET commission_rate = COALESCE(commission_rate, ?),
              commission_cents = COALESCE(commission_cents, ?),
              total_cents = COALESCE(total_cents, ?),
              currency = COALESCE(currency, ?),
              timezone = COALESCE(timezone, ?),
              snapshot_version = COALESCE(snapshot_version,
                (SELECT MAX(version) FROM \`reservation_snapshots\` WHERE reservation_id = ?))
        WHERE id = ?`,
      [
        plan.reservation.commission_rate,
        plan.reservation.commission_cents,
        plan.reservation.total_cents,
        plan.reservation.currency,
        plan.reservation.timezone,
        id,
        id,
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`reservations\`
        DROP COLUMN IF EXISTS \`timezone\`,
        DROP COLUMN IF EXISTS \`snapshot_version\`,
        DROP COLUMN IF EXISTS \`currency\`,
        DROP COLUMN IF EXISTS \`total_cents\`,
        DROP COLUMN IF EXISTS \`commission_cents\`,
        DROP COLUMN IF EXISTS \`commission_rate\``,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS \`audit_log\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`refunds\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`payments\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`reservation_snapshots\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`reservation_price_lines\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`platform_settings\``);
  }
}
