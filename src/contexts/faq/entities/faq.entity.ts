import type { SpeciesEntity } from "@/contexts/species/entities/species.entity";
import type { FaqAnswerEntity } from "./faq-answer.entity";

import slugify from "slugify";
import {
  BeforeInsert,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";

export const faq_input_type_values = ["bool", "bool_text"] as const;
export type FaqInputTypeValue = (typeof faq_input_type_values)[number];

@Entity("faq")
@Unique("uq_faq_species_slug", ["species_id", "slug"])
export class FaqEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  species_id!: number;

  @ManyToOne("SpeciesEntity", { onDelete: "RESTRICT" })
  @JoinColumn({ name: "species_id" })
  species!: SpeciesEntity;

  @Column({ type: "text" })
  question!: string;

  @Column({ type: "varchar", length: 255 })
  slug!: string;

  @Column({ type: "enum", enum: faq_input_type_values, default: "bool" })
  input_type!: FaqInputTypeValue;

  // Derived FAQs (e.g. "zones.restaurant") are computed from A1.6/A1.6.1 and never answered
  @Column({ type: "varchar", length: 60, nullable: true })
  derived_from!: string | null;

  @Column({ type: "int", default: 0 })
  sort_order!: number;

  @Column({ type: "boolean", default: true })
  is_active!: boolean;

  @OneToMany("FaqAnswerEntity", (answer: FaqAnswerEntity) => answer.faq)
  answers!: FaqAnswerEntity[];

  // Slug is a stable key (translations): generated once, never on update
  @BeforeInsert()
  generateSlug() {
    if (!this.slug) {
      this.slug = slugify(this.question, { lower: true, strict: true });
    }
  }
}
