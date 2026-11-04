import type {
  CreateTravelerDogDto,
  TravelerDogDto,
  TravelerDogListDto,
  UpdateTravelerDogDto,
} from "../dto/traveler-dog.dto";

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, IsNull, Repository } from "typeorm";

import { DogSizeEntity } from "../../dog-sizes/entities/dog-size.entity";
import {
  deriveDogSize,
  type DogSizeRange,
  normalizeDogSizes,
  normalizeWeightKg,
} from "../../pet-policies/domain/dog-compatibility";
import { DOG_SPECIES_NAME } from "../../reservations/services/reservation-quote-context.service";
import { SpeciesEntity } from "../../species/entities/species.entity";
import { MAX_TRAVELER_DOGS } from "../domain/traveler-dog.constants";
import { TravelerDogEntity } from "../entities/traveler-dog.entity";

const NOT_FOUND_MESSAGE = "Dog not found";

/**
 * F-PV5 "Mis perros": CRUD of the traveler's dog library. Ownership is
 * enforced on every query (user_id from the PHP session proxy); a dog of
 * another traveler answers 404 so existence is not leaked.
 * Never touches reservations or reservation_snapshots: bookings keep their
 * own frozen SnapshotDog copy.
 */
@Injectable()
export class TravelerDogsService {
  private readonly logger = new Logger(TravelerDogsService.name);

  constructor(
    @InjectRepository(TravelerDogEntity)
    private readonly dogsRepository: Repository<TravelerDogEntity>,
    @InjectRepository(SpeciesEntity)
    private readonly speciesRepository: Repository<SpeciesEntity>,
    @InjectRepository(DogSizeEntity)
    private readonly dogSizesRepository: Repository<DogSizeEntity>,
  ) {}

  async list(userId: number): Promise<TravelerDogListDto> {
    this.assertUser(userId);
    const [dogs, sizes] = await Promise.all([
      this.dogsRepository.find({
        where: { user_id: userId, deleted_at: IsNull() },
        order: { id: "ASC" },
      }),
      this.loadSizes(),
    ]);
    return {
      items: dogs.map(dog => this.toDto(dog, sizes)),
      max: MAX_TRAVELER_DOGS,
    };
  }

  async create(
    userId: number,
    dto: CreateTravelerDogDto,
  ): Promise<TravelerDogDto> {
    this.assertUser(userId);
    const count = await this.dogsRepository.count({
      where: { user_id: userId, deleted_at: IsNull() },
    });
    if (count >= MAX_TRAVELER_DOGS) {
      throw new ConflictException(
        `A traveler can save at most ${MAX_TRAVELER_DOGS} dogs`,
      );
    }
    const entity = this.dogsRepository.create({
      user_id: userId,
      name: dto.name.trim(),
      weight_kg: normalizeWeightKg(dto.weight_kg),
      is_ppp: dto.is_ppp,
      photo_path: dto.photo_path ?? null,
      deleted_at: null,
    });
    const saved = await this.dogsRepository.save(entity);
    return this.toDto(saved, await this.loadSizes());
  }

  async update(
    userId: number,
    dogId: number,
    dto: UpdateTravelerDogDto,
  ): Promise<TravelerDogDto> {
    const current = await this.findOwned(userId, dogId);
    const patch: Partial<TravelerDogEntity> = { id: current.id };
    if (dto.name !== undefined) {
      patch.name = dto.name.trim();
    }
    if (dto.weight_kg !== undefined) {
      patch.weight_kg = normalizeWeightKg(dto.weight_kg);
    }
    if (dto.is_ppp !== undefined) {
      patch.is_ppp = dto.is_ppp;
    }
    if (dto.photo_path !== undefined) {
      patch.photo_path = dto.photo_path;
    }
    const merged = await this.dogsRepository.preload(patch);
    if (!merged) {
      throw new NotFoundException(NOT_FOUND_MESSAGE);
    }
    const saved = await this.dogsRepository.save(merged);
    return this.toDto(saved, await this.loadSizes());
  }

  /**
   * Soft delete. Returns the dog as it was so the proxy can remove the
   * private photo file it points to.
   */
  async remove(userId: number, dogId: number): Promise<TravelerDogDto> {
    const current = await this.findOwned(userId, dogId);
    await this.dogsRepository.update(
      { id: current.id, user_id: userId },
      { deleted_at: new Date() },
    );
    return this.toDto(current, await this.loadSizes());
  }

  /**
   * Subset of `dogIds` that are active (not soft-deleted) dogs of `userId`.
   * Used by the checkout to link reservation dogs to saved dogs; never
   * throws for foreign/unknown ids (they are simply not returned).
   */
  async findActiveOwnedIds(
    userId: number,
    dogIds: readonly number[],
  ): Promise<Set<number>> {
    const ids = [...new Set(dogIds)].filter(
      id => Number.isInteger(id) && id > 0,
    );
    if (!Number.isInteger(userId) || userId < 1 || ids.length === 0) {
      return new Set();
    }
    const rows = await this.dogsRepository.find({
      select: { id: true },
      where: { id: In(ids), user_id: userId, deleted_at: IsNull() },
    });
    return new Set(rows.map(row => row.id));
  }

  private assertUser(userId: number): void {
    if (!Number.isInteger(userId) || userId < 1) {
      throw new BadRequestException("user_id must be a positive integer");
    }
  }

  private async findOwned(
    userId: number,
    dogId: number,
  ): Promise<TravelerDogEntity> {
    this.assertUser(userId);
    const dog = await this.dogsRepository.findOne({
      where: { id: dogId, user_id: userId, deleted_at: IsNull() },
    });
    if (!dog) {
      throw new NotFoundException(NOT_FOUND_MESSAGE);
    }
    return dog;
  }

  /** Same dog_sizes rows (species "Perro") the F2 quote uses. */
  private async loadSizes(): Promise<DogSizeRange[]> {
    const species = await this.speciesRepository.findOne({
      where: { name: DOG_SPECIES_NAME },
    });
    if (!species) {
      this.logger.warn(
        `species "${DOG_SPECIES_NAME}" not found: saved dogs without size`,
      );
      return [];
    }
    const sizes = await this.dogSizesRepository.find({
      where: { species_id: species.id },
      order: { rank: "ASC" },
    });
    return normalizeDogSizes(sizes);
  }

  private toDto(
    dog: TravelerDogEntity,
    sizes: readonly DogSizeRange[],
  ): TravelerDogDto {
    const weight = Number(dog.weight_kg);
    return {
      id: dog.id,
      name: dog.name,
      weight_kg: weight,
      is_ppp: Boolean(dog.is_ppp),
      photo_path: dog.photo_path ?? null,
      size: deriveDogSize(weight, sizes),
      created_at: new Date(dog.created_at).toISOString(),
      updated_at: new Date(dog.updated_at).toISOString(),
    };
  }
}
