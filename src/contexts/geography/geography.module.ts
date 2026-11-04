import { Module } from "@nestjs/common";

import { LegacyDbModule } from "@/shared/legacy-db/legacy-db.module";

import { GeographyController } from "./api/geography.controller";
import { GeographyService } from "./services/geography.service";

@Module({
  imports: [LegacyDbModule],
  controllers: [GeographyController],
  providers: [GeographyService],
  exports: [GeographyService],
})
export class GeographyModule {}
