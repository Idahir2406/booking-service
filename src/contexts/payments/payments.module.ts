import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { ReservationEntity } from "../reservations/entities/reservation.entity";
import { AuditLogEntity } from "./entities/audit-log.entity";
import { PaymentEntity } from "./entities/payment.entity";
import { PlatformSettingEntity } from "./entities/platform-setting.entity";
import { RefundEntity } from "./entities/refund.entity";
import { ReservationPriceLineEntity } from "./entities/reservation-price-line.entity";
import { ReservationSnapshotEntity } from "./entities/reservation-snapshot.entity";
import { AuditLogService } from "./services/audit-log.service";
import { PaymentLedgerService } from "./services/payment-ledger.service";
import { PlatformSettingsService } from "./services/platform-settings.service";
import { PriceLinesService } from "./services/price-lines.service";
import { ReservationEconomicsService } from "./services/reservation-economics.service";
import { ReservationSnapshotService } from "./services/reservation-snapshot.service";

/**
 * F1 economic model: money in cents, platform settings, immutable price
 * lines, versioned snapshots, payments/refunds ledgers with state machines
 * and an append-only audit log. No HTTP routes (internal building block).
 * Depends on no other Nest module, so ReservationModule/WebhookModule can
 * import it without circular references.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReservationEntity,
      PlatformSettingEntity,
      ReservationPriceLineEntity,
      ReservationSnapshotEntity,
      PaymentEntity,
      RefundEntity,
      AuditLogEntity,
    ]),
  ],
  providers: [
    PlatformSettingsService,
    AuditLogService,
    PriceLinesService,
    ReservationSnapshotService,
    PaymentLedgerService,
    ReservationEconomicsService,
  ],
  exports: [
    PlatformSettingsService,
    AuditLogService,
    PriceLinesService,
    ReservationSnapshotService,
    PaymentLedgerService,
    ReservationEconomicsService,
  ],
})
export class PaymentsModule {}
