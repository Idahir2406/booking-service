import type { FaqEntity } from "./faq.entity";

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

@Entity("faq_answers")
@Unique("uq_faq_answers_site_faq", ["site_id", "faq_id"])
export class FaqAnswerEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  // v4p_jsites1.id (legacy table, no FK)
  @Column({ type: "int" })
  site_id!: number;

  @Column({ type: "int" })
  faq_id!: number;

  @ManyToOne("FaqEntity", { onDelete: "RESTRICT" })
  @JoinColumn({ name: "faq_id" })
  faq!: FaqEntity;

  @Column({ type: "enum", enum: answer_state_values, default: "unanswered" })
  state!: AnswerStateValue;

  @Column({ type: "text", nullable: true })
  text_value!: string | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
