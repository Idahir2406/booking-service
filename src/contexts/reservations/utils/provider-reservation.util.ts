import type { ReservationEntity } from "../entities/reservation.entity";

/**
 * External provider reservation (source = nuitee): no V4P room, nights,
 * availability or host payout. Booked by ProviderBookingService.
 */
export function isProviderReservation(
  reservation: Pick<ReservationEntity, "source">,
): boolean {
  return reservation.source === "nuitee";
}
