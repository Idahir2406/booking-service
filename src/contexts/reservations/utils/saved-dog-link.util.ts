import type { SnapshotDog } from "../../payments/domain/reservation-snapshot";

/** Positive-int saved_dog_id requested per declared dog (index-aligned). */
export function requestedSavedDogIds(
  dogs: readonly { saved_dog_id?: number }[] | undefined | null,
): number[] {
  return (dogs ?? [])
    .map(dog => dog.saved_dog_id)
    .filter((id): id is number => Number.isInteger(id) && id! > 0);
}

export interface SavedDogLinkResult {
  dogs: SnapshotDog[];
  /** Requested ids that were not kept (foreign, deleted, duplicate). */
  dropped: number[];
}

/**
 * Copies the frozen snapshot dogs adding `saved_dog_id` only when the id is
 * in `ownedIds` (already verified: owned by the traveler and not deleted).
 * A saved dog can be linked to one row only; repeats are dropped. Pure: the
 * input array/objects are never mutated.
 */
export function linkSavedDogs(
  snapshotDogs: readonly SnapshotDog[],
  declared: readonly { saved_dog_id?: number }[] | undefined | null,
  ownedIds: ReadonlySet<number>,
): SavedDogLinkResult {
  const used = new Set<number>();
  const dropped: number[] = [];
  const dogs = snapshotDogs.map(dog => {
    const copy: SnapshotDog = {
      ...dog,
      size: dog.size === null ? null : { ...dog.size },
    };
    delete copy.saved_dog_id;
    const requested = declared?.[dog.index]?.saved_dog_id;
    if (requested === undefined || requested === null) {
      return copy;
    }
    if (ownedIds.has(requested) && !used.has(requested)) {
      used.add(requested);
      copy.saved_dog_id = requested;
    } else {
      dropped.push(requested);
    }
    return copy;
  });
  return { dogs, dropped };
}
