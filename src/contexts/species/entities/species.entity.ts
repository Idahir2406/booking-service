import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("species")
export class SpeciesEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  @Column({ type: "varchar", length: 255 })
  name!: string;
}
