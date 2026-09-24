import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity("stripe_webhook_events")
export class StripeWebhookEventEntity {
  @PrimaryColumn({ type: "varchar", length: 255 })
  stripe_event_id!: string;

  @Column({ type: "varchar", length: 255 })
  type!: string;

  @Column({ type: "json", nullable: true })
  payload?: Record<string, unknown>;

  @Column({ type: "timestamp" })
  processed_at!: Date;

  @Column({ type: "int", nullable: true })
  reservation_id?: number;
}
