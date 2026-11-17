import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AdditionalServiceEntity } from "@/contexts/additional-services/entities/additional-service.entity";
import { DogSupplyEntity } from "@/contexts/dog-supplies/entities/dog-supply.entity";
import { AuditLogEntity } from "@/contexts/payments/entities/audit-log.entity";

import {
  SiteHistoryAdminController,
  SiteHistoryController,
} from "./api/site-history.controller";
import { SiteAuditService } from "./services/site-audit.service";
import { SiteHistoryService } from "./services/site-history.service";

/**
 * Accommodation change history (audit_log entity "site"). Leaf module: it only
 * depends on entities, so rooms / availability / blocks / wizard can import it
 * without cycles.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditLogEntity,
      DogSupplyEntity,
      AdditionalServiceEntity,
    ]),
  ],
  controllers: [SiteHistoryController, SiteHistoryAdminController],
  providers: [SiteAuditService, SiteHistoryService],
  exports: [SiteAuditService],
})
export class SiteHistoryModule {}
