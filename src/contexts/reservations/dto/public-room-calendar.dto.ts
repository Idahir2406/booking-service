/**
 * Public (traveler-facing) room calendar. Only what the date picker needs:
 * no guest data, no amounts, no ids of other reservations (F0).
 */
export interface PublicAvailabilityDay {
  date: string;
  is_available: boolean;
  min_nights: number;
  max_nights: number;
}

export interface PublicBlockRange {
  start_date: string;
  end_date: string;
  type: string;
}

export interface PublicOccupiedRange {
  checkin: string;
  checkout: string;
}

export interface PublicRoomCalendarDto {
  room_id: number;
  availability: PublicAvailabilityDay[];
  blocks: PublicBlockRange[];
  reservations: PublicOccupiedRange[];
}
