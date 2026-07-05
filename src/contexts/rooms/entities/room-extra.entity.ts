import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";

import type { RoomEntity } from "./room.entity";

export const extra_pricing_mode_values = [
  "per_night",
  "per_night_per_guest",
  "per_stay",
] as const;
export type ExtraPricingModeValue = (typeof extra_pricing_mode_values)[number];

@Entity("room_extras")
@Index("idx_room_extras_room_id", ["room_id"])
export class RoomExtraEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  room_id!: string;

  @ManyToOne("RoomEntity", { onDelete: "CASCADE" })
  @JoinColumn({ name: "room_id" })
  room!: RoomEntity;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text", nullable: true })
  description?: string;

  @Column({ type: "enum", enum: extra_pricing_mode_values })
  pricing_mode!: ExtraPricingModeValue;

  @Column({ type: "numeric", default: 0 })
  price!: number;

  @Column({ type: "boolean", default: true })
  is_active!: boolean;

  @Column({ type: "int", default: 0 })
  sort_order!: number;
}
