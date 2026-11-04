import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { LegacyTipsiteEntity } from "@/shared/legacy-db/entities/legacy-tipsite.entity";

import { SiteUnitEntity } from "./entities/site-unit.entity";

// Entity registration only (no controllers): lets TypeORM autoLoadEntities
// resolve string-based relations (e.g. RoomEntity -> "SiteUnitEntity",
// SiteUnitEntity -> "LegacyTipsiteEntity").
@Module({
  imports: [TypeOrmModule.forFeature([SiteUnitEntity, LegacyTipsiteEntity])],
  exports: [TypeOrmModule],
})
export class SiteUnitModule {}
