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

// environment = A3 (never scores in Dog Friendly Score), nearby_service = A4
export const closest_service_section_values = [
  "environment",
  "nearby_service",
] as const;
export type ClosestServiceSectionValue =
  (typeof closest_service_section_values)[number];

@Entity("closest_services")
@Unique("uq_closest_services_species_slug", ["species_id", "slug"])
export class ClosestServiceEntity {
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

  @Column({ type: "enum", enum: closest_service_section_values })
  section!: ClosestServiceSectionValue;

  @Column({ type: "int", default: 0 })
  sort_order!: number;

  @Column({ type: "boolean", default: true })
  is_active!: boolean;

  // Slug is a stable key (translations, filters): generated once, never on update
  @BeforeInsert()
  generateSlug() {
    if (!this.slug) {
      this.slug = slugify(this.name, { lower: true, strict: true });
    }
  }
}
