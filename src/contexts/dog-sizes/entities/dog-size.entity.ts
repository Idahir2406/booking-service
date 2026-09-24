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

// Cumulative size categories: a policy stores the max rank admitted (spec A1.1, C2)
@Entity("dog_sizes")
@Unique("uq_dog_sizes_species_slug", ["species_id", "slug"])
@Unique("uq_dog_sizes_species_rank", ["species_id", "rank"])
export class DogSizeEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  species_id!: number;

  @ManyToOne("SpeciesEntity", { onDelete: "RESTRICT" })
  @JoinColumn({ name: "species_id" })
  species!: SpeciesEntity;

  @Column({ type: "varchar", length: 60 })
  name!: string;

  @Column({ type: "varchar", length: 60 })
  slug!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  description!: string | null;

  @Column({ type: "smallint" })
  rank!: number;

  @Column({ type: "decimal", precision: 5, scale: 2 })
  min_kg!: number;

  // null = no upper bound (e.g. "Extra grande" > 40 kg)
  @Column({ type: "decimal", precision: 5, scale: 2, nullable: true })
  max_kg!: number | null;

  // Slug is a stable key (translations, filters, score): generated once, never on update
  @BeforeInsert()
  generateSlug() {
    if (!this.slug) {
      this.slug = slugify(this.name, { lower: true, strict: true });
    }
  }
}
