import type { LegacyTipsiteEntity } from "@/shared/legacy-db/entities/legacy-tipsite.entity";

import slugify from "slugify";
import {
  BeforeInsert,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";

// Catalog of unit TYPES (room, plot, bungalow...) per legacy accommodation type
// (v4p_jtipsite), not the bookable units themselves (rooms)
@Entity("site_units")
@Index("uq_site_units_tipsite_slug", ["tipsite_id", "slug"], { unique: true })
export class SiteUnitEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  // Unique per tipsite (not globally): "apartamento" exists for several tipsites
  @Column({ type: "varchar", length: 255 })
  slug!: string;

  // Full-use units (whole house, villa...) enable A1.6.2 and score block 3 variant
  @Column({ type: "boolean", default: false })
  is_full_use!: boolean;

  @Column({ type: "int" })
  tipsite_id!: number;

  // FK to the legacy table, modelled so generated migrations keep it
  @ManyToOne("LegacyTipsiteEntity", {
    onDelete: "RESTRICT",
    onUpdate: "NO ACTION",
  })
  @JoinColumn({
    name: "tipsite_id",
    foreignKeyConstraintName: "fk_site_units_tipsite",
  })
  tipsite!: LegacyTipsiteEntity;

  @Column({ type: "int", default: 0 })
  sort_order!: number;

  @Column({ type: "boolean", default: true })
  is_active!: boolean;

  // Slug is a stable key: generated once, never on update
  @BeforeInsert()
  generateSlug() {
    if (!this.slug) {
      this.slug = slugify(this.name, { lower: true, strict: true });
    }
  }
}
