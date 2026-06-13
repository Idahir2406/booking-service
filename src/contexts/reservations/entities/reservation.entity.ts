import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export const source_values = ["internal", "airbnb", "booking", "vrbo"] as const;
export type SourceValue = (typeof source_values)[number];
export const status_values = ["pending", "confirmed", "cancelled"] as const;
export type StatusValue = (typeof status_values)[number];
export const payment_status_values = ["pending", "paid", "refunded"] as const;
export type PaymentStatusValue = (typeof payment_status_values)[number];
@Entity("reservations")
export class ReservationEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  site_id!: number;

  @Column({ type: "enum", enum: source_values })
  source!: SourceValue;

  @Column({ type: "text", nullable: true })
  external_reservation_id?: string;

  @Column({ type: "int" })
  user_id!: number;

  @Column({ type: "date" })
  checkin!: string;

  @Column({ type: "date" })
  checkout!: string;

  @Column({ type: "int" })
  guests!: number;

  @Column({ type: "int" })
  pets!: number;

  @Column({ type: "numeric", nullable: true })
  subtotal!: number;

  @Column({ type: "numeric", nullable: true })
  commission!: number;

  @Column({ type: "numeric", nullable: true })
  total!: number;

  @Column({ type: "enum", enum: status_values })
  status!: StatusValue;

  @Column({ type: "enum", enum: payment_status_values })
  payment_status!: PaymentStatusValue;

  @Column({ type: "timestamp" })
  expiration_date!: Date;

  @Column({ type: "text", nullable: true })
  stripe_checkout_session_id?: string;

  @Column({ type: "text", nullable: true })
  stripe_payment_intent_id?: string;

  @Column({ type: "timestamp", nullable: true })
  paid_at?: Date;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
