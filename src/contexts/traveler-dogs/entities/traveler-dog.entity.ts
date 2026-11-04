import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import { decimalTransformer } from "../../payments/entities/decimal.transformer";

/**
 * F-PV5 (D1 = B): a traveler's saved dog. Library only: reservations keep
 * their own frozen copy in reservation_snapshots (SnapshotDog), so editing or
 * deleting a row here never changes a booking.
 * user_id = v4p_juser_profiles.id WITHOUT FK (legacy table owned by PHP).
 */
@Entity("traveler_dogs")
@Index("idx_traveler_dogs_user", ["user_id", "deleted_at"])
export class TravelerDogEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  user_id!: number;

  @Column({ type: "varchar", length: 60 })
  name!: string;

  @Column({
    type: "decimal",
    precision: 5,
    scale: 2,
    transformer: decimalTransformer,
  })
  weight_kg!: number;

  @Column({ type: "boolean", default: false })
  is_ppp!: boolean;

  /** Storage key of the private photo (D5), never a path or URL. */
  @Column({ type: "varchar", length: 255, nullable: true })
  photo_path!: string | null;

  @CreateDateColumn({ type: "datetime", precision: 6 })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime", precision: 6 })
  updated_at!: Date;

  @DeleteDateColumn({ type: "datetime", precision: 6, nullable: true })
  deleted_at!: Date | null;
}
