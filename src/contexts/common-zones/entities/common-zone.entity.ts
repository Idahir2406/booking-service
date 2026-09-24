import slugify from "slugify";
import {
  BeforeInsert,
  Column,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";

// Catalog of common zones a pet may access (spec A1.6) and where guests may eat
// with their pet (A1.6.1). No species_id: zones belong to the accommodation, not
// to the species; per-species access lives in unit_pet_policy_zones.
@Entity("common_zones")
@Unique("uq_common_zones_slug", ["slug"])
export class CommonZoneEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "varchar", length: 60 })
  slug!: string;

  @Column({ type: "varchar", length: 100 })
  name!: string;

  // Counts as "otras zonas comunes" in Dog Friendly Score block 3 (C9)
  @Column({ type: "boolean", default: false })
  counts_as_extra_zone!: boolean;

  // Can be selected as dining zone (A1.6.1)
  @Column({ type: "boolean", default: false })
  is_dining_capable!: boolean;

  // Requires free text ("Otras → especificar")
  @Column({ type: "boolean", default: false })
  requires_text!: boolean;

  @Column({ type: "int", default: 0 })
  sort_order!: number;

  @Column({ type: "boolean", default: true })
  is_active!: boolean;

  // Slug is a stable key (translations, filters, score): generated once, never on update
  @BeforeInsert()
  generateSlug() {
    if (!this.slug) {
      this.slug = slugify(this.name, { lower: true, strict: true });
    }
  }
}
