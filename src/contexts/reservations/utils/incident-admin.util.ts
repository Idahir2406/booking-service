import {
  INCIDENT_STATUS,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  incidentStateMachine,
  type IncidentStatus,
  type IncidentType,
  OPEN_INCIDENT_STATUSES,
} from "./reservation-incident.util";

/**
 * Backoffice fase 1 (admino "OPERACIONES RESERVAS > INCIDENCIAS"): pure
 * helpers of the internal read routes and of the admin actor headers. SQL is
 * only ever built from constants + placeholders; filter values travel as
 * params.
 */

// ------------------------------------------------------------------ actor

export const ADMIN_ACTOR_HEADER = {
  ID: "x-actor-id",
  NAME: "x-actor-name",
} as const;

export const ADMIN_ACTOR_NAME_MAX = 100;

/** Who acted from admino (validated headers). Missing = legacy "v4p". */
export interface IncidentAdminActor {
  id: number | null;
  name: string | null;
}

export class InvalidAdminActorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAdminActorError";
  }
}

function headerValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return headerValue(value[0]);
  }
  return typeof value === "string" ? value : undefined;
}

function hasControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index) ?? 0;
    if (code < 32 || code === 127) {
      return true;
    }
  }
  return false;
}

/**
 * x-actor-id: positive int (optional). x-actor-name: 1..100 chars without
 * control characters (optional). Neither header → null (current behaviour).
 * A header that is present but invalid throws (never silently dropped).
 */
export function parseAdminActorHeaders(
  headers: Record<string, unknown>,
): IncidentAdminActor | null {
  const rawId = headerValue(headers[ADMIN_ACTOR_HEADER.ID]);
  const rawName = headerValue(headers[ADMIN_ACTOR_HEADER.NAME]);
  if (rawId === undefined && rawName === undefined) {
    return null;
  }
  let id: number | null = null;
  if (rawId !== undefined) {
    const trimmed = rawId.trim();
    if (!/^[1-9]\d{0,9}$/.test(trimmed) || Number(trimmed) > 2_147_483_647) {
      throw new InvalidAdminActorError("x-actor-id must be a positive integer");
    }
    id = Number(trimmed);
  }
  let name: string | null = null;
  if (rawName !== undefined) {
    const trimmed = rawName.trim();
    if (
      trimmed === "" ||
      trimmed.length > ADMIN_ACTOR_NAME_MAX ||
      hasControlChars(trimmed)
    ) {
      throw new InvalidAdminActorError(
        `x-actor-name must be 1-${ADMIN_ACTOR_NAME_MAX} printable characters`,
      );
    }
    name = trimmed;
  }
  return { id, name };
}

/** audit_logs.actor_id (varchar 64): numeric id, else `admino:{name}`. */
export function adminActorAuditId(
  actor: IncidentAdminActor | null,
): string | null {
  if (!actor) {
    return null;
  }
  if (actor.id !== null) {
    return String(actor.id);
  }
  return actor.name === null ? null : `admino:${actor.name}`.slice(0, 64);
}

/** Payload fragment for reservation_events (only when an actor was sent). */
export function adminActorPayload(
  actor: IncidentAdminActor | null,
): Record<string, unknown> {
  return actor ? { actor: { id: actor.id, name: actor.name } } : {};
}

// ------------------------------------------------------------ transitions

/** Targets V4P may pick now (the state machine is the only source). */
export function allowedNextStatuses(from: IncidentStatus): IncidentStatus[] {
  return [...incidentStateMachine.transitions[from]];
}

// ------------------------------------------------------------------- list

export const INCIDENT_LIST_STATUS_FILTER_OPEN = "open";

export const INCIDENT_LIST_LIMITS = {
  DEFAULT_LIMIT: 25,
  MAX_LIMIT: 100,
  MAX_OFFSET: 100_000,
  Q_MAX: 100,
} as const;

export interface IncidentListFilters {
  /** One status, or "open" (received + in_review + needs_info). */
  status?: IncidentStatus | typeof INCIDENT_LIST_STATUS_FILTER_OPEN;
  type?: IncidentType;
  blocks_payout?: boolean;
  /** YYYY-MM-DD, inclusive, on incident created_at. */
  from?: string;
  /** YYYY-MM-DD, inclusive, on incident created_at. */
  to?: string;
  q?: string;
  limit: number;
  offset: number;
}

export interface BuiltIncidentListQuery {
  listSql: string;
  listParams: unknown[];
  countSql: string;
  countParams: unknown[];
  /** Same filters except status: counters for the inbox tabs. */
  statusCountSql: string;
  statusCountParams: unknown[];
}

interface WhereClause {
  sql: string;
  params: unknown[];
}

const RESERVATION_REF = /^#?(?:res-?)?(\d{1,10})$/i;

function escapeLike(value: string): string {
  return value.replaceAll(/[\\%_]/g, match => `\\${match}`);
}

function nextDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function buildWhere(
  filters: IncidentListFilters,
  includeStatus: boolean,
): WhereClause {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (includeStatus && filters.status) {
    if (filters.status === INCIDENT_LIST_STATUS_FILTER_OPEN) {
      parts.push("i.status IN (?)");
      params.push([...OPEN_INCIDENT_STATUSES]);
    } else {
      parts.push("i.status = ?");
      params.push(filters.status);
    }
  }
  if (filters.type) {
    parts.push("i.type = ?");
    params.push(filters.type);
  }
  if (filters.blocks_payout !== undefined) {
    parts.push("i.blocks_payout = ?");
    params.push(filters.blocks_payout ? 1 : 0);
  }
  if (filters.from) {
    parts.push("i.created_at >= ?");
    params.push(`${filters.from} 00:00:00`);
  }
  if (filters.to) {
    parts.push("i.created_at < ?");
    params.push(`${nextDay(filters.to)} 00:00:00`);
  }
  const q = filters.q?.trim() ?? "";
  if (q !== "") {
    const ref = RESERVATION_REF.exec(q);
    if (ref) {
      parts.push("(i.reservation_id = ? OR i.id = ?)");
      params.push(Number(ref[1]), Number(ref[1]));
    } else if (q.includes("@")) {
      const like = `%${escapeLike(q)}%`;
      parts.push("(p.email LIKE ? OR r.guest_email LIKE ?)");
      params.push(like, like);
    } else {
      const like = `%${escapeLike(q)}%`;
      parts.push("(p.name LIKE ? OR r.guest_name LIKE ? OR s.name LIKE ?)");
      params.push(like, like, like);
    }
  }
  return {
    sql: parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "",
    params,
  };
}

/**
 * Inbox query. `legacyPrefix` is envs.DB_PREFIX (config, never user input):
 * sites1 for the accommodation name, user_profiles for the traveler.
 */
export function buildIncidentListQuery(
  filters: IncidentListFilters,
  legacyPrefix: string,
): BuiltIncidentListQuery {
  const from = `FROM reservation_incidents i
    INNER JOIN reservations r ON r.id = i.reservation_id
    LEFT JOIN \`${legacyPrefix}sites1\` s ON s.id = r.site_id
    LEFT JOIN \`${legacyPrefix}user_profiles\` p ON p.id = i.user_id`;
  const where = buildWhere(filters, true);
  const whereNoStatus = buildWhere(filters, false);

  const listSql = `SELECT i.id, i.reservation_id, i.type, i.status,
      i.blocks_payout, i.dispute_id, i.created_at, i.updated_at, i.resolved_at,
      r.status AS reservation_status, r.payment_status, r.payout_status,
      r.checkin, r.checkout, s.name AS site_name,
      p.name AS profile_name, p.email AS profile_email,
      r.guest_name, r.guest_email,
      (SELECT COUNT(*) FROM reservation_incident_messages m WHERE m.incident_id = i.id) AS message_count,
      (SELECT COUNT(*) FROM reservation_incident_attachments a WHERE a.incident_id = i.id) AS attachment_count,
      (SELECT MAX(m2.created_at) FROM reservation_incident_messages m2 WHERE m2.incident_id = i.id) AS last_message_at,
      (SELECT MAX(a2.created_at) FROM reservation_incident_attachments a2 WHERE a2.incident_id = i.id) AS last_attachment_at
    ${from}
    ${where.sql}
    ORDER BY i.created_at DESC, i.id DESC
    LIMIT ? OFFSET ?`;

  return {
    listSql,
    listParams: [...where.params, filters.limit, filters.offset],
    countSql: `SELECT COUNT(*) AS total ${from} ${where.sql}`,
    countParams: [...where.params],
    statusCountSql: `SELECT i.status AS status, COUNT(*) AS total ${from} ${whereNoStatus.sql} GROUP BY i.status`,
    statusCountParams: [...whereNoStatus.params],
  };
}

export function emptyStatusCounts(): Record<IncidentStatus, number> {
  return Object.fromEntries(
    INCIDENT_STATUSES.map(status => [status, 0]),
  ) as Record<IncidentStatus, number>;
}

export function isIncidentType(value: unknown): value is IncidentType {
  return (
    typeof value === "string" &&
    (INCIDENT_TYPES as readonly string[]).includes(value)
  );
}

const HOUR_MS = 60 * 60 * 1000;

/** Hours since creation (until resolution for resolved incidents). */
export function incidentAgeHours(
  createdAt: Date | string | null | undefined,
  resolvedAt: Date | string | null | undefined,
  status: IncidentStatus,
  now: Date,
): number {
  if (!createdAt) {
    return 0;
  }
  const start = new Date(createdAt).getTime();
  const endSource =
    status === INCIDENT_STATUS.RESOLVED && resolvedAt
      ? new Date(resolvedAt)
      : now;
  const end = endSource.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }
  return Math.floor((end - start) / HOUR_MS);
}

/** Latest of the given timestamps (ISO) or null. */
export function latestIso(
  ...values: (Date | string | null | undefined)[]
): string | null {
  let best: number | null = null;
  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }
    const time = new Date(value).getTime();
    if (Number.isFinite(time) && (best === null || time > best)) {
      best = time;
    }
  }
  return best === null ? null : new Date(best).toISOString();
}
