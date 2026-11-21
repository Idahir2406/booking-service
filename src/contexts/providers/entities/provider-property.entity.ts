import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export const PROVIDER_PROPERTY_STATUS = {
  DRAFT: "draft",
  ACTIVE: "active",
  PAUSED: "paused",
  DELISTED: "delisted",
} as const;

export type ProviderPropertyStatus =
  (typeof PROVIDER_PROPERTY_STATUS)[keyof typeof PROVIDER_PROPERTY_STATUS];

/**
 * Link between a curated v4p_jsites1 profile (profile_mode = 'provider') and
 * the provider's hotel id. One provider hotel <-> one site.
 */
@Entity("provider_properties")
@Index(
  "uq_provider_properties_provider_hotel",
  ["provider", "provider_hotel_id"],
  {
    unique: true,
  },
)
export class ProviderPropertyEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id!: number;

  /** ProviderName ('nuitee'). */
  @Column({ type: "varchar", length: 32 })
  provider!: string;

  @Column({ type: "varchar", length: 64 })
  provider_hotel_id!: string;

  /** v4p_jsites1.id */
  @Index("uq_provider_properties_site", { unique: true })
  @Column({ type: "int" })
  site_id!: number;

  @Column({
    type: "enum",
    enum: Object.values(PROVIDER_PROPERTY_STATUS),
    default: PROVIDER_PROPERTY_STATUS.DRAFT,
  })
  status!: ProviderPropertyStatus;

  /** Last ProviderPetPolicy + petsAllowed read from the provider. */
  @Column({ type: "json", nullable: true })
  pets_snapshot?: object | null;

  /** Last ProviderHotel content read from the provider. */
  @Column({ type: "json", nullable: true })
  content_snapshot?: object | null;

  @Column({ type: "datetime", nullable: true })
  last_synced_at?: Date | null;

  @CreateDateColumn({ type: "datetime", precision: 6 })
  created_at!: Date;

  @UpdateDateColumn({ type: "datetime", precision: 6 })
  updated_at!: Date;
}
