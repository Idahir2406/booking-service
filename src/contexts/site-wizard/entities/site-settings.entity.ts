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

import { decimalTransformer } from "../../payments/entities/decimal.transformer";

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

  // Step 6: structured cancellation policy (payments/domain/cancellation-
  // policy.ts). cancellation_policy_type NULL = legacy rule (no policy).
  @Column({ type: "varchar", length: 30, nullable: true })
  cancellation_policy_type!: string | null;

  /** Only free_cancellation: days before check-in (1, 3, 7, 14, 30). */
  @Column({ type: "tinyint", nullable: true })
  cancellation_deadline_days!: number | null;

  @Column({ type: "varchar", length: 20, nullable: true })
  cancellation_penalty_type!: string | null;

  @Column({ type: "varchar", length: 30, nullable: true })
  no_show_policy!: string | null;

  /** Optional exception: free cancellation N hours after booking. */
  @Column({ type: "tinyint", nullable: true })
  grace_after_booking_hours!: number | null;

  /** Optional exception: free cancellation up to N weeks before check-in. */
  @Column({ type: "tinyint", nullable: true })
  early_cancellation_weeks!: number | null;

  // Step 6: check-in / check-out schedule (local times, see site-schedule.utils.ts).
  @Column({ type: "time", nullable: true })
  checkin_from!: string | null;

  @Column({ type: "time", nullable: true })
  checkin_until!: string | null;

  @Column({ type: "time", nullable: true })
  checkout_until!: string | null;

  // Step 4: cribs / cots (max per reservation, no per-night inventory).
  @Column({ type: "boolean", default: false })
  cribs_offered!: boolean;

  @Column({ type: "tinyint", nullable: true })
  cribs_count!: number | null;

  @Column({ type: "boolean", default: false })
  cribs_is_paid!: boolean;

  @Column({
    type: "decimal",
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  cribs_price!: number | null;

  /** per_stay | per_night */
  @Column({ type: "varchar", length: 20, nullable: true })
  cribs_pricing_mode!: string | null;

  /** How to request them (e.g. "Avísanos 48 h antes"). */
  @Column({ type: "varchar", length: 255, nullable: true })
  cribs_note!: string | null;

  /** IANA timezone of the accommodation (deadline local time). */
  @Column({ type: "varchar", length: 64, nullable: true })
  timezone!: string | null;

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
