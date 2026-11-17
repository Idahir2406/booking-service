/**
 * Activity history of a reservation (2026-11-16, phase 1): who did what and
 * when, to clear up discrepancies between traveler, host and V4P. Built from
 * what is already stored (reservation_events + the creation row of
 * audit_log); nothing new is written here. Pure: no I/O.
 *
 * Audience:
 * - host: no Stripe ids, no free text written by V4P to the traveler, no
 *   incident chat content (only that a message was sent).
 * - admin: same items plus notes and the admin name.
 */

export type HistoryActor = "system" | "traveler" | "host" | "admin" | "stripe";
export type HistoryAudience = "host" | "admin";

export interface HistoryEventInput {
  event_type: string;
  payload?: Record<string, unknown> | null;
  created_at: Date;
}

export interface HistoryAuditInput {
  action: string;
  actor_type: string;
  actor_id?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: Date;
}

export interface ReservationHistoryItem {
  at: string;
  action: string;
  label: string;
  actor: HistoryActor;
  actor_label: string;
  detail: string | null;
}

interface EventSpec {
  label: string;
  actor: HistoryActor;
}

/** Default label + actor per event type (payload.by / payload.actor override the actor). */
const EVENT_SPECS: Readonly<Record<string, EventSpec>> = {
  payment_confirmed: { label: "Pago confirmado", actor: "stripe" },
  checkout_session_replaced: {
    label: "Enlace de pago renovado",
    actor: "traveler",
  },
  pending_expired: { label: "Reserva caducada sin pago", actor: "system" },
  reactivated_after_expiry: {
    label: "Reserva reactivada tras pago tardío",
    actor: "system",
  },
  payment_auto_refunded: {
    label: "Pago tardío reembolsado automáticamente",
    actor: "system",
  },
  setup_dates_unavailable: {
    label: "Fechas no disponibles al confirmar",
    actor: "system",
  },
  deferred_charge_processing: {
    label: "Cobro diferido en curso",
    actor: "system",
  },
  deferred_charge_paid: { label: "Cobro diferido realizado", actor: "system" },
  deferred_charge_failed: { label: "Cobro diferido fallido", actor: "system" },
  cancellation_penalty_charged: {
    label: "Penalización de cancelación cobrada",
    actor: "system",
  },
  cancelled: { label: "Reserva cancelada", actor: "traveler" },
  finalized: { label: "Estancia finalizada", actor: "host" },
  exceptional_refund_requested: {
    label: "Reembolso excepcional solicitado",
    actor: "host",
  },
  refund_created: { label: "Reembolso emitido", actor: "system" },
  refund_approved: { label: "Reembolso aprobado", actor: "admin" },
  refund_failed: { label: "Reembolso fallido", actor: "stripe" },
  charge_refunded: { label: "Reembolso registrado en Stripe", actor: "stripe" },
  payout_released: { label: "Pago liberado al alojamiento", actor: "system" },
  payout_failed: { label: "Pago al alojamiento fallido", actor: "stripe" },
  payout_synced_from_webhook: {
    label: "Pago al alojamiento sincronizado",
    actor: "stripe",
  },
  no_show_reported: { label: "No presentación comunicada", actor: "host" },
  no_show_confirmed: { label: "No presentación confirmada", actor: "admin" },
  no_show_rejected: { label: "No presentación rechazada", actor: "admin" },
  host_cannot_host_reported: {
    label: "Imposibilidad de alojar comunicada",
    actor: "host",
  },
  host_cannot_host_approved: {
    label: "Imposibilidad de alojar aprobada (cancelación)",
    actor: "admin",
  },
  host_cannot_host_rejected: {
    label: "Imposibilidad de alojar rechazada",
    actor: "admin",
  },
  incident_opened: { label: "Incidencia abierta", actor: "traveler" },
  incident_status_changed: {
    label: "Estado de incidencia cambiado",
    actor: "admin",
  },
  incident_message_admin: {
    label: "Mensaje de viajes4patas en incidencia",
    actor: "admin",
  },
  incident_message_traveler: {
    label: "Mensaje del viajero en incidencia",
    actor: "traveler",
  },
  incident_attachment_added: {
    label: "Adjunto añadido a incidencia",
    actor: "traveler",
  },
  feedback_review: { label: "Valoración enviada", actor: "traveler" },
  feedback_report: {
    label: "Problema comunicado tras la estancia",
    actor: "traveler",
  },
  change_request_created: {
    label: "Solicitud de cambio creada",
    actor: "traveler",
  },
  change_request_cancelled: {
    label: "Solicitud de cambio retirada",
    actor: "traveler",
  },
  change_request_status_changed: {
    label: "Solicitud de cambio actualizada",
    actor: "admin",
  },
  change_proposal_created: {
    label: "Propuesta de cambio enviada",
    actor: "admin",
  },
  change_proposal_accepted: {
    label: "Propuesta de cambio aceptada",
    actor: "traveler",
  },
  change_proposal_rejected: {
    label: "Propuesta de cambio rechazada",
    actor: "traveler",
  },
  change_applied: { label: "Cambio aplicado a la reserva", actor: "system" },
  alternative_created: { label: "Alternativa propuesta", actor: "admin" },
  alternative_accepted: { label: "Alternativa aceptada", actor: "traveler" },
  alternative_rejected: { label: "Alternativa rechazada", actor: "traveler" },
};

