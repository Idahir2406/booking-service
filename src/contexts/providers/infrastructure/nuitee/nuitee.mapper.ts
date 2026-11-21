/**
 * LiteAPI (Nuitee) v3.0 payloads -> provider-agnostic domain models.
 * Tolerant by design: every field is read defensively and a missing or
 * malformed value becomes null (never throws on shape), except identifiers
 * without which the object is meaningless (offerId, prebookId, bookingId,
 * hotel id) -> NuiteeMappingError.
 */
import {
  localTimeUtcIso,
  validTimezoneOrNull,
} from "../../../payments/domain/cancellation-policy";
import { parseToCents } from "../../../payments/utils/money.util";
import {
  type BookResult,
  type CancelResult,
  type PrebookResult,
  PROVIDER_BOOKING_STATUS,
  PROVIDER_CANCEL_STATUS,
  type ProviderAddress,
  type ProviderBookingStatus,
  type ProviderCancellationPolicy,
  type ProviderCancelStatus,
  type ProviderHotel,
  type ProviderHotelRates,
  type ProviderHotelSearchResult,
  type ProviderHotelSummary,
  type ProviderImage,
  type ProviderPetPolicy,
  type ProviderRateOffer,
  type ProviderTax,
} from "../../domain/provider.types";

export class NuiteeMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NuiteeMappingError";
  }
}

type JsonRecord = Record<string, unknown>;

// --- Tolerant readers -----------------------------------------------------------

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function records(value: unknown): JsonRecord[] {
  return asArray(value)
    .map(item => asRecord(item))
    .filter((item): item is JsonRecord => item !== null);
}

function str(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function num(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const TRUE_WORDS = new Set(["y", "yes", "true", "1", "allowed", "si", "sí"]);
const FALSE_WORDS = new Set([
  "n",
  "no",
  "false",
  "0",
  "not allowed",
  "not_allowed",
  "notallowed",
]);

function bool(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    return value === 0 ? false : null;
  }
  if (typeof value === "string") {
    const word = value.trim().toLowerCase();
    if (TRUE_WORDS.has(word)) {
      return true;
    }
    if (FALSE_WORDS.has(word)) {
      return false;
    }
  }
  return null;
}

/** First non-null value of `keys` in `record`. */
function pick(record: JsonRecord | null, ...keys: string[]): unknown {
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

/** Decimal money -> integer cents; malformed -> null. */
export function moneyToCents(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }
  try {
    return parseToCents(value);
  } catch {
    return null;
  }
}

/** `{amount, currency}` or `[{amount, currency}]` (first element). */
function amountOf(value: unknown): {
  cents: number | null;
  currency: string | null;
} {
  const node = asRecord(value) ?? asRecord(asArray(value)[0]);
  if (!node) {
    return { cents: moneyToCents(value), currency: null };
  }
  return {
    cents: moneyToCents(node.amount),
    currency: upper(str(node.currency)),
  };
}

function upper(value: string | null): string | null {
  return value === null ? null : value.toUpperCase();
}

/** Unwraps `{ data: ... }`. */
function dataOf(payload: unknown): unknown {
  const record = asRecord(payload);
  return record && "data" in record ? record.data : payload;
}

// --- Cancellation policies ---------------------------------------------------------

const UTC_ZONES = new Set(["utc", "gmt", "z", "etc/utc", "etc/gmt", "+00:00"]);

/**
 * LiteAPI cancelTime ("2026-12-01 12:00:00", sometimes ISO) + timezone
 * ("GMT"/"UTC"/IANA) -> UTC ISO. Unparseable -> null.
 */
export function cancelTimeToUtcIso(
  cancelTime: unknown,
  timezone: unknown,
): string | null {
  const raw = str(cancelTime);
  if (!raw) {
    return null;
  }
  // Already carries an offset / Z: trust it.
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw) && raw.includes("T")) {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(raw);
  if (!match) {
    return null;
  }
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = match;
  const zone = str(timezone);
  const iana =
    zone && !UTC_ZONES.has(zone.toLowerCase())
      ? validTimezoneOrNull(zone)
      : null;
  if (iana) {
    // Seconds are dropped by localTimeUtcIso (deadlines are on the minute).
    try {
      return localTimeUtcIso(
        Number(y),
        Number(mo),
        Number(d),
        `${h}:${mi}`,
        iana,
      );
    } catch {
      return null;
    }
  }
  const ms = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  );
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** `cancellationPolicies.cancelPolicyInfos[]` -> sorted domain policies. */
export function mapCancelPolicyInfos(
  cancellationPolicies: unknown,
): ProviderCancellationPolicy[] {
  const infos = records(asRecord(cancellationPolicies)?.cancelPolicyInfos);
  const result: ProviderCancellationPolicy[] = [];
  for (const info of infos) {
    const deadline = cancelTimeToUtcIso(info.cancelTime, info.timezone);
    const amountCents = moneyToCents(info.amount);
    if (deadline === null || amountCents === null) {
      continue;
    }
    result.push({
      deadline,
      amountCents,
      currency: upper(str(info.currency)),
      timezone: str(info.timezone),
    });
  }
  return result.sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline));
}

