import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("blocks")
@Index("idx_blocks_site_room_dates", [
  "site_id",
  "room_id",
  "start_date",
  "end_date",
])
export class BlocksEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "int" })
  site_id!: number;

  @Column({ type: "uuid" })
  room_id!: string;

  @Column({ type: "date" })
  start_date!: string;

  @Column({ type: "date" })
  end_date!: string;

  @Column({ type: "enum", enum: ["maintenance", "manual_block"] })
  type!: "maintenance" | "manual_block";

  @Column({ type: "uuid" })
  reference_id!: string;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @DeleteDateColumn()
  deleted_at!: Date;
}
