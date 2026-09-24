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

// Single catalog for amenities and facilities (spec A2.1-A2.3, C8).
// Additional services (A2.4) live in AdditionalServiceEntity.
export const dog_supply_section_values = ["amenity", "facility"] as const;
export type DogSupplySectionValue = (typeof dog_supply_section_values)[number];

@Entity("dog_supplies")
@Unique("uq_dog_supplies_species_slug", ["species_id", "slug"])
export class DogSupplyEntity {
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

  @Column({ type: "enum", enum: dog_supply_section_values })
  section!: DogSupplySectionValue;

  @Column({ type: "decimal", precision: 4, scale: 1, default: 0 })
  score_points!: number;

  @Column({ type: "boolean", default: true })
  is_public!: boolean;

  @Column({ type: "boolean", default: false })
  is_filter!: boolean;

  @Column({ type: "boolean", default: false })
  is_badge!: boolean;

  @Column({ type: "boolean", default: false })
  is_scoring!: boolean;

  @Column({ type: "decimal", precision: 5, scale: 2, default: 0 })
  completeness_weight!: number;

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
