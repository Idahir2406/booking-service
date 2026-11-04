import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { DogSupplyEntity } from "./entities/dog-supply.entity";
import { SiteDogSupplyEntity } from "./entities/site-dog-supply.entity";

// Entity registration only (no controllers): lets TypeORM autoLoadEntities
// resolve string-based relations (e.g. RoomEntity -> "SiteUnitEntity").
@Module({
  imports: [TypeOrmModule.forFeature([DogSupplyEntity, SiteDogSupplyEntity])],
  exports: [TypeOrmModule],
})
export class DogSuppliesModule {}
