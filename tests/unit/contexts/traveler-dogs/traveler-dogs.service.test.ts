import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { FakeEntityStore } from "@/tests/utils/fake-entity-store";

import { DogSizeEntity } from "@/src/contexts/dog-sizes/entities/dog-size.entity";
import { ReservationSnapshotEntity } from "@/src/contexts/payments/entities/reservation-snapshot.entity";
import { SpeciesEntity } from "@/src/contexts/species/entities/species.entity";
import { MAX_TRAVELER_DOGS } from "@/src/contexts/traveler-dogs/domain/traveler-dog.constants";
import {
  CreateTravelerDogDto,
  UpdateTravelerDogDto,
} from "@/src/contexts/traveler-dogs/dto/traveler-dog.dto";
import { TravelerDogEntity } from "@/src/contexts/traveler-dogs/entities/traveler-dog.entity";
import { TravelerDogsService } from "@/src/contexts/traveler-dogs/services/traveler-dogs.service";

const OWNER = 10;
const OTHER = 99;
const PHOTO_KEY = `${"a".repeat(32)}.webp`;

async function setup() {
  const store = new FakeEntityStore();
  const species = (await store
    .repository(SpeciesEntity)
    .save({ name: "Perro" })) as unknown as SpeciesEntity;
  // Seeds of the F2 quote: Pequeño 0–10, Mediano 10.01–20, Grande 20.01–40, Extra grande > 40.
  for (const [rank, name, slug, min, max] of [
    [1, "Pequeño", "pequeno", 0, "10.00"],
    [2, "Mediano", "mediano", 10.01, "20.00"],
    [3, "Grande", "grande", 20.01, "40.00"],
    [4, "Extra grande", "extra-grande", 40.01, null],
  ] as const) {
    await store.repository(DogSizeEntity).save({
      species_id: species.id,
      rank,
      name,
      slug,
      min_kg: min,
      max_kg: max,
    });
  }
  const service = new TravelerDogsService(
    store.repository(TravelerDogEntity) as never,
    store.repository(SpeciesEntity) as never,
    store.repository(DogSizeEntity) as never,
  );
  return { store, service };
}

const dto = (
  overrides: Partial<CreateTravelerDogDto> = {},
): CreateTravelerDogDto => ({
  name: "Luna",
  weight_kg: 8.5,
  is_ppp: false,
  ...overrides,
});

const validationErrors = async (
  cls: typeof CreateTravelerDogDto | typeof UpdateTravelerDogDto,
  body: Record<string, unknown>,
) => {
  const errors = await validate(plainToInstance(cls, body));
  return errors.map(error => error.property);
};

