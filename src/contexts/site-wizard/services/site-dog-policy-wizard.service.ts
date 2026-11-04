import type {
  SiteWizardState,
  WizardDogPolicy,
  WizardDogPolicyPayload,
  WizardDogPolicyUnit,
} from "../types/site-wizard.types";
import type { DogZoneInfo } from "../utils/dog-policy.utils";
import type { ParseResult } from "../utils/site-units.utils";

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, In, Repository } from "typeorm";

import { LegacyDbService } from "@/shared/legacy-db/legacy-db.service";
import {
  LEGACY_CUSTOMER,
  LEGACY_TABLE,
  legacyTableSql,
} from "@/shared/legacy-db/legacy-tables";

import { CommonZoneEntity } from "@/contexts/common-zones/entities/common-zone.entity";
import { DogSizeEntity } from "@/contexts/dog-sizes/entities/dog-size.entity";
import { UnitPetPolicyEntity } from "@/contexts/pet-policies/entities/unit-pet-policy.entity";
import { UnitPetPolicyZoneEntity } from "@/contexts/pet-policies/entities/unit-pet-policy-zone.entity";
import { RoomEntity } from "@/contexts/rooms/entities/room.entity";
import { SiteUnitEntity } from "@/contexts/site-unit/entities/site-unit.entity";
import { SpeciesEntity } from "@/contexts/species/entities/species.entity";

import { SiteSettingsEntity } from "../entities/site-settings.entity";
import {
  computeDogPolicyMissing,
  copyDogPolicy,
  deriveDogTipspec,
  emptyDogPolicy,
  isMaxPetsAnswered,
  MISSING_REASON,
  parseDogPolicyInput,
  parseMaxPetsInput,
  roomMaxPetsFor,
} from "../utils/dog-policy.utils";
import { toNumber } from "../utils/site-units.utils";
import { SiteWizardService } from "./site-wizard.service";

/** Step reached once "Perros" (step 3) has been confirmed. */
const STEP_AFTER_DOGS = 4;
/** Step 3 only configures dogs (species catalog row "Perro"). */
const DOG_SPECIES_NAME = "Perro";

interface IdRow {
  id: number;
}

interface TipspecRow {
  tipspec: string | null;
}

interface DogCatalog {
  speciesId: number;
  sizes: DogSizeEntity[];
  zones: CommonZoneEntity[];
  zonesById: Map<number, DogZoneInfo>;
}

function unwrap<T>(result: ParseResult<T>): T {
  if (!result.ok) {
    throw new BadRequestException(result.errors);
  }
  return result.value;
}

function toNullableNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * Wizard step 3 ("Perros"): site-level max dogs (site_settings, synced to
 * rooms.max_pets) + one dog policy per unit (unit_pet_policies + zones).
 * Unit policies are drafts; confirm() enforces completeness and derives the
 * legacy dog tipspec ids of v4p_jsites1.
 */
@Injectable()
export class SiteDogPolicyWizardService {
  constructor(
    private readonly legacyDb: LegacyDbService,
    private readonly siteWizardService: SiteWizardService,
    @InjectRepository(SiteSettingsEntity)
    private readonly siteSettingsRepository: Repository<SiteSettingsEntity>,
    @InjectRepository(RoomEntity)
    private readonly roomsRepository: Repository<RoomEntity>,
    @InjectRepository(SiteUnitEntity)
    private readonly siteUnitsRepository: Repository<SiteUnitEntity>,
    @InjectRepository(UnitPetPolicyEntity)
    private readonly policiesRepository: Repository<UnitPetPolicyEntity>,
    @InjectRepository(DogSizeEntity)
    private readonly dogSizesRepository: Repository<DogSizeEntity>,
    @InjectRepository(CommonZoneEntity)
    private readonly commonZonesRepository: Repository<CommonZoneEntity>,
    @InjectRepository(SpeciesEntity)
    private readonly speciesRepository: Repository<SpeciesEntity>,
  ) {}

  async get(siteId: number): Promise<WizardDogPolicyPayload> {
    await this.assertSiteExists(siteId);
    return this.buildPayload(siteId, await this.loadCatalog());
  }

