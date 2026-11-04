import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { DogSizeEntity } from "./entities/dog-size.entity";

// Entity registration only (no controllers): lets TypeORM autoLoadEntities
// resolve string-based relations (e.g. RoomEntity -> "SiteUnitEntity").
@Module({
  imports: [TypeOrmModule.forFeature([DogSizeEntity])],
  exports: [TypeOrmModule],
})
export class DogSizesModule {}
