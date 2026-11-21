import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * Provider webhook deliveries (Nuitee/LiteAPI), deduplicated by
 * (provider, event_id). Same lifecycle as stripe_webhook_events:
 * received -> processing -> processed | failed (a failed row is retried on
 * the next delivery of the same event).
 */
export const PROVIDER_WEBHOOK_STATUS = {
  RECEIVED: "received",
  PROCESSING: "processing",
  PROCESSED: "processed",
  FAILED: "failed",
  /** Valid delivery we do not act on (unknown booking / event). */
  IGNORED: "ignored",
} as const;

export type ProviderWebhookStatus =
  (typeof PROVIDER_WEBHOOK_STATUS)[keyof typeof PROVIDER_WEBHOOK_STATUS];

export const provider_webhook_status_values = Object.values(
  PROVIDER_WEBHOOK_STATUS,
);

@Entity("provider_webhook_events")
@Index("uq_provider_webhook_events_event", ["provider", "event_id"], {
  unique: true,
})
@Index("idx_provider_webhook_events_booking", ["booking_id"])
export class ProviderWebhookEventEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "varchar", length: 32 })
  provider!: string;

  /** Nuitee event_id, or sha256 of the raw body when it has none. */
  @Column({ type: "varchar", length: 128 })
  event_id!: string;

  @Column({ type: "varchar", length: 128 })
  event_type!: string;

  @Column({ type: "varchar", length: 128, nullable: true })
  booking_id?: string | null;

  @Column({ type: "int", nullable: true })
  reservation_id?: number | null;

  @Column({
    type: "enum",
    enum: provider_webhook_status_values,
    default: PROVIDER_WEBHOOK_STATUS.RECEIVED,
  })
  status!: ProviderWebhookStatus;

  /** Authentication token and/or request signature verified. */
  @Column({ type: "boolean", default: false })
  signature_verified!: boolean;

  @Column({ type: "int", default: 0 })
  attempts!: number;

  @Column({ type: "text", nullable: true })
  last_error?: string | null;

  @Column({ type: "json", nullable: true })
  payload?: unknown;

  @Column({ type: "datetime", nullable: true })
  received_at?: Date | null;

  @Column({ type: "datetime", nullable: true })
  processed_at?: Date | null;
}