  async updateMaxPets(
    siteId: number,
    body: unknown,
  ): Promise<WizardDogPolicyPayload> {
    await this.assertSiteExists(siteId);
    const input = unwrap(parseMaxPetsInput(body));
    const roomMaxPets = roomMaxPetsFor({
      max_pets: input.max_pets,
      max_pets_unlimited: input.unlimited,
    });

    await this.legacyDb.transaction(async manager => {
      await this.lockSite(manager, siteId);
      const table = this.siteSettingsRepository.metadata.tableName;
      await manager.query(
        `INSERT INTO \`${table}\` (site_id, max_pets, max_pets_unlimited)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           max_pets = VALUES(max_pets),
           max_pets_unlimited = VALUES(max_pets_unlimited)`,
        [siteId, input.max_pets, input.unlimited ? 1 : 0],
      );
      // Every unit of the site (inactive included) follows the site setting
      await manager.update(
        RoomEntity,
        { site_id: siteId },
        { max_pets: roomMaxPets ?? 0 },
      );
    });

    return this.buildPayload(siteId, await this.loadCatalog());
  }

  async updateUnitPolicy(
    siteId: number,
    roomId: number,
    body: unknown,
  ): Promise<WizardDogPolicyPayload> {
    await this.assertSiteExists(siteId);
    const room = await this.findRoom(siteId, roomId);
    const catalog = await this.loadCatalog();
    const isFullUse = await this.isFullUse(room);

    const policy = unwrap(
      parseDogPolicyInput(body, {
        sizeIds: new Set(catalog.sizes.map(size => size.id)),
        zonesById: catalog.zonesById,
        isFullUse,
      }),
    );

    await this.legacyDb.transaction(async manager => {
      await this.lockSite(manager, siteId);
      await this.savePolicy(manager, room.id, catalog.speciesId, policy);
    });

    return this.buildPayload(siteId, catalog);
  }

  async copyUnitPolicy(
    siteId: number,
    roomId: number,
    body: unknown,
  ): Promise<WizardDogPolicyPayload> {
    await this.assertSiteExists(siteId);
    const target = await this.findRoom(siteId, roomId);
    const fromRoomId = this.parseFromRoomId(body, roomId);
    const source = await this.roomsRepository.findOne({
      where: { id: fromRoomId, site_id: siteId },
    });
    if (!source) {
      throw new BadRequestException([
        "from_room_id: la unidad no existe en este alojamiento",
      ]);
    }

    const catalog = await this.loadCatalog();
    const sourcePolicy = await this.policiesRepository.findOne({
      where: { room_id: source.id, species_id: catalog.speciesId },
      relations: { zones: true },
    });
    if (!sourcePolicy) {
      throw new BadRequestException([
        "from_room_id: la unidad origen no tiene política de perros",
      ]);
    }

    const policy = copyDogPolicy(
      this.toWizardPolicy(sourcePolicy, catalog),
      await this.isFullUse(target),
    );
    await this.legacyDb.transaction(async manager => {
      await this.lockSite(manager, siteId);
      await this.savePolicy(manager, target.id, catalog.speciesId, policy);
    });

    return this.buildPayload(siteId, catalog);
  }

  async confirm(siteId: number): Promise<SiteWizardState> {
    await this.assertSiteExists(siteId);
    const catalog = await this.loadCatalog();
    const payload = await this.buildPayload(siteId, catalog);

    const errors: string[] = [];
    if (!payload.max_pets_answered) {
      errors.push(`max_pets: ${MISSING_REASON}`);
    }
    const activeUnits = payload.units.filter(unit => unit.is_active);
    if (activeUnits.length === 0) {
      errors.push("units: Añade al menos una unidad en el paso 2");
    }
    for (const unit of activeUnits) {
      for (const field of unit.missing) {
        errors.push(`units.${unit.room_id}.${field}: ${MISSING_REASON}`);
      }
    }
    if (errors.length > 0) {
      throw new BadRequestException(errors);
    }

    const topSize = catalog.sizes.at(-1) ?? null;
    const zoneSlugById = new Map(
      catalog.zones.map(zone => [zone.id, zone.slug]),
    );

    await this.legacyDb.transaction(async manager => {
      const row = await this.legacyDb.queryOne<TipspecRow>(
        `SELECT tipspec FROM ${legacyTableSql(LEGACY_TABLE.SITES1)}
         WHERE id = ? AND customer = ? FOR UPDATE`,
        [siteId, LEGACY_CUSTOMER],
        manager,
      );
      if (!row) {
        throw new NotFoundException(`site ${siteId} not found`);
      }
      const tipspec = deriveDogTipspec(
        row.tipspec,
        activeUnits.map(unit => unit.policy),
        { maxRankSizeId: topSize?.id ?? null, zoneSlugById },
      );
      await this.legacyDb.query(
        `UPDATE ${legacyTableSql(LEGACY_TABLE.SITES1)}
         SET \`tipspec\` = ?
         WHERE id = ? AND customer = ?`,
        [tipspec, siteId, LEGACY_CUSTOMER],
        manager,
      );

      const table = this.siteSettingsRepository.metadata.tableName;
      await manager.query(
        `INSERT INTO \`${table}\` (site_id, wizard_step)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE
           wizard_step = GREATEST(wizard_step, VALUES(wizard_step))`,
        [siteId, STEP_AFTER_DOGS],
      );
    });

    return this.siteWizardService.getState(siteId);
  }

