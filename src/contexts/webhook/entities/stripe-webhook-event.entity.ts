import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity("stripe_webhook_events")
export class StripeWebhookEventEntity {
  @PrimaryColumn({ type: "text" })
  stripe_event_id!: string;

  @Column({ type: "text" })
  type!: string;

  @Column({ type: "jsonb", nullable: true })
  payload?: Record<string, unknown>;

  @Column({ type: "timestamp" })
  processed_at!: Date;

  @Column({ type: "int", nullable: true })
  reservation_id?: number;
}
