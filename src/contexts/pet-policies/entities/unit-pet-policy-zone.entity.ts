import type { CommonZoneEntity } from "@/contexts/common-zones/entities/common-zone.entity";
import type { UnitPetPolicyEntity } from "@/contexts/pet-policies/entities/unit-pet-policy.entity";

import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";

// One row = the pet can access this zone (A1.6).
// allows_dining = guests may eat with the pet there (A1.6.1); being a flag on the
// same row guarantees dining zones are a subset of accessible zones.
// "Ninguna" = *_answered flag true on the policy + no rows (or no allows_dining).
@Entity("unit_pet_policy_zones")
@Unique("uq_unit_pet_policy_zones_policy_zone", ["policy_id", "zone_id"])
export class UnitPetPolicyZoneEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  policy_id!: number;

  @ManyToOne("UnitPetPolicyEntity", "zones", { onDelete: "CASCADE" })
  @JoinColumn({ name: "policy_id" })
  policy!: UnitPetPolicyEntity;

  @Column({ type: "int" })
  zone_id!: number;

  @ManyToOne("CommonZoneEntity", { onDelete: "RESTRICT" })
  @JoinColumn({ name: "zone_id" })
  zone!: CommonZoneEntity;

  @Column({ type: "boolean", default: false })
  allows_dining!: boolean;

  // Only for zones with requires_text ("other")
  @Column({ type: "varchar", length: 150, nullable: true })
  other_text!: string | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
