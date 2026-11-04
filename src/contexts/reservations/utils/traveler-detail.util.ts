import type { SnapshotCompatibility } from "../../payments/domain/reservation-snapshot";

/**
 * Legacy jsites1 address parts. jsites1 has no street / postcode columns
 * (checked 2026-10-23): only town (poblacio) and province (provincia).
 * `street` / `postcode` are kept as optional slots for a future source.
 */
export interface SiteAddressParts {
  street?: string | null;
  postcode?: string | null;
  town?: string | null;
  province?: string | null;
}

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.replaceAll(/\s+/g, " ").trim() : "";
}

/**
 * Panel del viajero §5.1: "street, postcode town (province)" with every empty
 * part dropped; province is skipped when it repeats the town (case-insensitive).
 * Returns null when nothing is left.
 */
export function composeSiteAddress(
  parts: SiteAddressParts | null,
): string | null {
  if (!parts) {
    return null;
  }
  const street = clean(parts.street);
  const postcode = clean(parts.postcode);
  const town = clean(parts.town);
  const province = clean(parts.province);

  const locality = [postcode, town].filter(Boolean).join(" ");
  const showProvince =
    province !== "" && province.toLowerCase() !== town.toLowerCase();
  let address = [street, locality].filter(Boolean).join(", ");
  if (showProvince) {
    // "(province)" glues to the locality; alone (no street/town) it is plain.
    address =
      locality === ""
        ? [address, province].filter(Boolean).join(", ")
        : `${address} (${province})`;
  }
  return address === "" ? null : address;
}

/**
 * Panel del viajero §5.2: frozen compatibility verdict for the declared dogs.
 * - null when the snapshot has no compatibility (f1/legacy/manual snapshots)
 *   or when no dogs were declared (nothing to assert);
 * - otherwise the frozen `compatible` flag. Never recomputed against the
 *   live host policy.
 */
export function resolveDogsCompatible(
  compatibility: SnapshotCompatibility | null | undefined,
  declaredDogs: number,
): boolean | null {
  if (!compatibility || typeof compatibility.compatible !== "boolean") {
    return null;
  }
  if (!compatibility.dogs_declared || declaredDogs < 1) {
    return null;
  }
  return compatibility.compatible;
}
