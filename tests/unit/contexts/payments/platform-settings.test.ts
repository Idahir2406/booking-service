import { describe, expect, it } from "vitest";

import {
  parsePlatformSettings,
  PLATFORM_SETTING_DEFAULTS,
} from "@/contexts/payments/domain/platform-settings";

describe("parsePlatformSettings · deferred charge", () => {
  it("defaults: deferred charge off, 48 h lead, 24 h regularization", () => {
    const settings = parsePlatformSettings([]);
    expect(settings.deferred_charge_enabled).toBe(false);
    expect(settings.deferred_min_lead_hours).toBe(48);
    expect(settings.regularization_window_hours).toBe(24);
    expect(settings).toEqual(PLATFORM_SETTING_DEFAULTS);
  });

  it("parses stored rows", () => {
    const settings = parsePlatformSettings([
      { key: "deferred_charge_enabled", value: "TRUE" },
      { key: "deferred_min_lead_hours", value: "72" },
      { key: "regularization_window_hours", value: "12" },
    ]);
    expect(settings.deferred_charge_enabled).toBe(true);
    expect(settings.deferred_min_lead_hours).toBe(72);
    expect(settings.regularization_window_hours).toBe(12);
    expect(
      parsePlatformSettings([{ key: "deferred_charge_enabled", value: "0" }])
        .deferred_charge_enabled,
    ).toBe(false);
  });

  it("invalid values fall back to the default and are reported", () => {
    const invalid: string[] = [];
    const settings = parsePlatformSettings(
      [
        { key: "deferred_charge_enabled", value: "yes" },
        { key: "deferred_min_lead_hours", value: "-1" },
        { key: "regularization_window_hours", value: "abc" },
      ],
      key => invalid.push(key),
    );
    expect(settings.deferred_charge_enabled).toBe(false);
    expect(settings.deferred_min_lead_hours).toBe(48);
    expect(settings.regularization_window_hours).toBe(24);
    expect(invalid).toEqual([
      "deferred_charge_enabled",
      "deferred_min_lead_hours",
      "regularization_window_hours",
    ]);
  });
});

describe("parsePlatformSettings · provider markup", () => {
  it("defaults to 0.15 and parses a valid fraction", () => {
    expect(parsePlatformSettings([]).provider_markup_rate).toBe(0.15);
    expect(
      parsePlatformSettings([{ key: "provider_markup_rate", value: "0.18" }])
        .provider_markup_rate,
    ).toBe(0.18);
  });

  it("invalid values fall back to the default", () => {
    const invalid: string[] = [];
    const settings = parsePlatformSettings(
      [{ key: "provider_markup_rate", value: "15" }],
      key => invalid.push(key),
    );
    expect(settings.provider_markup_rate).toBe(0.15);
    expect(invalid).toEqual(["provider_markup_rate"]);
  });
});
