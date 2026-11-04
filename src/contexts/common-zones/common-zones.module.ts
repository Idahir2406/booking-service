import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { CommonZoneEntity } from "./entities/common-zone.entity";

// Entity registration only (no controllers): lets TypeORM autoLoadEntities
// resolve string-based relations (e.g. RoomEntity -> "SiteUnitEntity").
@Module({
  imports: [TypeOrmModule.forFeature([CommonZoneEntity])],
  exports: [TypeOrmModule],
})
export class CommonZonesModule {}