/** Multi-room offers: one policy list per rate -> amounts summed per deadline. */
function mergePolicies(
  lists: ProviderCancellationPolicy[][],
): ProviderCancellationPolicy[] {
  if (lists.length <= 1) {
    return lists[0] ?? [];
  }
  const byDeadline = new Map<string, ProviderCancellationPolicy>();
  for (const list of lists) {
    for (const policy of list) {
      const existing = byDeadline.get(policy.deadline);
      byDeadline.set(
        policy.deadline,
        existing
          ? {
              ...existing,
              amountCents: existing.amountCents + policy.amountCents,
            }
          : { ...policy },
      );
    }
  }
  return [...byDeadline.values()].sort(
    (a, b) => Date.parse(a.deadline) - Date.parse(b.deadline),
  );
}

function refundableTagOf(rate: JsonRecord | null): string | null {
  return upper(
    str(asRecord(rate?.cancellationPolicies)?.refundableTag) ??
      str(rate?.refundableTag),
  );
}

// --- Taxes -------------------------------------------------------------------------

function mapTaxes(rates: JsonRecord[]): {
  included: ProviderTax[];
  notIncluded: ProviderTax[];
} {
  const included: ProviderTax[] = [];
  const notIncluded: ProviderTax[] = [];
  for (const rate of rates) {
    const retail = asRecord(rate.retailRate);
    for (const tax of records(retail?.taxesAndFees)) {
      const isIncluded = bool(tax.included) === true;
      const item: ProviderTax = {
        description: str(tax.description),
        amountCents: moneyToCents(tax.amount),
        currency: upper(str(tax.currency)),
        included: isIncluded,
      };
      (isIncluded ? included : notIncluded).push(item);
    }
  }
  return { included, notIncluded };
}

// --- Offers ------------------------------------------------------------------------

function uniqueJoin(values: (string | null)[]): string | null {
  const unique = [...new Set(values.filter((v): v is string => v !== null))];
  return unique.length > 0 ? unique.join(" + ") : null;
}

function sumRateTotals(rates: JsonRecord[]): {
  cents: number | null;
  currency: string | null;
} {
  let cents = 0;
  let currency: string | null = null;
  for (const rate of rates) {
    const total = amountOf(asRecord(rate.retailRate)?.total);
    if (total.cents === null) {
      return { cents: null, currency: null };
    }
    cents += total.cents;
    currency = currency ?? total.currency;
  }
  return rates.length > 0
    ? { cents, currency }
    : { cents: null, currency: null };
}

/**
 * One LiteAPI roomType (= one offer; `rates[]` has one rate per occupancy)
 * -> ProviderRateOffer. Net = offerRetailRate (margin 0), falling back to
 * the sum of rates[].retailRate.total.
 */
