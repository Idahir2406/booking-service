import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { LegacyDbModule } from "@/shared/legacy-db/legacy-db.module";

import { AdditionalServiceEntity } from "@/contexts/additional-services/entities/additional-service.entity";
import { CommonZoneEntity } from "@/contexts/common-zones/entities/common-zone.entity";
import { DogSizeEntity } from "@/contexts/dog-sizes/entities/dog-size.entity";
import { DogSupplyEntity } from "@/contexts/dog-supplies/entities/dog-supply.entity";
import { SiteUnitEntity } from "@/contexts/site-unit/entities/site-unit.entity";
import { SpeciesEntity } from "@/contexts/species/entities/species.entity";

import { CatalogsController } from "./api/catalogs.controller";
import { CatalogsService } from "./services/catalogs.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SiteUnitEntity,
      SpeciesEntity,
      DogSizeEntity,
      CommonZoneEntity,
      DogSupplyEntity,
      AdditionalServiceEntity,
    ]),
    LegacyDbModule,
  ],
  controllers: [CatalogsController],
  providers: [CatalogsService],
  exports: [CatalogsService],
})
export class CatalogsModule {}
