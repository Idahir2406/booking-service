/** F-PV5: max saved dogs per traveler (plan: MAX_TRAVELER_DOGS). */
export const MAX_TRAVELER_DOGS = 10;

/** Same limit as ReservationDogDto.name / traveler_dogs.name varchar(60). */
export const TRAVELER_DOG_NAME_MAX_LENGTH = 60;

/**
 * D5: the photo is stored by PHP outside the public web root and served only
 * through the session proxy (ownership check). The API keeps just the random
 * storage key (32 hex + re-encoded extension): no directories, no traversal.
 */
export const TRAVELER_DOG_PHOTO_KEY_PATTERN = /^[a-f0-9]{32}\.(?:webp|jpg)$/;
