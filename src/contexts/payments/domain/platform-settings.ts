import type { PlatformSettingEntity } from "../entities/platform-setting.entity";

import { normalizeRate } from "../utils/money.util";

export const PLATFORM_SETTING_KEY = {
  COMMISSION_RATE: "commission_rate",
  DEADLINE_LOCAL_TIME: "deadline_local_time",
  DEFAULT_TIMEZONE: "default_timezone",
  AVAILABLE_AFTER_CHECKOUT_HOURS: "available_after_checkout_hours",
  REGULARIZATION_WINDOW_HOURS: "regularization_window_hours",
  PAYOUT_FAILURE_DAYS: "payout_failure_days",
  DEFERRED_CHARGE_ENABLED: "deferred_charge_enabled",
  DEFERRED_MIN_LEAD_HOURS: "deferred_min_lead_hours",
  PROVIDER_MARKUP_RATE: "provider_markup_rate",
} as const;

export type PlatformSettingKey =
  (typeof PLATFORM_SETTING_KEY)[keyof typeof PLATFORM_SETTING_KEY];

export interface PlatformSettings {
  /** A2: 12 % on the commissionable base. */
  commission_rate: number;
  /** A6: free-cancellation deadline, local time of the accommodation. */
  deadline_local_time: string;
  default_timezone: string;
  /** A19: hours after checkout before a reservation can be settled. */
  available_after_checkout_hours: number;
  /** A7: hours to regularize a failed (deferred) charge. */
  regularization_window_hours: number;
  /** A22: days before a failed payout escalates. */
  payout_failure_days: number;
  /** A5: deferred charge of free-cancellation policies (off by default). */
  deferred_charge_enabled: boolean;
  /** A6: below these hours until the deadline the charge is immediate. */
  deferred_min_lead_hours: number;
  /**
   * V4P markup over the provider NET rate (Nuitee is queried with margin 0):
   * sell = net + round_half_up(net x rate). Fraction (0.15 = 15 %).
   */
  provider_markup_rate: number;
}

/** Code defaults: used when a row is missing or the DB is unreachable. */
export const PLATFORM_SETTING_DEFAULTS: Readonly<PlatformSettings> = {
  commission_rate: 0.12,
  deadline_local_time: "18:00",
  default_timezone: "Europe/Madrid",
  available_after_checkout_hours: 24,
  regularization_window_hours: 24,
  payout_failure_days: 7,
  deferred_charge_enabled: false,
  deferred_min_lead_hours: 48,
  provider_markup_rate: 0.15,
};

/**
 * Converts the admin-editable human percent of v4p_jplatform_commission
 * (12.00 = 12 %) into a commission rate (0.12). Returns null when the value is
 * not a number in [0, 100) so the caller falls back to
 * platform_settings.commission_rate and then to the code default.
 */
export function commissionRateFromPercentage(raw: unknown): number | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const text = String(raw).trim();
  if (text === "") {
    return null;
  }
  const percentage = Number(text);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage >= 100) {
    return null;
  }
  return normalizeRate(percentage / 100);
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** "true"/"false"/"1"/"0" (case-insensitive); anything else -> null. */
function parseBoolean(raw: string): boolean | null {
  const value = raw.toLowerCase();
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
  return null;
}

function positiveNumber(raw: string): number | null {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Parses raw rows into typed settings; invalid values fall back to the
 * default (and are reported) instead of breaking checkout.
 */
export function parsePlatformSettings(
  rows: readonly Pick<PlatformSettingEntity, "key" | "value">[],
  onInvalid?: (key: string, value: string) => void,
): PlatformSettings {
  const settings: PlatformSettings = { ...PLATFORM_SETTING_DEFAULTS };
  for (const row of rows) {
    const raw = String(row.value).trim();
    switch (row.key) {
      case PLATFORM_SETTING_KEY.COMMISSION_RATE: {
        try {
          settings.commission_rate = normalizeRate(raw);
        } catch {
          onInvalid?.(row.key, raw);
        }
        break;
      }
      case PLATFORM_SETTING_KEY.PROVIDER_MARKUP_RATE: {
        try {
          settings.provider_markup_rate = normalizeRate(raw);
        } catch {
          onInvalid?.(row.key, raw);
        }
        break;
      }
      case PLATFORM_SETTING_KEY.DEADLINE_LOCAL_TIME: {
        if (TIME_RE.test(raw)) {
          settings.deadline_local_time = raw;
        } else {
          onInvalid?.(row.key, raw);
        }
        break;
      }
      case PLATFORM_SETTING_KEY.DEFAULT_TIMEZONE: {
        if (isValidTimezone(raw)) {
          settings.default_timezone = raw;
        } else {
          onInvalid?.(row.key, raw);
        }
        break;
      }
      case PLATFORM_SETTING_KEY.DEFERRED_CHARGE_ENABLED: {
        const value = parseBoolean(raw);
        if (value === null) {
          onInvalid?.(row.key, raw);
        } else {
          settings.deferred_charge_enabled = value;
        }
        break;
      }
      case PLATFORM_SETTING_KEY.AVAILABLE_AFTER_CHECKOUT_HOURS:
      case PLATFORM_SETTING_KEY.REGULARIZATION_WINDOW_HOURS:
      case PLATFORM_SETTING_KEY.PAYOUT_FAILURE_DAYS:
      case PLATFORM_SETTING_KEY.DEFERRED_MIN_LEAD_HOURS: {
        const value = positiveNumber(raw);
        if (value === null) {
          onInvalid?.(row.key, raw);
        } else {
          settings[row.key] = value;
        }
        break;
      }
      default:
      // Unknown keys are ignored (forward compatible).
    }
  }
  return settings;
}
