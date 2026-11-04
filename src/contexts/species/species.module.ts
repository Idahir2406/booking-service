import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { SpeciesEntity } from "./entities/species.entity";

// Entity registration only (no controllers): lets TypeORM autoLoadEntities
// resolve string-based relations (e.g. RoomEntity -> "SiteUnitEntity").
@Module({
  imports: [TypeOrmModule.forFeature([SpeciesEntity])],
  exports: [TypeOrmModule],
})
export class SpeciesModule {}
