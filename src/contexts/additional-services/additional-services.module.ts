import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AdditionalServiceEntity } from "./entities/additional-service.entity";
import { SiteAdditionalServiceEntity } from "./entities/site-additional-service.entity";

// Entity registration only (no controllers): lets TypeORM autoLoadEntities
// resolve string-based relations (e.g. RoomEntity -> "SiteUnitEntity").
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AdditionalServiceEntity,
      SiteAdditionalServiceEntity,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class AdditionalServicesModule {}
