import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { ClosestServiceEntity } from "./entities/closest-service.entity";
import { SiteClosestServiceEntity } from "./entities/site-closest-service.entity";

// Entity registration only (no controllers): lets TypeORM autoLoadEntities
// resolve string-based relations (e.g. RoomEntity -> "SiteUnitEntity").
@Module({
  imports: [
    TypeOrmModule.forFeature([ClosestServiceEntity, SiteClosestServiceEntity]),
  ],
  exports: [TypeOrmModule],
})
export class ClosestServicesModule {}