/** Events never shown to the host (internal/technical). */
const HOST_HIDDEN_EVENTS: ReadonlySet<string> = new Set([
  "checkout_session_replaced",
  "payout_synced_from_webhook",
  "charge_refunded",
]);

const ACTOR_LABELS: Readonly<Record<HistoryActor, string>> = {
  system: "Sistema",
  traveler: "Viajero",
  host: "Alojamiento",
  admin: "viajes4patas",
  stripe: "Stripe",
};

const ACTORS: ReadonlySet<string> = new Set<HistoryActor>([
  "system",
  "traveler",
  "host",
  "admin",
  "stripe",
]);

function isActor(value: unknown): value is HistoryActor {
  return typeof value === "string" && ACTORS.has(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function money(cents: unknown): string | null {
  const value = Number(cents);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return `${(value / 100).toFixed(2).replace(".", ",")} €`;
}

function humanize(eventType: string): string {
  const spaced = eventType.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function adminName(payload: Record<string, unknown>): string | null {
  const actor = payload.actor;
  if (actor && typeof actor === "object") {
    return text((actor as { name?: unknown }).name);
  }
  return text(payload.actor_name) ?? text(payload.admin_name);
}

function resolveActor(
  spec: EventSpec | undefined,
  payload: Record<string, unknown>,
): HistoryActor {
  if (isActor(payload.by)) {
    return payload.by;
  }
  if (payload.actor && typeof payload.actor === "object") {
    return "admin";
  }
  return spec?.actor ?? "system";
}

function eventDetail(
  payload: Record<string, unknown>,
  audience: HistoryAudience,
): string | null {
  const parts: string[] = [];
  const amount =
    money(payload.refund_cents) ??
    money(payload.amount_cents) ??
    money(payload.penalty_cents);
  if (amount) {
    parts.push(`Importe: ${amount}`);
  }
  const reason = text(payload.reason);
  if (reason) {
    parts.push(`Motivo: ${reason}`);
  }
  const status = text(payload.to) ?? text(payload.status);
  if (status) {
    parts.push(`Estado: ${status}`);
  }
  if (audience === "admin") {
    const note = text(payload.note);
    if (note) {
      parts.push(`Nota: ${note}`);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function buildReservationHistory(
  events: readonly HistoryEventInput[],
  audits: readonly HistoryAuditInput[],
  audience: HistoryAudience,
): ReservationHistoryItem[] {
  const items: ReservationHistoryItem[] = [];

  for (const audit of audits) {
    if (audit.action !== "reservation.created") {
      continue;
    }
    const actor = isActor(audit.actor_type) ? audit.actor_type : "system";
    items.push({
      at: audit.created_at.toISOString(),
      action: "created",
      label: "Reserva creada",
      actor,
      actor_label: ACTOR_LABELS[actor],
      detail: null,
    });
  }

  for (const event of events) {
    if (audience === "host" && HOST_HIDDEN_EVENTS.has(event.event_type)) {
      continue;
    }
    const payload = event.payload ?? {};
    const spec: EventSpec | undefined = Object.hasOwn(
      EVENT_SPECS,
      event.event_type,
    )
      ? EVENT_SPECS[event.event_type]
      : undefined;
    const actor = resolveActor(spec, payload);
    const name = audience === "admin" ? adminName(payload) : null;
    items.push({
      at: event.created_at.toISOString(),
      action: event.event_type,
      label: spec?.label ?? humanize(event.event_type),
      actor,
      actor_label:
        name && actor === "admin"
          ? `${ACTOR_LABELS.admin} (${name})`
          : ACTOR_LABELS[actor],
      detail: eventDetail(payload, audience),
    });
  }

  return items.sort((a, b) => a.at.localeCompare(b.at));
}