  private parseFromRoomId(body: unknown, roomId: number): number {
    const raw =
      typeof body === "object" && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>).from_room_id
        : undefined;
    const fromRoomId = toNumber(raw);
    if (!Number.isInteger(fromRoomId) || fromRoomId < 1) {
      throw new BadRequestException(["from_room_id: debe ser un id válido"]);
    }
    if (fromRoomId === roomId) {
      throw new BadRequestException([
        "from_room_id: debe ser una unidad distinta",
      ]);
    }
    return fromRoomId;
  }

  private async savePolicy(
    manager: EntityManager,
    roomId: number,
    speciesId: number,
    policy: WizardDogPolicy,
  ): Promise<void> {
    const repository = manager.getRepository(UnitPetPolicyEntity);
    const existing = await repository.findOne({
      where: { room_id: roomId, species_id: speciesId },
    });
    const entity = repository.merge(
      existing ?? repository.create({ room_id: roomId, species_id: speciesId }),
      {
        max_size_id: policy.max_size_id,
        ppp_allowed: policy.ppp_allowed,
        supplement_mode: policy.supplement_mode,
        supplement_amount: policy.supplement_amount,
        left_alone: policy.left_alone,
        left_alone_conditions: policy.left_alone_conditions,
        full_unit_access: policy.full_unit_access,
        deposit_required: policy.deposit_required,
        deposit_amount: policy.deposit_amount,
        deposit_return: policy.deposit_return,
        deposit_return_days: policy.deposit_return_days,
        notes: policy.notes,
        common_zones_answered: policy.common_zones_answered,
        dining_zones_answered: policy.dining_zones_answered,
      },
    );
    const saved = await repository.save(entity);

    await manager.delete(UnitPetPolicyZoneEntity, { policy_id: saved.id });
    if (policy.zones.length > 0) {
      const dining = new Set(policy.dining_zone_ids);
      await manager.insert(
        UnitPetPolicyZoneEntity,
        policy.zones.map(zone => ({
          policy_id: saved.id,
          zone_id: zone.zone_id,
          other_text: zone.other_text,
          allows_dining: dining.has(zone.zone_id),
        })),
      );
    }
  }

  private async buildPayload(
    siteId: number,
    catalog: DogCatalog,
  ): Promise<WizardDogPolicyPayload> {
    const [settings, rooms] = await Promise.all([
      this.siteSettingsRepository.findOne({ where: { site_id: siteId } }),
      this.roomsRepository.find({
        where: { site_id: siteId },
        order: { sort_order: "ASC", id: "ASC" },
      }),
    ]);

    const roomIds = rooms.map(room => room.id);
    const siteUnitIds = [
      ...new Set(
        rooms
          .map(room => room.site_unit_id)
          .filter((id): id is number => id !== null),
      ),
    ];
    const [policies, siteUnits] = await Promise.all([
      roomIds.length === 0
        ? []
        : this.policiesRepository.find({
            where: { room_id: In(roomIds), species_id: catalog.speciesId },
            relations: { zones: true },
          }),
      siteUnitIds.length === 0
        ? []
        : this.siteUnitsRepository.findBy({ id: In(siteUnitIds) }),
    ]);
    const policyByRoom = new Map(policies.map(row => [row.room_id, row]));
    const siteUnitById = new Map(siteUnits.map(unit => [unit.id, unit]));

    const units = rooms.map((room): WizardDogPolicyUnit => {
      const siteUnit =
        room.site_unit_id === null
          ? undefined
          : siteUnitById.get(room.site_unit_id);
      const isFullUse = siteUnit?.is_full_use ?? false;
      const row = policyByRoom.get(room.id);
      const policy = row ? this.toWizardPolicy(row, catalog) : emptyDogPolicy();
      return {
        room_id: room.id,
        name: room.name,
        site_unit_name: siteUnit?.name ?? null,
        is_full_use: isFullUse,
        is_active: room.is_active,
        policy,
        missing: computeDogPolicyMissing(policy, {
          zonesById: catalog.zonesById,
          isFullUse,
        }),
      };
    });

    const maxPetsSettings = settings
      ? {
          max_pets: settings.max_pets,
          max_pets_unlimited: settings.max_pets_unlimited,
        }
      : null;
    return {
      max_pets: settings?.max_pets ?? null,
      max_pets_unlimited: settings?.max_pets_unlimited ?? false,
      max_pets_answered: isMaxPetsAnswered(maxPetsSettings),
      units,
    };
  }

  private toWizardPolicy(
    row: UnitPetPolicyEntity,
    catalog: DogCatalog,
  ): WizardDogPolicy {
    const zoneOrder = new Map(
      catalog.zones.map((zone, index) => [zone.id, index]),
    );
    const zoneRows = [...row.zones].sort(
      (a, b) =>
        (zoneOrder.get(a.zone_id) ?? Number.MAX_SAFE_INTEGER) -
          (zoneOrder.get(b.zone_id) ?? Number.MAX_SAFE_INTEGER) ||
        a.zone_id - b.zone_id,
    );

    return {
      max_size_id: row.max_size_id,
      ppp_allowed: row.ppp_allowed,
      supplement_mode: row.supplement_mode,
      supplement_amount: toNullableNumber(row.supplement_amount),
      left_alone: row.left_alone,
      left_alone_conditions: row.left_alone_conditions,
      full_unit_access: row.full_unit_access,
      deposit_required: row.deposit_required,
      deposit_amount: toNullableNumber(row.deposit_amount),
      deposit_return: row.deposit_return,
      deposit_return_days: row.deposit_return_days,
      notes: row.notes,
      common_zones_answered: row.common_zones_answered,
      zones: zoneRows.map(zone => ({
        zone_id: zone.zone_id,
        other_text: zone.other_text,
      })),
      dining_zones_answered: row.dining_zones_answered,
      dining_zone_ids: zoneRows
        .filter(zone => zone.allows_dining)
        .map(zone => zone.zone_id),
    };
  }

  private async loadCatalog(): Promise<DogCatalog> {
    const species = await this.speciesRepository.findOne({
      where: { name: DOG_SPECIES_NAME },
    });
    if (!species) {
      throw new InternalServerErrorException(
        `species "${DOG_SPECIES_NAME}" not found`,
      );
    }
    const [sizes, zones] = await Promise.all([
      this.dogSizesRepository.find({
        where: { species_id: species.id },
        order: { rank: "ASC" },
      }),
      this.commonZonesRepository.find({
        order: { sort_order: "ASC", id: "ASC" },
      }),
    ]);
    const zonesById = new Map(
      zones.map(zone => [
        zone.id,
        {
          id: zone.id,
          slug: zone.slug,
          is_dining_capable: zone.is_dining_capable,
          requires_text: zone.requires_text,
          is_active: zone.is_active,
        },
      ]),
    );
    return { speciesId: species.id, sizes, zones, zonesById };
  }

  private async findRoom(siteId: number, roomId: number): Promise<RoomEntity> {
    const room = await this.roomsRepository.findOne({
      where: { id: roomId, site_id: siteId },
    });
    if (!room) {
      throw new NotFoundException(`room ${roomId} not found in site ${siteId}`);
    }
    return room;
  }

  private async isFullUse(room: RoomEntity): Promise<boolean> {
    if (room.site_unit_id === null) {
      return false;
    }
    const siteUnit = await this.siteUnitsRepository.findOne({
      where: { id: room.site_unit_id },
    });
    return siteUnit?.is_full_use ?? false;
  }

  private async assertSiteExists(siteId: number): Promise<void> {
    const row = await this.legacyDb.queryOne<IdRow>(
      `SELECT id FROM ${legacyTableSql(LEGACY_TABLE.SITES1)}
       WHERE id = ? AND customer = ?`,
      [siteId, LEGACY_CUSTOMER],
    );
    if (!row) {
      throw new NotFoundException(`site ${siteId} not found`);
    }
  }

  /** Serializes concurrent mutations of the same site. */
  private async lockSite(
    manager: EntityManager,
    siteId: number,
  ): Promise<void> {
    const row = await this.legacyDb.queryOne<IdRow>(
      `SELECT id FROM ${legacyTableSql(LEGACY_TABLE.SITES1)}
       WHERE id = ? AND customer = ? FOR UPDATE`,
      [siteId, LEGACY_CUSTOMER],
      manager,
    );
    if (!row) {
      throw new NotFoundException(`site ${siteId} not found`);
    }
  }
}