export function mapRoomTypeToOffer(
  roomType: unknown,
  hotelId: string | null,
  overrides: {
    offerId?: string | null;
    net?: unknown;
    currency?: unknown;
  } = {},
): ProviderRateOffer {
  const node = asRecord(roomType) ?? {};
  const offerId = overrides.offerId ?? str(node.offerId);
  if (!offerId) {
    throw new NuiteeMappingError("Nuitee offer without offerId");
  }
  const rates = records(node.rates);
  const first = rates[0] ?? null;

  const offerTotal =
    overrides.net !== undefined && overrides.net !== null
      ? {
          cents: moneyToCents(overrides.net),
          currency: upper(str(overrides.currency)),
        }
      : amountOf(node.offerRetailRate);
  const fallback = sumRateTotals(rates);
  const netCents = offerTotal.cents ?? fallback.cents;
  const currency = offerTotal.currency ?? fallback.currency;

  const tags = rates.map(rate => refundableTagOf(rate));
  const refundableTag = tags.includes("NRFN") ? "NRFN" : (tags[0] ?? null);
  const taxes = mapTaxes(rates);

  return {
    offerId,
    hotelId,
    roomName: uniqueJoin(rates.map(rate => str(rate.name))),
    boardCode: str(first.boardType),
    boardName: str(first.boardName),
    netCents,
    currency,
    refundable: rates.length > 0 && tags.every(tag => tag === "RFN"),
    refundableTag,
    cancellationPolicies: mergePolicies(
      rates.map(rate => mapCancelPolicyInfos(rate.cancellationPolicies)),
    ),
    taxesNotIncluded: taxes.notIncluded,
    taxesIncluded: taxes.included,
    maxOccupancy: num(first.maxOccupancy),
    remarks: str(first.remarks),
  };
}

/** POST /hotels/rates -> offers per hotel (offers without offerId skipped). */
export function mapRatesResponse(payload: unknown): ProviderHotelRates[] {
  const hotels = records(dataOf(payload));
  const result: ProviderHotelRates[] = [];
  for (const hotel of hotels) {
    const hotelId = str(hotel.hotelId) ?? str(hotel.id);
    if (!hotelId) {
      continue;
    }
    const offers: ProviderRateOffer[] = [];
    for (const roomType of records(hotel.roomTypes)) {
      if (!str(roomType.offerId)) {
        continue;
      }
      offers.push(mapRoomTypeToOffer(roomType, hotelId));
    }
    result.push({ hotelId, offers });
  }
  return result;
}

/** POST /rates/prebook */
export function mapPrebookResponse(payload: unknown): PrebookResult {
  const data = asRecord(dataOf(payload));
  const prebookId = str(data?.prebookId);
  if (!data || !prebookId) {
    throw new NuiteeMappingError("Nuitee prebook without prebookId");
  }
  const offerId = str(data.offerId);
  const hotelId = str(data.hotelId);
  const roomType = records(data.roomTypes)[0] ?? {};
  const offer = mapRoomTypeToOffer(roomType, hotelId, {
    offerId: offerId ?? str(roomType.offerId) ?? prebookId,
    net: pick(data, "price"),
    currency: pick(data, "currency"),
  });
  return {
    prebookId,
    offerId,
    hotelId,
    offer,
    priceDifferencePercent: num(data.priceDifferencePercent) ?? 0,
    cancellationChanged: bool(data.cancellationChanged) === true,
    boardChanged: bool(data.boardChanged) === true,
    termsAndConditions: str(data.termsAndConditions),
    raw: payload,
  };
}

// --- Bookings ----------------------------------------------------------------------

export function mapBookingStatus(status: unknown): ProviderBookingStatus {
  const value = str(status)?.toUpperCase() ?? "";
  if (value === "CONFIRMED") {
    return PROVIDER_BOOKING_STATUS.CONFIRMED;
  }
  if (value.startsWith("CANCELLED") || value.startsWith("CANCELED")) {
    return PROVIDER_BOOKING_STATUS.CANCELLED;
  }
  return PROVIDER_BOOKING_STATUS.PENDING_UNKNOWN;
}

function mapBookingRecord(data: JsonRecord, raw: unknown): BookResult {
  const bookingId = str(data.bookingId);
  if (!bookingId) {
    throw new NuiteeMappingError("Nuitee booking without bookingId");
  }
  const hotel = asRecord(data.hotel);
  const rooms = records(data.bookedRooms);
  const priceCents = moneyToCents(data.price);
  const roomsTotal = sumRateTotals(
    rooms.map(room => asRecord(room.rate) ?? {}),
  );
  const policies = data.cancellationPolicies
    ? mapCancelPolicyInfos(data.cancellationPolicies)
    : mergePolicies(
        rooms.map(room =>
          mapCancelPolicyInfos(asRecord(room.rate)?.cancellationPolicies),
        ),
      );
  return {
    bookingId,
    clientReference: str(data.clientReference),
    status: mapBookingStatus(data.status),
    rawStatus: str(data.status),
    hotelConfirmationCode: str(data.hotelConfirmationCode),
    supplierBookingId: str(data.supplierBookingId),
    hotelId: str(hotel?.hotelId) ?? str(data.hotelId),
    checkin: str(data.checkin),
    checkout: str(data.checkout),
    totalCents: priceCents ?? roomsTotal.cents,
    currency: upper(str(data.currency)) ?? roomsTotal.currency,
    cancellationPolicies: policies,
    raw,
  };
}

