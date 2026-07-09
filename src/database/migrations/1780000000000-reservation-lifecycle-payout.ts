import { MigrationInterface, QueryRunner } from "typeorm";

export class ReservationLifecyclePayout1780000000000 implements MigrationInterface {
  name = "ReservationLifecyclePayout1780000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."reservations_status_enum" ADD VALUE IF NOT EXISTS 'finalized'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."reservations_payment_status_enum" ADD VALUE IF NOT EXISTS 'partially_refunded'`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."reservations_payout_status_enum" AS ENUM('held', 'released', 'blocked')`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD "payout_status" "public"."reservations_payout_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD "finalized_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD "feedback_deadline_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD "payout_released_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD "stripe_transfer_id" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD "stripe_refund_id" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD "cancelled_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD "cancel_reason" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD "refund_on_cancel" boolean`,
    );

    // Legacy: reservas ya pagadas antes del cambio tenían transfer inmediato
    await queryRunner.query(
      `UPDATE "reservations" SET "payout_status" = 'released' WHERE "status" = 'confirmed' AND "payment_status" = 'paid' AND "payout_status" IS NULL`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."reservation_guest_feedback_type_enum" AS ENUM('review', 'report')`,
    );
    await queryRunner.query(
      `CREATE TABLE "reservation_guest_feedback" ("id" SERIAL NOT NULL, "reservation_id" integer NOT NULL, "type" "public"."reservation_guest_feedback_type_enum" NOT NULL, "rating" integer, "comment" text, "report_reason" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_reservation_guest_feedback" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_guest_feedback_reservation" ON "reservation_guest_feedback" ("reservation_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "reservation_feedback_tokens" ("id" SERIAL NOT NULL, "reservation_id" integer NOT NULL, "token_hash" text NOT NULL, "expires_at" TIMESTAMP NOT NULL, "used_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_reservation_feedback_tokens" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_feedback_tokens_reservation" ON "reservation_feedback_tokens" ("reservation_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_feedback_tokens_hash" ON "reservation_feedback_tokens" ("token_hash")`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."reservation_disputes_status_enum" AS ENUM('open', 'resolved_release', 'resolved_refund')`,
    );
    await queryRunner.query(
      `CREATE TABLE "reservation_disputes" ("id" SERIAL NOT NULL, "reservation_id" integer NOT NULL, "status" "public"."reservation_disputes_status_enum" NOT NULL DEFAULT 'open', "guest_report" text, "admin_notes" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_reservation_disputes" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_disputes_reservation" ON "reservation_disputes" ("reservation_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "reservation_events" ("id" SERIAL NOT NULL, "reservation_id" integer NOT NULL, "event_type" text NOT NULL, "payload" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_reservation_events" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_reservation_events_reservation" ON "reservation_events" ("reservation_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_reservation_events_reservation"`,
    );
    await queryRunner.query(`DROP TABLE "reservation_events"`);
    await queryRunner.query(`DROP INDEX "public"."idx_disputes_reservation"`);
    await queryRunner.query(`DROP TABLE "reservation_disputes"`);
    await queryRunner.query(
      `DROP TYPE "public"."reservation_disputes_status_enum"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_feedback_tokens_hash"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_feedback_tokens_reservation"`,
    );
    await queryRunner.query(`DROP TABLE "reservation_feedback_tokens"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_guest_feedback_reservation"`,
    );
    await queryRunner.query(`DROP TABLE "reservation_guest_feedback"`);
    await queryRunner.query(
      `DROP TYPE "public"."reservation_guest_feedback_type_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP COLUMN "refund_on_cancel"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP COLUMN "cancel_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP COLUMN "cancelled_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP COLUMN "stripe_refund_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP COLUMN "stripe_transfer_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP COLUMN "payout_released_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP COLUMN "feedback_deadline_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP COLUMN "finalized_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP COLUMN "payout_status"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."reservations_payout_status_enum"`,
    );
  }
}
