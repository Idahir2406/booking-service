import { Module } from "@nestjs/common";

import { LegacyDbService } from "./legacy-db.service";
import { SiteFeatureGroupsService } from "./site-feature-groups.service";

@Module({
  providers: [LegacyDbService, SiteFeatureGroupsService],
  exports: [LegacyDbService, SiteFeatureGroupsService],
})
export class LegacyDbModule {}
