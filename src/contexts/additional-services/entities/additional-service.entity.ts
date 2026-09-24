import type { SpeciesEntity } from "@/contexts/species/entities/species.entity";

import slugify from "slugify";
import {
  BeforeInsert,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";

// Additional services catalog: daycare, dog walker, dog sitter, trainer (spec A2.4).
// Price/availability is per site (SiteAdditionalServiceEntity), never in the catalog.
@Entity("additional_services")
@Unique("uq_additional_services_species_slug", ["species_id", "slug"])
export class AdditionalServiceEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  species_id!: number;

  @ManyToOne("SpeciesEntity", { onDelete: "RESTRICT" })
  @JoinColumn({ name: "species_id" })
  species!: SpeciesEntity;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "varchar", length: 255 })
  slug!: string;

  // Score block 2: 1 point each (free or paid), capped at 4
  @Column({ type: "decimal", precision: 4, scale: 1, default: 1 })
  score_points!: number;

  @Column({ type: "boolean", default: true })
  is_public!: boolean;

  @Column({ type: "boolean", default: false })
  is_filter!: boolean;

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
