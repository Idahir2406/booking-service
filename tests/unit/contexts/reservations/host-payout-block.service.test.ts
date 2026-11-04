import { describe, expect, it, vi } from "vitest";

import {
  HostPayoutBlockService,
  PAYOUT_FAILURE_ESCALATED_EVENT,
} from "@/src/contexts/reservations/services/host-payout-block.service";
import { HostPayoutWebhookService } from "@/src/contexts/webhook/services/host-payout-webhook.service";

const NOW = new Date("2026-10-28T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const createFixture = (
  options: {
    failing?: { reservation_id: number; site_id: number; first_failed_at: Date }[];
    bankFailure?: { failed_at: Date; failure_message?: string } | null;
    sites?: { id: number; user_id: number; name: string; email: string }[];
  } = {},
) => {
  const reservationRepository = {
    query: vi.fn().mockResolvedValue(options.failing ?? []),
  };
  const failureRepository = {
    findOne: vi.fn().mockResolvedValue(options.bankFailure ?? null),
    find: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
  };
  const sites = options.sites ?? [
    { id: 42, user_id: 5, name: "Casa Teo", email: "host@example.com" },
  ];
  const mysqlService = { query: vi.fn().mockResolvedValue(sites) };
  const platformSettings = { get: vi.fn().mockResolvedValue(7) };
  const emails = { sendHostNoticeEmail: vi.fn().mockResolvedValue(true) };
  const events = { logEvent: vi.fn().mockResolvedValue(undefined) };
  const service = new HostPayoutBlockService(
    reservationRepository as never,
    failureRepository as never,
    mysqlService as never,
    platformSettings as never,
    emails as never,
    events as never,
  );
  return {
    service,
    reservationRepository,
    failureRepository,
    mysqlService,
    emails,
    events,
  };
};

describe("HostPayoutBlockService.getHostPayoutBlock", () => {
  it("is not blocked without failures older than payout_failure_days", async () => {
    const { service, reservationRepository } = createFixture();

    const block = await service.getHostPayoutBlock(5, NOW);

    expect(block).toMatchObject({ blocked: false, reason: null, days: 7 });
    const [sql, params] = reservationRepository.query.mock.calls[0] as [
      string,
      unknown[],
    ];
    expect(sql).toContain("r.site_id IN (?)");
    expect(params).toEqual([
      "payout_failed",
      42,
      new Date(NOW.getTime() - 7 * DAY),
    ]);
  });

  it("blocks when a transfer keeps failing for 7 days", async () => {
    const first = new Date(NOW.getTime() - 8 * DAY);
    const { service } = createFixture({
      failing: [
        { reservation_id: 9, site_id: 42, first_failed_at: first },
        {
          reservation_id: 11,
          site_id: 42,
          first_failed_at: new Date(NOW.getTime() - 10 * DAY),
        },
      ],
    });

    const block = await service.getHostPayoutBlock(5, NOW);

    expect(block).toMatchObject({
      blocked: true,
      reason: "transfer_failed",
      reservation_ids: [9, 11],
      since: new Date(NOW.getTime() - 10 * DAY).toISOString(),
    });
  });

  it("blocks on an unresolved bank payout failure", async () => {
    const failedAt = new Date(NOW.getTime() - 9 * DAY);
    const { service } = createFixture({ bankFailure: { failed_at: failedAt } });

    const block = await service.getHostPayoutBlock(5, NOW);

    expect(block).toMatchObject({
      blocked: true,
      reason: "bank_payout_failed",
      since: failedAt.toISOString(),
    });
  });

  it("host without sites or user id is never blocked", async () => {
    const { service, reservationRepository } = createFixture({ sites: [] });

    expect((await service.getHostPayoutBlock(5, NOW)).blocked).toBe(false);
    expect((await service.getHostPayoutBlock(0, NOW)).blocked).toBe(false);
    expect(reservationRepository.query).not.toHaveBeenCalled();
  });
});

