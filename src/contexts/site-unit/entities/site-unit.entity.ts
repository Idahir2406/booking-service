import type { TypeSiteEntity } from "@/contexts/type-site/entities/type-site.entity";

import slugify from "slugify";
import {
  BeforeInsert,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";

// Catalog of unit TYPES (room, plot, bungalow...), not the bookable units themselves (rooms)
@Entity("site_units")
export class SiteUnitEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "varchar", length: 255 })
  slug!: string;

  // Full-use units (whole house, villa...) enable A1.6.2 and score block 3 variant
  @Column({ type: "boolean", default: false })
  is_full_use!: boolean;

  @Column({ type: "int" })
  type_site_id!: number;

  @ManyToOne(
    "TypeSiteEntity",
    (typeSite: TypeSiteEntity) => typeSite.site_units,
    {
      onDelete: "RESTRICT",
    },
  )
  @JoinColumn({ name: "type_site_id" })
  type_site!: TypeSiteEntity;

  // Slug is a stable key: generated once, never on update
  @BeforeInsert()
  generateSlug() {
    if (!this.slug) {
      this.slug = slugify(this.name, { lower: true, strict: true });
    }
  }
}
