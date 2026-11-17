import type { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";
import type { FakeEntityStore } from "./fake-entity-store";

import { AuditLogEntity } from "@/src/contexts/payments/entities/audit-log.entity";
import { PlatformSettingEntity } from "@/src/contexts/payments/entities/platform-setting.entity";
import { ReservationPriceLineEntity } from "@/src/contexts/payments/entities/reservation-price-line.entity";
import { ReservationSnapshotEntity } from "@/src/contexts/payments/entities/reservation-snapshot.entity";
import { AuditLogService } from "@/src/contexts/payments/services/audit-log.service";
import { PaymentLedgerService } from "@/src/contexts/payments/services/payment-ledger.service";
import { PlatformSettingsService } from "@/src/contexts/payments/services/platform-settings.service";
import { PriceLinesService } from "@/src/contexts/payments/services/price-lines.service";
import { ReservationEconomicsService } from "@/src/contexts/payments/services/reservation-economics.service";
import { ReservationSnapshotService } from "@/src/contexts/payments/services/reservation-snapshot.service";
import { SiteSettingsEntity } from "@/src/contexts/site-wizard/entities/site-settings.entity";

/**
 * Real F1 services wired over the in-memory store. `withSiteSettings` also
 * reads the site cancellation policy from the store (Fase 3); without it the
 * terms are the legacy ones.
 */
export function createEconomics(
  store: FakeEntityStore,
  options: { withSiteSettings?: boolean } = {},
) {
  const audit = new AuditLogService(store.repository(AuditLogEntity) as never);
  const settings = new PlatformSettingsService(
    store.repository(PlatformSettingEntity) as never,
  );
  const lines = new PriceLinesService(
    store.repository(ReservationPriceLineEntity) as never,
    audit,
  );
  const snapshots = new ReservationSnapshotService(
    store.repository(ReservationSnapshotEntity) as never,
    audit,
  );
  const ledger = new PaymentLedgerService(audit);
  const economics = new ReservationEconomicsService(
    settings,
    lines,
    snapshots,
    ledger,
    audit,
    options.withSiteSettings
      ? (store.repository(SiteSettingsEntity) as never)
      : undefined,
  );
  return { economics, ledger, audit, snapshots, lines, settings };
}

/** No-op economics for tests that do not look at the F1 ledger. */
export function createEconomicsStub() {
  return {
    resolveFrozenTerms: vi.fn().mockResolvedValue({
      commissionRate: 0.12,
      currency: "eur",
      timezone: "Europe/Madrid",
      deadlineLocalTime: "18:00",
    }),
    recordNewReservation: vi
      .fn()
      .mockResolvedValue({ payment: null, snapshotVersion: 1 }),
    auditReservationChange: vi.fn(() => Promise.resolve()),
    auditDetached: vi.fn(() => Promise.resolve()),
    attachCheckoutSession: vi.fn(() => Promise.resolve(null)),
    recordPaymentSucceeded: vi.fn(() => Promise.resolve({})),
    recordPaymentProcessing: vi.fn(() => Promise.resolve(null)),
    recordPaymentFailed: vi.fn(() => Promise.resolve(null)),
    attachChargeId: vi.fn(() => Promise.resolve()),
    recordRefundCreated: vi.fn(() => Promise.resolve({})),
    syncRefundFromStripe: vi.fn(() =>
      Promise.resolve({ refund: null, result: "not_found", created: false }),
    ),
    aggregateRefundStatus: vi.fn(() => Promise.resolve("none")),
    transitionPayout: vi.fn(
      (_manager: unknown, reservation: ReservationEntity, to: string) => {
        reservation.payout_status = to as ReservationEntity["payout_status"];
        return Promise.resolve("changed");
      },
    ),
    computePlatformFee: vi.fn(() => ({
      feeCents: 0,
      hostAmountCents: 0,
      rateUsed: 0.12,
      source: "frozen_cents",
    })),
  };
}
