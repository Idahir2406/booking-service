import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";

import type { RoomEntity } from "./room.entity";

export const board_type_values = [
  "room_only",
  "breakfast_included",
  "half_board",
  "full_board",
  "all_inclusive",
] as const;
export type BoardTypeValue = (typeof board_type_values)[number];

@Entity("room_board_options")
@Index("idx_room_board_options_room_id", ["room_id"])
export class RoomBoardOptionEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  room_id!: string;

  @ManyToOne("RoomEntity", { onDelete: "CASCADE" })
  @JoinColumn({ name: "room_id" })
  room!: RoomEntity;

  @Column({ type: "text" })
  code!: BoardTypeValue;

  @Column({ type: "text", nullable: true })
  description?: string | null;

  @Column({ type: "numeric", default: 0 })
  price!: number;

  @Column({ type: "boolean", default: false })
  is_included!: boolean;

  @Column({ type: "boolean", default: false })
  is_default!: boolean;

  @Column({ type: "boolean", default: true })
  is_active!: boolean;

  @Column({ type: "int", default: 0 })
  sort_order!: number;
}