/** POST /rates/book and GET /bookings/{id}. */
export function mapBookingResponse(payload: unknown): BookResult {
  const data = asRecord(dataOf(payload));
  if (!data) {
    throw new NuiteeMappingError("Nuitee booking response without data");
  }
  return mapBookingRecord(data, payload);
}

/** GET /bookings?clientReference=... (rows without bookingId skipped). */
export function mapBookingListResponse(payload: unknown): BookResult[] {
  const result: BookResult[] = [];
  for (const row of records(dataOf(payload))) {
    if (!str(row.bookingId)) {
      continue;
    }
    result.push(mapBookingRecord(row, row));
  }
  return result;
}

function mapCancelStatus(status: unknown): ProviderCancelStatus {
  const value = str(status)?.toUpperCase() ?? "";
  if (value === "CANCELLED_WITH_CHARGES" || value === "CANCELED_WITH_CHARGES") {
    return PROVIDER_CANCEL_STATUS.CANCELLED_WITH_CHARGES;
  }
  if (value.startsWith("CANCELLED") || value.startsWith("CANCELED")) {
    return PROVIDER_CANCEL_STATUS.CANCELLED;
  }
  return PROVIDER_CANCEL_STATUS.PENDING_UNKNOWN;
}

/** PUT /bookings/{id} */
export function mapCancelResponse(payload: unknown): CancelResult {
  const data = asRecord(dataOf(payload)) ?? {};
  return {
    bookingId: str(data.bookingId),
    status: mapCancelStatus(data.status),
    rawStatus: str(data.status),
    penaltyCents: moneyToCents(
      pick(data, "cancellation_fee", "cancellationFee", "penalty"),
    ),
    refundCents: moneyToCents(
      pick(data, "refund_amount", "refundAmount", "refund"),
    ),
    currency: upper(str(data.currency)),
    raw: payload,
  };
}

// --- Hotel content -----------------------------------------------------------------

function mapAddress(data: JsonRecord): ProviderAddress {
  const address = asRecord(data.address);
  return {
    line: address
      ? str(pick(address, "line", "street", "address"))
      : str(data.address),
    city: str(data.city) ?? str(address?.city),
    postalCode: str(pick(data, "zip", "postalCode", "postal_code")),
    countryCode: upper(
      str(pick(data, "country", "countryCode", "country_code")),
    ),
  };
}

function coordinates(data: JsonRecord): {
  latitude: number | null;
  longitude: number | null;
} {
  const location = asRecord(data.location);
  return {
    latitude: num(pick(location, "latitude", "lat")) ?? num(data.latitude),
    longitude:
      num(pick(location, "longitude", "lng", "lon")) ?? num(data.longitude),
  };
}

export function mapHotelImages(data: JsonRecord): ProviderImage[] {
  const images: ProviderImage[] = [];
  for (const image of records(data.hotelImages)) {
    const url = str(image.url) ?? str(image.urlHd);
    if (!url) {
      continue;
    }
    images.push({
      url,
      urlHd: str(image.urlHd),
      caption: str(image.caption),
      order: num(image.order),
      isDefault: bool(image.defaultImage) === true,
    });
  }
  if (images.length === 0) {
    const main = str(data.main_photo) ?? str(data.mainPhoto);
    if (main) {
      images.push({
        url: main,
        urlHd: null,
        caption: null,
        order: null,
        isDefault: true,
      });
    }
  }
  return images.sort((a, b) => {
    if (a.isDefault !== b.isDefault) {
      return a.isDefault ? -1 : 1;
    }
    return (
      (a.order ?? Number.MAX_SAFE_INTEGER) -
      (b.order ?? Number.MAX_SAFE_INTEGER)
    );
  });
}

const PET_WORD =
  /\b(pet|pets|dog|dogs|animal|animals|mascota|mascotas|perro|perros)\b/i;

function petPolicyNode(data: JsonRecord): JsonRecord | null {
  return (
    records(data.policies).find(policy => {
      const label = `${str(policy.policy_type) ?? ""} ${str(policy.name) ?? ""}`;
      return PET_WORD.test(label) || str(policy.pets_allowed) !== null;
    }) ?? null
  );
}

