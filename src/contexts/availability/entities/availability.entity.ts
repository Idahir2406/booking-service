import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("availability")
@Index("idx_availability_site_id", ["site_id"])
@Index("idx_availability_site_room_date", ["site_id", "room_id", "date"], {
  unique: true,
})
export class AvailabilityEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "date" })
  date!: Date;

  @Column({ type: "int" })
  site_id!: number;

  @Column({ type: "uuid" })
  room_id!: string;

  @Column({ type: "boolean", default: false })
  is_available!: boolean;

  @Column({ type: "int" })
  min_nights!: number;

  @Column({ type: "int" })
  max_nights!: number;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
