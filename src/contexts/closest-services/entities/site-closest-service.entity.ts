import type { ClosestServiceEntity } from "./closest-service.entity";

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

// 1:N per site: a site may list several places of the same kind (e.g. two vets)
@Entity("site_closest_services")
@Index("idx_site_closest_services_site_id", ["site_id"])
export class SiteClosestServiceEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  // v4p_jsites1.id (legacy table, no FK)
  @Column({ type: "int" })
  site_id!: number;

  @Column({ type: "int" })
  closest_service_id!: number;

  @ManyToOne("ClosestServiceEntity", { onDelete: "RESTRICT" })
  @JoinColumn({ name: "closest_service_id" })
  closest_service!: ClosestServiceEntity;

  @Column({ type: "varchar", length: 150 })
  name!: string;

  @Column({ type: "decimal", precision: 6, scale: 2, nullable: true })
  distance_km!: number | null;

  @Column({ type: "decimal", precision: 10, scale: 7, nullable: true })
  lat!: number | null;

  @Column({ type: "decimal", precision: 10, scale: 7, nullable: true })
  lng!: number | null;

  @Column({ type: "int", default: 0 })
  sort_order!: number;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
