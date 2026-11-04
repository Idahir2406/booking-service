import { Column, Entity, PrimaryColumn } from "typeorm";

/**
 * Webhook event lifecycle (F0):
 * - received   → row created, not yet processed
 * - processing → a worker holds the lease (see WEBHOOK_PROCESSING_LEASE_MS)
 * - processed  → side effects committed; further deliveries are skipped
 * - failed     → last attempt threw; next Stripe retry reprocesses it
 */
export const WEBHOOK_EVENT_STATUS = {
  RECEIVED: "received",
  PROCESSING: "processing",
  PROCESSED: "processed",
  FAILED: "failed",
} as const;

export type WebhookEventStatus =
  (typeof WEBHOOK_EVENT_STATUS)[keyof typeof WEBHOOK_EVENT_STATUS];

export const webhook_event_status_values = Object.values(WEBHOOK_EVENT_STATUS);

@Entity("stripe_webhook_events")
export class StripeWebhookEventEntity {
  @PrimaryColumn({ type: "varchar", length: 255 })
  stripe_event_id!: string;

  @Column({ type: "varchar", length: 255 })
  type!: string;

  @Column({ type: "json", nullable: true })
  payload?: Record<string, unknown>;

  @Column({
    type: "enum",
    enum: webhook_event_status_values,
    default: WEBHOOK_EVENT_STATUS.RECEIVED,
  })
  status!: WebhookEventStatus;

  @Column({ type: "int", default: 0 })
  attempts!: number;

  @Column({ type: "text", nullable: true })
  last_error?: string | null;

  @Column({ type: "timestamp", nullable: true })
  processed_at?: Date | null;

  @Column({ type: "datetime", nullable: true })
  processing_started_at?: Date | null;

  @Column({ type: "datetime", nullable: true })
  received_at?: Date | null;

  @Column({ type: "int", nullable: true })
  reservation_id?: number;
}
