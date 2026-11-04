import type { LegacyTipsiteEntity } from "@/shared/legacy-db/entities/legacy-tipsite.entity";

import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * New-platform settings of a legacy site (v4p_jsites1), 1:1 by site_id.
 * No FK to v4p_jsites1 on purpose: the legacy table is owned by PHP and must
 * not change structure/constraints. main_tipsite_id FK -> v4p_jtipsite(id),
 * modelled as a relation so migration:generate does not drop it.
 */
@Entity("site_settings")
export class SiteSettingsEntity {
  @PrimaryColumn({ type: "int" })
  site_id!: number;

  @Column({ type: "int", nullable: true })
  main_tipsite_id!: number | null;

  @ManyToOne("LegacyTipsiteEntity", {
    nullable: true,
    onDelete: "SET NULL",
    onUpdate: "NO ACTION",
    createForeignKeyConstraints: true,
  })
  @JoinColumn({
    name: "main_tipsite_id",
    foreignKeyConstraintName: "fk_site_settings_main_tipsite",
  })
  main_tipsite!: LegacyTipsiteEntity | null;

  // Step 3: max dogs per booking for the whole site (1-5). NULL + unlimited
  // false = not answered. Synced to rooms.max_pets (unlimited -> 99).
  @Column({ type: "smallint", nullable: true })
  max_pets!: number | null;

  @Column({ type: "boolean", default: false })
  max_pets_unlimited!: boolean;

  // Step 6: wizard availability rule (AVAILABILITY_MODE). NULL = not
  // configured yet. min/max nights applied to the availability rows of
  // every active unit (and to units created later in step 2).
  @Column({ type: "varchar", length: 20, nullable: true })
  availability_mode!: string | null;

  @Column({ type: "smallint", nullable: true })
  min_nights!: number | null;

  @Column({ type: "smallint", nullable: true })
  max_nights!: number | null;

  // Step 7: terms accepted on submission (user id, no FK: legacy users).
  @Column({ type: "datetime", nullable: true })
  terms_accepted_at!: Date | null;

  @Column({ type: "varchar", length: 20, nullable: true })
  terms_version!: string | null;

  @Column({ type: "int", nullable: true })
  terms_accepted_by!: number | null;

  @Column({ type: "tinyint", default: 1 })
  wizard_step!: number;

  // Step 7: last submission for admin review (jsites1.active is not touched).
  @Column({ type: "datetime", nullable: true })
  wizard_completed_at!: Date | null;

  @CreateDateColumn({ type: "datetime", precision: 6 })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime", precision: 6 })
  updated_at!: Date;
}
