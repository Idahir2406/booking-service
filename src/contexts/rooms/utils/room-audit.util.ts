import type { RoomEntity } from "../entities/room.entity";

/**
 * Business fields of a room for the accommodation history (prices, capacity,
 * board options, extras, photos). Ids/sort/timestamps are left out so they
 * never appear as changes.
 */
export function auditableRoom(room: RoomEntity | null | undefined) {
  if (!room) {
    return;
  }
  return {
    name: room.name,
    description: room.description ?? null,
    price_per_night: room.price_per_night,
    max_guests: room.max_guests,
    max_pets: room.max_pets,
    bathrooms: room.bathrooms,
    is_active: room.is_active,
    image1: room.image1 ?? null,
    image2: room.image2 ?? null,
    image3: room.image3 ?? null,
    image4: room.image4 ?? null,
    image5: room.image5 ?? null,
    board_options: room.board_options.map(option => ({
      code: option.code,
      price: option.price,
      is_included: option.is_included,
      is_default: option.is_default,
      is_active: option.is_active,
    })),
    extras: room.extras.map(extra => ({
      name: extra.name,
      description: extra.description ?? null,
      pricing_mode: extra.pricing_mode,
      price: extra.price,
      is_active: extra.is_active,
    })),
  };
}