describe("TravelerDogsService", () => {
  it("creates a dog with the size derived from the weight (F2 rule)", async () => {
    const { service } = await setup();

    const small = await service.create(OWNER, dto({ weight_kg: 10 }));
    const medium = await service.create(OWNER, dto({ weight_kg: 10.01 }));
    const xl = await service.create(OWNER, dto({ weight_kg: 55 }));

    expect(small.size?.slug).toBe("pequeno");
    expect(medium.size?.slug).toBe("mediano");
    expect(xl.size?.slug).toBe("extra-grande");
    expect(small).toMatchObject({
      name: "Luna",
      weight_kg: 10,
      is_ppp: false,
      photo_path: null,
    });
  });

  it("lists only the traveler's own, non-deleted dogs", async () => {
    const { service } = await setup();
    await service.create(OWNER, dto({ name: "Luna" }));
    const toDelete = await service.create(OWNER, dto({ name: "Toby" }));
    await service.create(OTHER, dto({ name: "Ajeno" }));

    await service.remove(OWNER, toDelete.id);
    const list = await service.list(OWNER);

    expect(list.items.map(dog => dog.name)).toEqual(["Luna"]);
    expect(list.max).toBe(MAX_TRAVELER_DOGS);
  });

  it(`rejects more than ${MAX_TRAVELER_DOGS} active dogs`, async () => {
    const { service } = await setup();
    for (let index = 0; index < MAX_TRAVELER_DOGS; index++) {
      await service.create(OWNER, dto({ name: `Perro ${index}` }));
    }

    await expect(service.create(OWNER, dto())).rejects.toBeInstanceOf(
      ConflictException,
    );
    // Deleting one frees a slot.
    const { items } = await service.list(OWNER);
    await service.remove(OWNER, items[0].id);
    await expect(service.create(OWNER, dto())).resolves.toBeDefined();
  });

  it("answers 404 when updating or deleting another traveler's dog", async () => {
    const { service } = await setup();
    const dog = await service.create(OWNER, dto());

    await expect(
      service.update(OTHER, dog.id, { name: "Robado" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(OTHER, dog.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const { items } = await service.list(OWNER);
    expect(items[0].name).toBe("Luna");
  });

  it("answers 404 for a soft-deleted dog", async () => {
    const { service } = await setup();
    const dog = await service.create(OWNER, dto());
    await service.remove(OWNER, dog.id);

    await expect(
      service.update(OWNER, dog.id, { name: "Otra" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(OWNER, dog.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("remove returns the previous photo key so the proxy can delete the file", async () => {
    const { service, store } = await setup();
    const dog = await service.create(OWNER, dto({ photo_path: PHOTO_KEY }));

    const removed = await service.remove(OWNER, dog.id);

    expect(removed.photo_path).toBe(PHOTO_KEY);
    const row = store.rows(TravelerDogEntity).find(item => item.id === dog.id);
    expect(row?.deleted_at).toBeInstanceOf(Date);
  });

  it("updates only the given fields and re-derives the size", async () => {
    const { service } = await setup();
    const dog = await service.create(OWNER, dto({ is_ppp: true }));

    const updated = await service.update(OWNER, dog.id, { weight_kg: 25 });

    expect(updated).toMatchObject({
      name: "Luna",
      weight_kg: 25,
      is_ppp: true,
    });
    expect(updated.size?.slug).toBe("grande");

    const cleared = await service.update(OWNER, dog.id, {
      photo_path: null,
    });
    expect(cleared.photo_path).toBeNull();
  });

  it("editing or deleting a saved dog never modifies reservation_snapshots", async () => {
    const { service, store } = await setup();
    const dog = await service.create(OWNER, dto());
    const frozenPayload = {
      dogs: [{ name: "Luna", weight_kg: 8.5, is_ppp: false, size: "pequeno" }],
    };
    await store.repository(ReservationSnapshotEntity).save({
      reservation_id: 1,
      version: 1,
      reason: "checkout",
      payload: frozenPayload,
    });
    const before = structuredClone(store.rows(ReservationSnapshotEntity));

    await service.update(OWNER, dog.id, {
      name: "Luna II",
      weight_kg: 30,
      is_ppp: true,
    });
    await service.remove(OWNER, dog.id);

    expect(store.rows(ReservationSnapshotEntity)).toEqual(before);
    expect(store.rows(ReservationSnapshotEntity)[0]).toMatchObject({
      payload: {
        dogs: [{ name: "Luna", weight_kg: 8.5, is_ppp: false }],
      },
    });
  });

  it("rejects an invalid user_id", async () => {
    const { service } = await setup();

    await expect(service.list(0)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(-1, dto())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe("TravelerDog DTOs", () => {
  it("accepts a valid dog", async () => {
    await expect(
      validationErrors(CreateTravelerDogDto, {
        name: "Luna",
        weight_kg: 12.35,
        is_ppp: false,
      }),
    ).resolves.toEqual([]);
  });

  it("rejects weights outside DOG_WEIGHT_LIMITS and more than 2 decimals", async () => {
    await expect(
      validationErrors(CreateTravelerDogDto, {
        name: "Luna",
        weight_kg: 0.4,
        is_ppp: false,
      }),
    ).resolves.toEqual(["weight_kg"]);
    await expect(
      validationErrors(CreateTravelerDogDto, {
        name: "Luna",
        weight_kg: 120.5,
        is_ppp: false,
      }),
    ).resolves.toEqual(["weight_kg"]);
    await expect(
      validationErrors(CreateTravelerDogDto, {
        name: "Luna",
        weight_kg: 10.123,
        is_ppp: false,
      }),
    ).resolves.toEqual(["weight_kg"]);
  });

  it("rejects blank or too long names", async () => {
    await expect(
      validationErrors(CreateTravelerDogDto, {
        name: "   ",
        weight_kg: 5,
        is_ppp: false,
      }),
    ).resolves.toEqual(["name"]);
    await expect(
      validationErrors(CreateTravelerDogDto, {
        name: "x".repeat(61),
        weight_kg: 5,
        is_ppp: false,
      }),
    ).resolves.toEqual(["name"]);
  });

  it("only accepts a bare random storage key as photo_path", async () => {
    for (const bad of [
      "../../etc/passwd",
      "images/jtraveler/abc.webp",
      `${"a".repeat(32)}.php`,
      `${"A".repeat(32)}.webp`,
    ]) {
      await expect(
        validationErrors(UpdateTravelerDogDto, { photo_path: bad }),
      ).resolves.toEqual(["photo_path"]);
    }
    await expect(
      validationErrors(UpdateTravelerDogDto, { photo_path: PHOTO_KEY }),
    ).resolves.toEqual([]);
    await expect(
      validationErrors(UpdateTravelerDogDto, { photo_path: null }),
    ).resolves.toEqual([]);
  });

  it("update DTO allows partial bodies", async () => {
    await expect(
      validationErrors(UpdateTravelerDogDto, { is_ppp: true }),
    ).resolves.toEqual([]);
  });
});

describe("TravelerDogsService.findActiveOwnedIds (reservation dog links)", () => {
  it("returns only the traveler's active dogs among the requested ids", async () => {
    const { service } = await setup();
    const luna = await service.create(OWNER, dto({ name: "Luna" }));
    const toby = await service.create(OWNER, dto({ name: "Toby" }));
    const foreign = await service.create(OTHER, dto({ name: "Ajeno" }));
    await service.remove(OWNER, toby.id);

    const owned = await service.findActiveOwnedIds(OWNER, [
      luna.id,
      toby.id,
      foreign.id,
      luna.id,
      9999,
    ]);

    expect([...owned]).toEqual([luna.id]);
  });

  it("guest / empty input -> empty set without querying", async () => {
    const { service } = await setup();
    await expect(service.findActiveOwnedIds(0, [1])).resolves.toEqual(
      new Set(),
    );
    await expect(service.findActiveOwnedIds(OWNER, [])).resolves.toEqual(
      new Set(),
    );
  });
});
