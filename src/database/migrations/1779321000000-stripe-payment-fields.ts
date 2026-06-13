import { MigrationInterface, QueryRunner } from "typeorm";

export class StripePaymentFields1779321000000 implements MigrationInterface {
  name = "StripePaymentFields1779321000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD "stripe_checkout_session_id" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD "stripe_payment_intent_id" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD "paid_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `CREATE TABLE "stripe_webhook_events" ("stripe_event_id" text NOT NULL, "type" text NOT NULL, "payload" jsonb, "processed_at" TIMESTAMP NOT NULL, "reservation_id" integer, CONSTRAINT "PK_stripe_webhook_events" PRIMARY KEY ("stripe_event_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_stripe_webhook_events_stripe_event_id" ON "stripe_webhook_events" ("stripe_event_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_stripe_webhook_events_stripe_event_id"`,
    );
    await queryRunner.query(`DROP TABLE "stripe_webhook_events"`);
    await queryRunner.query(`ALTER TABLE "reservations" DROP COLUMN "paid_at"`);
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP COLUMN "stripe_payment_intent_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP COLUMN "stripe_checkout_session_id"`,
    );
  }
}
