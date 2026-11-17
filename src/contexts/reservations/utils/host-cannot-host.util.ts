import { getCheckoutStartUtc } from "./reservation-policy.util";

/**
 * "Comunicar imposibilidad de alojar" (host -> V4P review). Pure rules shared
 * by the service (validation) and the host list (button visibility).
 */
export const HOST_CANNOT_HOST_REASON = {
  OVERBOOKING: "overbooking",
  DAMAGE_OR_REPAIRS: "damage_or_repairs",
  SUPPLY_FAILURE: "supply_failure",
  FORCE_MAJEURE: "force_majeure",
  PERSONAL: "personal",
  OTHER: "other",
} as const;

export type HostCannotHostReason =
  (typeof HOST_CANNOT_HOST_REASON)[keyof typeof HOST_CANNOT_HOST_REASON];

export const HOST_CANNOT_HOST_REASONS = Object.values(HOST_CANNOT_HOST_REASON);

/** Spanish label stored in the incident description (admino reads it). */
export const HOST_CANNOT_HOST_REASON_LABEL: Readonly<
  Record<HostCannotHostReason, string>
> = {
  overbooking: "Sobreventa / reserva duplicada",
  damage_or_repairs: "Daños u obras en el alojamiento",
  supply_failure: "Avería de suministros (agua, luz, calefacción…)",
  force_majeure: "Causa de fuerza mayor",
  personal: "Motivo personal del anfitrión",
  other: "Otro motivo",
};

/** `other` needs a description so V4P can act. */
export const HOST_CANNOT_HOST_REASONS_REQUIRING_DESCRIPTION: readonly HostCannotHostReason[] =
  [HOST_CANNOT_HOST_REASON.OTHER];

export const HOST_CANNOT_HOST_DECISION = {
  APPROVE: "approve",
  REJECT: "reject",
} as const;

export type HostCannotHostDecision =
  (typeof HOST_CANNOT_HOST_DECISION)[keyof typeof HOST_CANNOT_HOST_DECISION];

export const HOST_CANNOT_HOST_CANCEL_REASON = "host_cannot_host";

export interface HostCannotHostInput {
  status: string;
  payout_status?: string | null;
  checkout: string;
}

/**
 * The host may report it while the reservation is confirmed and the stay has
 * not ended (before check-out day), unless the payout was already released.
 * An already blocked payout (open incident/no-show) does not prevent it.
 */
export function canReportHostCannotHost(
  reservation: HostCannotHostInput,
  now: Date = new Date(),
): boolean {
  return (
    reservation.status === "confirmed" &&
    reservation.payout_status !== "released" &&
    now.getTime() < getCheckoutStartUtc(reservation.checkout).getTime()
  );
}
