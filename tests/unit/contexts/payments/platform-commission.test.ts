import { describe, expect, it, vi } from "vitest";

import {
  commissionRateFromPercentage,
  PLATFORM_SETTING_DEFAULTS,
  PLATFORM_SETTING_KEY,
} from "@/src/contexts/payments/domain/platform-settings";
import { PlatformSettingsService } from "@/src/contexts/payments/services/platform-settings.service";

interface SettingRow {
  key: string;
  value: string;
}

interface FakeRepositoryOptions {
  settings?: readonly SettingRow[];
  commissionRows?: readonly { percentage: unknown }[];
  commissionError?: Error;
}

function makeService(options: FakeRepositoryOptions) {
  const find = vi.fn(async () => options.settings ?? []);
  const query = vi.fn(async () => {
    if (options.commissionError) {
      throw options.commissionError;
    }
    return options.commissionRows ?? [];
  });
  const service = new PlatformSettingsService({ find, query } as never);
  return { service, find, query };
}

const SETTINGS_10_PERCENT: readonly SettingRow[] = [
  { key: PLATFORM_SETTING_KEY.COMMISSION_RATE, value: "0.10" },
];

describe("commissionRateFromPercentage", () => {
  it.each([
    ["12.00", 0.12],
    [12, 0.12],
    ["0", 0],
    ["7.5", 0.075],
    ["99.99", 0.9999],
    [" 15.25 ", 0.1525],
  ])("%s %% -> %s", (raw, expected) => {
    expect(commissionRateFromPercentage(raw)).toBe(expected);
  });

  it.each([null, undefined, "", "  ", "abc", "-1", "100", "150", "NaN", "Infinity"])(
    "rejects %s",
    (raw) => {
      expect(commissionRateFromPercentage(raw)).toBeNull();
    },
  );
});

describe("PlatformSettingsService commission_rate resolution", () => {
  it("1. uses v4p_jplatform_commission.percentage / 100 when valid", async () => {
    const { service, query } = makeService({
      settings: SETTINGS_10_PERCENT,
      commissionRows: [{ percentage: "15.50" }],
    });
    await expect(service.get("commission_rate")).resolves.toBe(0.155);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("`v4p_jplatform_commission`"),
      ["v4p"],
    );
  });

  it("2. falls back to platform_settings.commission_rate when the table has no row", async () => {
    const { service } = makeService({
      settings: SETTINGS_10_PERCENT,
      commissionRows: [],
    });
    await expect(service.get("commission_rate")).resolves.toBe(0.1);
  });

  it("2. falls back to platform_settings when the table is missing (migration not run)", async () => {
    const { service } = makeService({
      settings: SETTINGS_10_PERCENT,
      commissionError: new Error("ER_NO_SUCH_TABLE"),
    });
    await expect(service.get("commission_rate")).resolves.toBe(0.1);
  });

  it.each(["100", "-5", "abc", null])(
    "2. falls back to platform_settings when percentage=%s is invalid",
    async (percentage) => {
      const { service } = makeService({
        settings: SETTINGS_10_PERCENT,
        commissionRows: [{ percentage }],
      });
      await expect(service.get("commission_rate")).resolves.toBe(0.1);
    },
  );

  it("3. falls back to the code default when both sources are missing/invalid", async () => {
    const { service } = makeService({
      settings: [{ key: PLATFORM_SETTING_KEY.COMMISSION_RATE, value: "oops" }],
      commissionRows: [{ percentage: "250" }],
    });
    await expect(service.get("commission_rate")).resolves.toBe(
      PLATFORM_SETTING_DEFAULTS.commission_rate,
    );
  });

  it("does not touch the other settings", async () => {
    const { service } = makeService({
      settings: [
        ...SETTINGS_10_PERCENT,
        { key: PLATFORM_SETTING_KEY.PAYOUT_FAILURE_DAYS, value: "9" },
      ],
      commissionRows: [{ percentage: "20" }],
    });
    const settings = await service.getAll();
    expect(settings.commission_rate).toBe(0.2);
    expect(settings.payout_failure_days).toBe(9);
  });

  it("caches the resolved value until invalidate()", async () => {
    const rows = [{ percentage: "15" }];
    const { service, query } = makeService({
      settings: SETTINGS_10_PERCENT,
      commissionRows: rows,
    });
    await expect(service.get("commission_rate")).resolves.toBe(0.15);
    rows[0] = { percentage: "18" };
    await expect(service.get("commission_rate")).resolves.toBe(0.15);
    expect(query).toHaveBeenCalledTimes(1);
    service.invalidate();
    await expect(service.get("commission_rate")).resolves.toBe(0.18);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
