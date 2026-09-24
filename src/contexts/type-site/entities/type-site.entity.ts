import type { SiteUnitEntity } from "@/contexts/site-unit/entities/site-unit.entity";

import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";

import { envs } from "@/contexts/shared/configs/envs";

@Entity(`${envs.DB_PREFIX}type_sites`)
export class TypeSiteEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "varchar", length: 255 })
  customer!: string;

  @Column({ type: "varchar", length: 255 })
  name_l1!: string;

  @Column({ type: "varchar", length: 255 })
  alias_l1!: string;

  @Column({ type: "boolean" })
  indexable!: boolean;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  @OneToMany("SiteUnitEntity", (siteUnit: SiteUnitEntity) => siteUnit.type_site)
  site_units!: SiteUnitEntity[];
}
