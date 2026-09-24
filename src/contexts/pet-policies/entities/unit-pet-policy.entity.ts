import type { DogSizeEntity } from "@/contexts/dog-sizes/entities/dog-size.entity";
import type { UnitPetPolicyZoneEntity } from "@/contexts/pet-policies/entities/unit-pet-policy-zone.entity";
import type { RoomEntity } from "@/contexts/rooms/entities/room.entity";
import type { SpeciesEntity } from "@/contexts/species/entities/species.entity";

import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";

export const supplement_mode_values = [
  "none",
  "per_pet_night",
  "per_pet_stay",
  "fixed_stay",
] as const;
export type SupplementModeValue = (typeof supplement_mode_values)[number];

export const left_alone_values = ["yes", "no", "conditional"] as const;
export type LeftAloneValue = (typeof left_alone_values)[number];

export const deposit_return_values = ["end_of_stay", "days"] as const;
export type DepositReturnValue = (typeof deposit_return_values)[number];

// Pet policy per bookable unit and species (spec C1). Critical fields are nullable:
// null = "no contestado" (C12.5), which blocks publishing until answered.
@Entity("unit_pet_policies")
@Unique("uq_unit_pet_policies_room_species", ["room_id", "species_id"])
export class UnitPetPolicyEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "int" })
  room_id!: number;

  @ManyToOne("RoomEntity", { onDelete: "CASCADE" })
  @JoinColumn({ name: "room_id" })
  room!: RoomEntity;

  @Column({ type: "int" })
  species_id!: number;

  @ManyToOne("SpeciesEntity", { onDelete: "RESTRICT" })
  @JoinColumn({ name: "species_id" })
  species!: SpeciesEntity;

  // Max size category admitted (cumulative by rank); null = sin límite de tamaño
  @Column({ type: "int", nullable: true })
  max_size_id!: number | null;

  @ManyToOne("DogSizeEntity", { onDelete: "RESTRICT", nullable: true })
  @JoinColumn({ name: "max_size_id" })
  max_size!: DogSizeEntity | null;

  // null = sin límite
  @Column({ type: "smallint", nullable: true })
  max_pets!: number | null;

  @Column({ type: "boolean", nullable: true })
  ppp_allowed!: boolean | null;

  @Column({ type: "enum", enum: supplement_mode_values, nullable: true })
  supplement_mode!: SupplementModeValue | null;

  @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
  supplement_amount!: number | null;

  @Column({ type: "enum", enum: left_alone_values, nullable: true })
  left_alone!: LeftAloneValue | null;

  @Column({ type: "text", nullable: true })
  left_alone_conditions!: string | null;

  // Only for full-use units (A1.6.2)
  @Column({ type: "boolean", nullable: true })
  full_unit_access!: boolean | null;

  @Column({ type: "boolean", nullable: true })
  deposit_required!: boolean | null;

  @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
  deposit_amount!: number | null;

  @Column({ type: "enum", enum: deposit_return_values, nullable: true })
  deposit_return!: DepositReturnValue | null;

  @Column({ type: "smallint", nullable: true })
  deposit_return_days!: number | null;

  // A1.6 / A1.6.1: null = no contestado; true + no zone rows = "Ninguna"
  @Column({ type: "boolean", nullable: true })
  common_zones_answered!: boolean | null;

  @Column({ type: "boolean", nullable: true })
  dining_zones_answered!: boolean | null;

  @OneToMany("UnitPetPolicyZoneEntity", "policy")
  zones!: UnitPetPolicyZoneEntity[];

  // Free text: never used for filters, blocking or score (A1.7)
  @Column({ type: "text", nullable: true })
  notes!: string | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
