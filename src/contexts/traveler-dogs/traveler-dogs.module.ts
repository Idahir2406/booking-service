import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { DogSizeEntity } from "../dog-sizes/entities/dog-size.entity";
import { SpeciesEntity } from "../species/entities/species.entity";
import { TravelerDogsController } from "./api/traveler-dogs.controller";
import { TravelerDogEntity } from "./entities/traveler-dog.entity";
import { TravelerDogsService } from "./services/traveler-dogs.service";

/** F-PV5 "Mis perros" (D1 = B). Exports the service for the F-PV6 dashboard. */
@Module({
  imports: [
    TypeOrmModule.forFeature([TravelerDogEntity, SpeciesEntity, DogSizeEntity]),
  ],
  controllers: [TravelerDogsController],
  providers: [TravelerDogsService],
  exports: [TravelerDogsService],
})
export class TravelerDogsModule {}
