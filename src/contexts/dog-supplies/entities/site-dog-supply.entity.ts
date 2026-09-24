import type { DogSupplyEntity } from "./dog-supply.entity";

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

import {
  answer_state_values,
  AnswerStateValue,
} from "@/contexts/shared/types/answer-state";

@Entity("site_dog_supplies")
@Unique("uq_site_dog_supplies_site_supply", ["site_id", "supply_id"])
export class SiteDogSupplyEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  // v4p_jsites1.id (legacy table, no FK)
  @Column({ type: "int" })
  site_id!: number;

  @Column({ type: "int" })
  supply_id!: number;

  @ManyToOne("DogSupplyEntity", { onDelete: "RESTRICT" })
  @JoinColumn({ name: "supply_id" })
  supply!: DogSupplyEntity;

  @Column({ type: "enum", enum: answer_state_values, default: "unanswered" })
  state!: AnswerStateValue;

  @Column({ type: "boolean", nullable: true })
  is_paid!: boolean | null;

  @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
  price!: number | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
