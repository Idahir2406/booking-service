import type { SnapshotDog } from "@/src/contexts/payments/domain/reservation-snapshot";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { CheckoutReservationDto } from "@/src/contexts/reservations/dto/checkout-reservation.dto";
import { QuoteReservationDto } from "@/src/contexts/reservations/dto/quote-reservation.dto";
import {
  linkSavedDogs,
  requestedSavedDogIds,
} from "@/src/contexts/reservations/utils/saved-dog-link.util";

const BASE = {
  site_id: 42,
  room_id: 3,
  checkin: "2027-05-10",
  checkout: "2027-05-12",
  guests: 2,
};

const CHECKOUT_BASE = {
  ...BASE,
  guest_name: "Ana",
  guest_email: "ana@example.com",
  guest_phone: "600000000",
};

const errorsFor = async (
  cls: typeof QuoteReservationDto | typeof CheckoutReservationDto,
  body: Record<string, unknown>,
) => {
  const errors = await validate(plainToInstance(cls, body));
  return errors.map(error => error.property);
};

const dogRow = (index: number, name: string): SnapshotDog => ({
  index,
  name,
  weight_kg: 8,
  is_ppp: false,
  room_id: 3,
  size: { id: 1, name: "Pequeño", slug: "pequeno", rank: 1 },
});

describe("ReservationDogDto.saved_dog_id", () => {
  it("is optional on quote and checkout", async () => {
    const dogs = [{ name: "Luna", weight_kg: 8, is_ppp: false }];
    expect(await errorsFor(QuoteReservationDto, { ...BASE, dogs })).toEqual([]);
    expect(
      await errorsFor(CheckoutReservationDto, { ...CHECKOUT_BASE, dogs }),
    ).toEqual([]);
  });

  it("accepts a positive integer", async () => {
    const dogs = [
      { name: "Luna", weight_kg: 8, is_ppp: false, saved_dog_id: 501 },
    ];
    expect(
      await errorsFor(CheckoutReservationDto, { ...CHECKOUT_BASE, dogs }),
    ).toEqual([]);
  });

  it.each([0, -3, 1.5, "501"])("rejects %s", async value => {
    const dogs = [
      { name: "Luna", weight_kg: 8, is_ppp: false, saved_dog_id: value },
    ];
    expect(
      await errorsFor(CheckoutReservationDto, { ...CHECKOUT_BASE, dogs }),
    ).toEqual(["dogs"]);
  });
});

describe("linkSavedDogs", () => {
  it("adds owned ids by declared index, drops others, never mutates input", () => {
    const frozen = [dogRow(0, "Luna"), dogRow(1, "Max"), dogRow(2, "Kira")];
    const declared = [{ saved_dog_id: 7 }, { saved_dog_id: 8 }, {}];

    const result = linkSavedDogs(frozen, declared, new Set([7]));

    expect(result.dogs.map(dog => dog.saved_dog_id)).toEqual([
      7,
      undefined,
      undefined,
    ]);
    expect(result.dogs[1]).not.toHaveProperty("saved_dog_id");
    expect(result.dropped).toEqual([8]);
    expect(frozen[0]).not.toHaveProperty("saved_dog_id");
    expect(result.dogs[0].size).not.toBe(frozen[0].size);
  });

  it("requestedSavedDogIds keeps positive integers only", () => {
    expect(
      requestedSavedDogIds([
        { saved_dog_id: 5 },
        {},
        { saved_dog_id: 0 },
        { saved_dog_id: 9 },
      ]),
    ).toEqual([5, 9]);
    expect(requestedSavedDogIds(undefined)).toEqual([]);
  });
});
