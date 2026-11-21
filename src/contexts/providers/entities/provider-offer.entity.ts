import type {
  ProviderCancellationPolicy,
  ProviderTax,
} from "../domain/provider.types";

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

import { decimalTransformer } from "../../payments/entities/decimal.transformer";

/**
 * Offer frozen at quote time (prebook) for a provider reservation: net
 * price, V4P markup, cancellation policy and taxes paid at the property.
 * Cancellation penalties are computed from `cancellation_json`.
 */
@Entity("provider_offers")
@Index("idx_provider_offers_reservation", ["reservation_id"])
@Index("idx_provider_offers_prebook", ["prebook_id"])
export class ProviderOfferEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  /** reservations.id (null until the pending reservation exists). */
  @Column({ type: "int", nullable: true })
  reservation_id?: number | null;

  @Column({ type: "varchar", length: 32 })
  provider!: string;

  @Column({ type: "varchar", length: 64, nullable: true })
  provider_hotel_id?: string | null;

  /** Nuitee offer ids are long opaque strings. */
  @Column({ type: "text" })
  offer_id!: string;

  @Column({ type: "varchar", length: 128, nullable: true })
  prebook_id?: string | null;

  @Column({ type: "datetime", nullable: true })
  prebook_at?: Date | null;

  /** Best-effort prebook validity (provider does not always say). */
  @Column({ type: "datetime", nullable: true })
  expires_at?: Date | null;

  @Column({ type: "int" })
  net_cents!: number;

  @Column({ type: "int" })
  sell_cents!: number;

  @Column({ type: "int" })
  markup_cents!: number;

  @Column({
    type: "decimal",
    precision: 5,
    scale: 4,
    nullable: true,
    transformer: decimalTransformer,
  })
  markup_rate?: number | null;

  @Column({ type: "char", length: 3 })
  currency!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  room_name?: string | null;

  @Column({ type: "varchar", length: 16, nullable: true })
  board_code?: string | null;

  @Column({ type: "varchar", length: 128, nullable: true })
  board_name?: string | null;

  @Column({ type: "boolean", default: false })
  refundable!: boolean;

  @Column({ type: "json" })
  cancellation_json!: ProviderCancellationPolicy[];

  @Column({ type: "json" })
  taxes_not_included_json!: ProviderTax[];

  @Column({ type: "json", nullable: true })
  raw_prebook_json?: object | null;

  @CreateDateColumn({ type: "datetime", precision: 6 })
  created_at!: Date;
}
