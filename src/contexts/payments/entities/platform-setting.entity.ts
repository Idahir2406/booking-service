import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

export const PLATFORM_SETTING_VALUE_TYPE = {
  STRING: "string",
  NUMBER: "number",
  INTEGER: "integer",
} as const;

export type PlatformSettingValueType =
  (typeof PLATFORM_SETTING_VALUE_TYPE)[keyof typeof PLATFORM_SETTING_VALUE_TYPE];

/** Key/value platform configuration, typed on read (PlatformSettingsService). */
@Entity("platform_settings")
export class PlatformSettingEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  key!: string;

  @Column({ type: "varchar", length: 255 })
  value!: string;

  @Column({
    type: "enum",
    enum: Object.values(PLATFORM_SETTING_VALUE_TYPE),
    default: PLATFORM_SETTING_VALUE_TYPE.STRING,
  })
  value_type!: PlatformSettingValueType;

  @Column({ type: "varchar", length: 255, nullable: true })
  description?: string | null;

  @UpdateDateColumn({ type: "datetime", precision: 6 })
  updated_at!: Date;
}