/**
 * Pets: top-level `petsAllowed`, structured `policyAttributes.pets` and the
 * free-text `policies[].pets_allowed`. Structured data wins over text.
 */
export function mapPetPolicy(data: JsonRecord): {
  petsAllowed: boolean | null;
  petPolicy: ProviderPetPolicy;
} {
  const attributesPets = pick(asRecord(data.policyAttributes), "pets", "pet");
  const pets = asRecord(attributesPets);
  const textPolicy = petPolicyNode(data);
  const textAllowedRaw = str(textPolicy?.pets_allowed);

  const petsAllowed = bool(data.petsAllowed);
  const structuredAllowed = pets
    ? bool(pick(pets, "allowed", "petsAllowed", "isAllowed", "pets_allowed"))
    : bool(attributesPets);
  const allowed = structuredAllowed ?? petsAllowed ?? bool(textAllowedRaw);

  const feeRaw = pick(pets, "fee", "hasFee", "chargeable", "isChargeable");
  const feeAmountRaw =
    pick(pets, "feeAmount", "fee_amount", "amount", "price") ??
    (typeof feeRaw === "number" ? feeRaw : undefined);
  const feeAmountCents = moneyToCents(feeAmountRaw);
  const fee =
    typeof feeRaw === "number"
      ? feeRaw > 0
      : (bool(feeRaw) ?? (feeAmountCents === null ? null : feeAmountCents > 0));

  const textCandidates = [
    str(pick(pets, "text", "description", "policy")),
    str(textPolicy?.description),
    textAllowedRaw !== null && bool(textAllowedRaw) === null
      ? textAllowedRaw
      : null,
  ];
  return {
    petsAllowed,
    petPolicy: {
      allowed,
      fee,
      feeAmountCents,
      feeCurrency: upper(
        str(pick(pets, "feeCurrency", "fee_currency", "currency")),
      ),
      feeBasis: str(pick(pets, "feeBasis", "fee_basis", "basis", "per")),
      weightLimit: str(pick(pets, "weightLimit", "weight_limit", "maxWeight")),
      terms: str(pick(pets, "terms", "conditions", "restrictions")),
      text: textCandidates.find(value => value !== null) ?? null,
    },
  };
}

/** GET /data/hotel?hotelId= */
export function mapHotelResponse(payload: unknown): ProviderHotel {
  const data = asRecord(dataOf(payload));
  const id = str(data?.id) ?? str(data?.hotelId);
  if (!data || !id) {
    throw new NuiteeMappingError("Nuitee hotel without id");
  }
  const times = asRecord(data.checkinCheckoutTimes);
  const { latitude, longitude } = coordinates(data);
  const pets = mapPetPolicy(data);
  return {
    id,
    name: str(data.name) ?? id,
    address: mapAddress(data),
    latitude,
    longitude,
    starRating: num(pick(data, "starRating", "stars")),
    petsAllowed: pets.petsAllowed,
    petPolicy: pets.petPolicy,
    images: mapHotelImages(data),
    description: str(data.hotelDescription) ?? str(data.description),
    importantInformation: str(data.hotelImportantInformation),
    checkinTime: str(pick(times, "checkin", "checkinStart", "checkin_start")),
    checkoutTime: str(pick(times, "checkout")),
    timezone: validTimezoneOrNull(
      str(pick(data, "timezone", "timeZone")) ??
        str(pick(asRecord(data.location), "timezone", "timeZone")),
    ),
  };
}

/** GET /data/hotels */
export function mapHotelSearchResponse(
  payload: unknown,
): ProviderHotelSearchResult {
  const hotels: ProviderHotelSummary[] = [];
  for (const row of records(dataOf(payload))) {
    const id = str(row.id) ?? str(row.hotelId);
    if (!id) {
      continue;
    }
    const { latitude, longitude } = coordinates(row);
    hotels.push({
      id,
      name: str(row.name) ?? id,
      address: mapAddress(row),
      latitude,
      longitude,
      starRating: num(pick(row, "stars", "starRating")),
      petsAllowed: bool(row.petsAllowed),
      mainPhotoUrl: str(row.main_photo) ?? str(row.thumbnail),
    });
  }
  return { hotels, total: num(asRecord(payload)?.total) };
}
