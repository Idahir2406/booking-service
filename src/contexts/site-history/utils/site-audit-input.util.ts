import { type Actor, actors } from "@/contexts/payments/domain/audit-actor";
import {
  adminActorAuditId,
  parseAdminActorHeaders,
} from "@/contexts/reservations/utils/incident-admin.util";

import {
  type FlatRecord,
  isSiteAuditAction,
  isSiteAuditSource,
  PHP_SITE_AUDIT_ACTIONS,
  SITE_AUDIT_SOURCE,
  type SiteAuditAction,
  type SiteAuditSource,
} from "./site-change.util";

/**
 * Who changed an accommodation through an internal route: admino sends the
 * x-actor-* headers (admin), the host proxies send none (host of the site).
 * Invalid headers throw InvalidAdminActorError.
 */
export function siteActorFromHeaders(
  headers: Record<string, unknown>,
  siteId: number,
): Actor {
  const admin = parseAdminActorHeaders(headers);
  if (admin) {
    return actors.admin(adminActorAuditId(admin));
  }
  return actors.host(siteId);
}

export const PHP_AUDIT_LIMITS = {
  MAX_FIELDS: 300,
  MAX_KEY: 120,
  MAX_VALUE: 4000,
  MAX_SUBJECT: 120,
} as const;

export interface PhpSiteAuditInput {
  action: SiteAuditAction;
  source: SiteAuditSource;
  before: FlatRecord;
  after: FlatRecord;
  subject: string | null;
}

export type PhpSiteAuditResult =
  | { ok: true; value: PhpSiteAuditInput }
  | { ok: false; error: string };

function flatRecord(value: unknown, name: string): FlatRecord | string {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return `${name}: must be an object`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > PHP_AUDIT_LIMITS.MAX_FIELDS) {
    return `${name}: too many fields`;
  }
  const out: FlatRecord = {};
  for (const [key, raw] of entries) {
    if (key === "" || key.length > PHP_AUDIT_LIMITS.MAX_KEY) {
      return `${name}: invalid key`;
    }
    if (raw === null || typeof raw === "boolean" || typeof raw === "number") {
      out[key] = raw;
    } else if (typeof raw === "string") {
      out[key] = raw.slice(0, PHP_AUDIT_LIMITS.MAX_VALUE);
    } else {
      return `${name}.${key}: must be a scalar`;
    }
  }
  return out;
}

/** Body of POST /sites/:siteId/audit (PHP writers). */
export function parsePhpSiteAudit(body: unknown): PhpSiteAuditResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" };
  }
  const record = body as Record<string, unknown>;
  if (
    !isSiteAuditAction(record.action) ||
    !PHP_SITE_AUDIT_ACTIONS.has(record.action)
  ) {
    return { ok: false, error: "action not allowed" };
  }
  if (!isSiteAuditSource(record.source)) {
    return { ok: false, error: "invalid source" };
  }
  const before = flatRecord(record.before, "before");
  if (typeof before === "string") {
    return { ok: false, error: before };
  }
  const after = flatRecord(record.after, "after");
  if (typeof after === "string") {
    return { ok: false, error: after };
  }
  const subject =
    typeof record.subject === "string" && record.subject.trim() !== ""
      ? record.subject.trim().slice(0, PHP_AUDIT_LIMITS.MAX_SUBJECT)
      : null;
  return {
    ok: true,
    value: {
      action: record.action,
      source: record.source,
      before,
      after,
      subject,
    },
  };
}

/** admino actions need an admin actor, host actions must not carry one. */
export function phpAuditActorMatches(
  input: PhpSiteAuditInput,
  actor: Actor,
): boolean {
  const adminSource = input.source === SITE_AUDIT_SOURCE.ADMINO;
  return adminSource === (actor.type === "admin");
}