describe("HostPayoutBlockService.escalateBlockedHosts", () => {
  it("emails host + admin once and marks each reservation", async () => {
    const { service, emails, events, reservationRepository } = createFixture({
      failing: [
        {
          reservation_id: 9,
          site_id: 42,
          first_failed_at: new Date(NOW.getTime() - 8 * DAY),
        },
      ],
    });

    await service.escalateBlockedHosts(NOW);

    const [sql, params] = reservationRepository.query.mock.calls[0] as [
      string,
      unknown[],
    ];
    expect(sql).toContain("NOT EXISTS");
    expect(params).toContain(PAYOUT_FAILURE_ESCALATED_EVENT);
    expect(emails.sendHostNoticeEmail).toHaveBeenCalledWith(
      "payout_blocked_host",
      expect.objectContaining({
        host_user_id: 5,
        host_email: "host@example.com",
        reason: "transfer_failed",
        reservation_ids: [9],
      }),
    );
    expect(emails.sendHostNoticeEmail).toHaveBeenCalledWith(
      "payout_blocked_admin",
      expect.anything(),
    );
    expect(events.logEvent).toHaveBeenCalledWith(
      9,
      PAYOUT_FAILURE_ESCALATED_EVENT,
      { days: 7 },
    );
  });
});

describe("HostPayoutWebhookService", () => {
  const createWebhook = (created = true) => {
    const block = {
      recordBankPayoutFailure: vi.fn().mockResolvedValue(created),
      resolveBankPayoutFailures: vi.fn().mockResolvedValue(2),
      notifyBankPayoutFailed: vi.fn().mockResolvedValue(undefined),
    };
    const profiles = {
      findByStripeAccountId: vi.fn().mockResolvedValue({ id: 5 }),
    };
    const service = new HostPayoutWebhookService(
      block as never,
      profiles as never,
    );
    return { service, block };
  };

  const failedEvent = {
    id: "evt_1",
    type: "payout.failed",
    account: "acct_host",
    data: {
      object: {
        id: "po_1",
        amount: 12_345,
        currency: "EUR",
        failure_code: "account_closed",
        failure_message: "Bank account closed",
      },
    },
  };

  it("payout.failed records the failure and notifies after commit", async () => {
    const { service, block } = createWebhook();
    const afterCommit: (() => Promise<void>)[] = [];

    await service.handlePayoutFailed(failedEvent, {} as never, afterCommit);

    expect(block.recordBankPayoutFailure).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        stripeAccountId: "acct_host",
        userId: 5,
        stripePayoutId: "po_1",
        amountCents: 12_345,
        currency: "eur",
        failureCode: "account_closed",
      }),
    );
    expect(afterCommit).toHaveLength(1);
    await afterCommit[0]();
    expect(block.notifyBankPayoutFailed).toHaveBeenCalledTimes(1);
  });

  it("a redelivered payout.failed does not email again", async () => {
    const { service } = createWebhook(false);
    const afterCommit: (() => Promise<void>)[] = [];

    await service.handlePayoutFailed(failedEvent, {} as never, afterCommit);

    expect(afterCommit).toHaveLength(0);
  });

  it("platform payouts (no account) are ignored", async () => {
    const { service, block } = createWebhook();

    await service.handlePayoutFailed(
      { ...failedEvent, account: undefined },
      {} as never,
      [],
    );

    expect(block.recordBankPayoutFailure).not.toHaveBeenCalled();
  });

  it("payout.paid resolves the open failures of the account", async () => {
    const { service, block } = createWebhook();

    await service.handlePayoutPaid(
      { id: "evt_2", type: "payout.paid", account: "acct_host", data: { object: {} } },
      {} as never,
    );

    expect(block.resolveBankPayoutFailures).toHaveBeenCalledWith(
      {},
      "acct_host",
      expect.any(Date),
    );
  });
});
