import type { ReservationEntity } from "../entities/reservation.entity";

/**
 * Amount a reservation must be paid with (Stripe Checkout + webhook check).
 * F2 rows: total_cents (frozen sum of price lines). Legacy rows (no
 * total_cents): round((subtotal + legacy surcharge) x 100).
 */
export function expectedChargeCents(
  reservation: Pick<
    ReservationEntity,
    "total_cents" | "subtotal" | "commission"
  >,
): number {
  if (
    reservation.total_cents !== null &&
    reservation.total_cents !== undefined &&
    Number.isSafeInteger(Number(reservation.total_cents))
  ) {
    return Number(reservation.total_cents);
  }
  return Math.round(
    (Number(reservation.subtotal) + (Number(reservation.commission) || 0)) *
      100,
  );
}
