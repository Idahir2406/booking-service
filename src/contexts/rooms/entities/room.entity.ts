import type { SiteUnitEntity } from "@/contexts/site-unit/entities/site-unit.entity";

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import { RoomBoardOptionEntity } from "./room-board-option.entity";
import { RoomExtraEntity } from "./room-extra.entity";

@Entity("rooms")
@Index("idx_rooms_site_id", ["site_id"])
export class RoomEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  site_id!: number;

  // Unit type (catalog); null until the host classifies the unit
  @Column({ type: "int", nullable: true })
  site_unit_id!: number | null;

  @ManyToOne("SiteUnitEntity", { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "site_unit_id" })
  site_unit!: SiteUnitEntity | null;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text", nullable: true })
  description?: string;

  @Column({ type: "decimal", precision: 10, scale: 2 })
  price_per_night!: number;

  @Column({ type: "int" })
  max_guests!: number;

  @Column({ type: "int", default: 0 })
  max_pets!: number;

  @Column({ type: "boolean", default: true })
  is_active!: boolean;

  @Column({ type: "int", default: 0 })
  sort_order!: number;

  @Column({ type: "text", nullable: true })
  image1?: string;

  @Column({ type: "text", nullable: true })
  image2?: string;

  @Column({ type: "text", nullable: true })
  image3?: string;

  @Column({ type: "text", nullable: true })
  image4?: string;

  @Column({ type: "text", nullable: true })
  image5?: string;

  @OneToMany(() => RoomBoardOptionEntity, option => option.room)
  board_options!: RoomBoardOptionEntity[];

  @OneToMany(() => RoomExtraEntity, extra => extra.room)
  extras!: RoomExtraEntity[];

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
