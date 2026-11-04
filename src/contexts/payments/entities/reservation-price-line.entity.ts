import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

import { ACTOR_TYPES, type ActorType } from "../domain/audit-actor";
import { decimalTransformer } from "./decimal.transformer";

export const PRICE_LINE_TYPE = {
  ACCOMMODATION: "accommodation",
  BOARD: "board",
  DOG_SUPPLEMENT: "dog_supplement",
  DOG_SERVICE: "dog_service",
  ADDITIONAL_SERVICE: "additional_service",
  EXTRA: "extra",
  TOURIST_TAX: "tourist_tax",
  DISCOUNT: "discount",
  ADJUSTMENT: "adjustment",
} as const;

export type PriceLineType =
  (typeof PRICE_LINE_TYPE)[keyof typeof PRICE_LINE_TYPE];

export const PRICE_LINE_TYPES = Object.values(PRICE_LINE_TYPE);

/** Only these types may carry a negative amount. */
export const NEGATIVE_ALLOWED_LINE_TYPES: readonly PriceLineType[] = [
  PRICE_LINE_TYPE.DISCOUNT,
  PRICE_LINE_TYPE.ADJUSTMENT,
];

/**
 * Immutable price breakdown line (A3/A4/B2). Never updated or deleted:
 * corrections are NEW `adjustment`/`discount` lines (B14).
 */
@Entity("reservation_price_lines")
@Index("idx_price_lines_reservation", ["reservation_id"])
export class ReservationPriceLineEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  reservation_id!: number;

  @Column({ type: "enum", enum: PRICE_LINE_TYPES })
  type!: PriceLineType;

  @Column({ type: "varchar", length: 255 })
  description!: string;

  @Column({
    type: "decimal",
    precision: 10,
    scale: 3,
    default: 1,
    transformer: decimalTransformer,
  })
  quantity!: number;

  @Column({ type: "int" })
  unit_amount_cents!: number;

  @Column({ type: "int" })
  amount_cents!: number;

  @Column({ type: "char", length: 3, default: "eur" })
  currency!: string;

  @Column({ type: "boolean", default: false })
  is_optional!: boolean;

  @Column({ type: "boolean", default: true })
  is_commissionable!: boolean;

  @Column({ type: "boolean", default: true })
  is_penalizable!: boolean;

  @Column({ type: "json", nullable: true })
  metadata?: Record<string, unknown> | null;

  @Column({ type: "enum", enum: ACTOR_TYPES, default: "system" })
  created_by_type!: ActorType;

  @Column({ type: "varchar", length: 64, nullable: true })
  created_by_id?: string | null;

  @CreateDateColumn({ type: "datetime", precision: 6 })
  created_at!: Date;
}
