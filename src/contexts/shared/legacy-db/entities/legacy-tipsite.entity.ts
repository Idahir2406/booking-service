import { Column, Entity, PrimaryColumn } from "typeorm";

import { LEGACY_TABLE, legacyTable } from "../legacy-tables";

/**
 * Read-only mapping of the legacy PHP accommodation types table (v4p_jtipsite).
 * `synchronize: false`: the schema builder (and `migration:generate`) never
 * touches this table. It exists ONLY so new-platform entities can declare FKs to
 * it (e.g. site_units.tipsite_id); otherwise generated migrations would drop
 * FKs that are not modelled as relations. Reads go through LegacyDbService.
 */
@Entity({ name: legacyTable(LEGACY_TABLE.TIPSITE), synchronize: false })
export class LegacyTipsiteEntity {
  @PrimaryColumn({ type: "int" })
  id!: number;

  @Column({ type: "text", nullable: true })
  name_l1!: string | null;

  @Column({ type: "text", nullable: true })
  active!: string | null;
}
