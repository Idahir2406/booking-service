import type { AdditionalServiceEntity } from "./additional-service.entity";

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

@Entity("site_additional_services")
@Unique("uq_site_additional_services_site_service", [
  "site_id",
  "additional_service_id",
])
export class SiteAdditionalServiceEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  // v4p_jsites1.id (legacy table, no FK)
  @Column({ type: "int" })
  site_id!: number;

  @Column({ type: "int" })
  additional_service_id!: number;

  @ManyToOne("AdditionalServiceEntity", { onDelete: "RESTRICT" })
  @JoinColumn({ name: "additional_service_id" })
  additional_service!: AdditionalServiceEntity;

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
