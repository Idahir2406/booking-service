import type { CreateRoomBoardOptionDto } from "@/contexts/rooms/dto/create-room-board-option.dto";
import type { CreateRoomExtraDto } from "@/contexts/rooms/dto/create-room-extra.dto";
import type {
  SiteWizardState,
  WizardUnit,
  WizardUnitsPayload,
} from "../types/site-wizard.types";
import type {
  ParseResult,
  UnitBoardOptionInput,
  UnitExtraInput,
  UnitInput,
} from "../utils/site-units.utils";

import {
  BadRequestException,
  Injectable,
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

import { RoomEntity } from "@/contexts/rooms/entities/room.entity";
import { RoomsService } from "@/contexts/rooms/services/rooms.service";
import { SiteUnitEntity } from "@/contexts/site-unit/entities/site-unit.entity";

import { SiteSettingsEntity } from "../entities/site-settings.entity";
import { roomMaxPetsFor } from "../utils/dog-policy.utils";
import {
  buildCopyNames,
  computeLegacyDerivedColumns,
  parseCreateUnitInput,
  parseUnitInput,
  summarizeUnits,
} from "../utils/site-units.utils";
import { SiteBookingSettingsWizardService } from "./site-booking-settings-wizard.service";
import { SiteWizardService } from "./site-wizard.service";

/** Step reached once "Unidades" (step 2) has been confirmed. */
const STEP_AFTER_UNITS = 3;
const SORT_ORDER_STEP = 10;

interface IdRow {
  id: number;
}

function unwrap<T>(result: ParseResult<T>): T {
  if (!result.ok) {
    throw new BadRequestException(result.errors);
  }
  return result.value;
}

function toBoardOptionDtos(
  options: readonly UnitBoardOptionInput[],
): CreateRoomBoardOptionDto[] {
  return options.map((option, index) => ({
    code: option.code,
    price: option.is_included ? 0 : option.price,
    is_included: option.is_included,
    is_default: option.is_default,
    is_active: option.is_active,
    sort_order: index,
  }));
}

function toExtraDtos(extras: readonly UnitExtraInput[]): CreateRoomExtraDto[] {
  return extras.map((extra, index) => ({
    name: extra.name,
    description: extra.description ?? undefined,
    pricing_mode: extra.pricing_mode,
    price: extra.price,
    is_active: extra.is_active,
    sort_order: index,
  }));
}

/**
 * Wizard step 2 ("Unidades"): bookable units = `rooms` rows of the site.
 * Every mutation runs in ONE transaction that also refreshes the legacy
 * derived columns of v4p_jsites1 (precio, capacity, rooms, baños).
 */
@Injectable()
export class SiteUnitsWizardService {
  constructor(
    private readonly legacyDb: LegacyDbService,
    private readonly roomsService: RoomsService,
    private readonly siteWizardService: SiteWizardService,
    private readonly bookingSettingsService: SiteBookingSettingsWizardService,
    @InjectRepository(SiteUnitEntity)
    private readonly siteUnitsRepository: Repository<SiteUnitEntity>,
    @InjectRepository(SiteSettingsEntity)
    private readonly siteSettingsRepository: Repository<SiteSettingsEntity>,
  ) {}

  async list(siteId: number): Promise<WizardUnitsPayload> {
    await this.assertSiteExists(siteId);
    return this.buildPayload(siteId);
  }

  async create(siteId: number, body: unknown): Promise<WizardUnitsPayload> {
    await this.assertSiteExists(siteId);
    const input = unwrap(parseCreateUnitInput(body));
    await this.assertSiteUnitAllowed(siteId, input.site_unit_id);
    // Step 3 max dogs is site-level: new units inherit it once answered
    const roomMaxPets = await this.siteRoomMaxPets(siteId);

    await this.legacyDb.transaction(async manager => {
      await this.lockSite(manager, siteId);
      const maxSortOrder = await manager
        .getRepository(RoomEntity)
        .maximum("sort_order", { site_id: siteId });
      const firstSortOrder = (maxSortOrder ?? 0) + SORT_ORDER_STEP;

      const names = buildCopyNames(input.name, input.copies);
      const createdIds: number[] = [];
      for (const [index, name] of names.entries()) {
        const room = await this.roomsService.create(
          {
            site_id: siteId,
            ...this.toRoomFields(input),
            name,
            ...(roomMaxPets === null ? {} : { max_pets: roomMaxPets }),
            is_active: true,
            sort_order: firstSortOrder + index * SORT_ORDER_STEP,
            board_options: toBoardOptionDtos(input.board_options),
            extras: toExtraDtos(input.extras),
          },
          manager,
        );
        createdIds.push(room.id);
      }
      // Step 6 already configured: new units get the same availability
      await this.bookingSettingsService.applyStoredRuleToRooms(
        manager,
        siteId,
        createdIds,
      );
      await this.syncLegacyDerivedColumns(manager, siteId);
    });

    return this.buildPayload(siteId);
  }

  async update(
    siteId: number,
    roomId: number,
    body: unknown,
  ): Promise<WizardUnitsPayload> {
    await this.assertSiteExists(siteId);
    await this.roomsService.findOneForSite(roomId, siteId);
    const input = unwrap(parseUnitInput(body));
    await this.assertSiteUnitAllowed(siteId, input.site_unit_id);

    await this.legacyDb.transaction(async manager => {
      await this.lockSite(manager, siteId);
      await this.roomsService.update(
        roomId,
        {
          ...this.toRoomFields(input),
          board_options: toBoardOptionDtos(input.board_options),
          extras: toExtraDtos(input.extras),
        },
        manager,
      );
      await this.syncLegacyDerivedColumns(manager, siteId);
    });

    return this.buildPayload(siteId);
  }

  /** Deletes the unit, or deactivates it when it has future reservations. */
  async remove(siteId: number, roomId: number): Promise<WizardUnitsPayload> {
    await this.assertSiteExists(siteId);
    await this.roomsService.findOneForSite(roomId, siteId);

    await this.legacyDb.transaction(async manager => {
      await this.lockSite(manager, siteId);
      await this.roomsService.remove(roomId, manager);
      await this.syncLegacyDerivedColumns(manager, siteId);
    });

    return this.buildPayload(siteId);
  }

  async confirm(siteId: number): Promise<SiteWizardState> {
    await this.assertSiteExists(siteId);
    const activeUnits = await this.siteUnitsCount(siteId);
    if (activeUnits === 0) {
      throw new BadRequestException(["units: Añade al menos una unidad"]);
    }

    const table = this.siteSettingsRepository.metadata.tableName;
    await this.siteSettingsRepository.query(
      `INSERT INTO \`${table}\` (site_id, wizard_step)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         wizard_step = GREATEST(wizard_step, VALUES(wizard_step))`,
      [siteId, STEP_AFTER_UNITS],
    );

    return this.siteWizardService.getState(siteId);
  }

  private toRoomFields(input: UnitInput) {
    return {
      site_unit_id: input.site_unit_id,
      name: input.name,
      description: input.description,
      price_per_night: input.price_per_night,
      max_guests: input.max_guests,
      bathrooms: input.bathrooms,
    };
  }

  private async siteRoomMaxPets(siteId: number): Promise<number | null> {
    const settings = await this.siteSettingsRepository.findOne({
      where: { site_id: siteId },
      select: { site_id: true, max_pets: true, max_pets_unlimited: true },
    });
    return roomMaxPetsFor(settings);
  }

  private siteUnitsCount(siteId: number): Promise<number> {
    return this.siteSettingsRepository.manager.count(RoomEntity, {
      where: { site_id: siteId, is_active: true },
    });
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

  /** Serializes concurrent mutations of the same site (derived columns). */
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

  /** The unit type must be active and belong to the step-1 main tipsite. */
  private async assertSiteUnitAllowed(
    siteId: number,
    siteUnitId: number,
  ): Promise<void> {
    const settings = await this.siteSettingsRepository.findOne({
      where: { site_id: siteId },
    });
    const mainTipsiteId = settings?.main_tipsite_id ?? null;
    if (mainTipsiteId === null) {
      throw new BadRequestException([
        "site_unit_id: Completa primero el paso 1",
      ]);
    }

    const siteUnit = await this.siteUnitsRepository.findOne({
      where: { id: siteUnitId },
    });
    if (!siteUnit?.is_active) {
      throw new BadRequestException([
        "site_unit_id: tipo de unidad desconocido o inactivo",
      ]);
    }
    if (siteUnit.tipsite_id !== mainTipsiteId) {
      throw new BadRequestException([
        "site_unit_id: no corresponde al tipo de alojamiento del paso 1",
      ]);
    }
  }

  /** Only these 4 legacy columns are written (text columns, PHP-owned). */
  private async syncLegacyDerivedColumns(
    manager: EntityManager,
    siteId: number,
  ): Promise<void> {
    const rooms = await manager.getRepository(RoomEntity).find({
      where: { site_id: siteId },
      select: {
        id: true,
        price_per_night: true,
        max_guests: true,
        bathrooms: true,
        is_active: true,
      },
    });
    const derived = computeLegacyDerivedColumns(rooms);

    await this.legacyDb.query(
      `UPDATE ${legacyTableSql(LEGACY_TABLE.SITES1)}
       SET \`precio\` = ?, \`capacity\` = ?, \`rooms\` = ?, \`baños\` = ?
       WHERE id = ? AND customer = ?`,
      [
        derived.precio,
        derived.capacity,
        derived.rooms,
        derived.banos,
        siteId,
        LEGACY_CUSTOMER,
      ],
      manager,
    );
  }

  private async buildPayload(siteId: number): Promise<WizardUnitsPayload> {
    const rooms = await this.roomsService.findBySite(siteId);
    const siteUnitIds = [
      ...new Set(
        rooms
          .map(room => room.site_unit_id)
          .filter((id): id is number => id !== null),
      ),
    ];
    const siteUnits =
      siteUnitIds.length === 0
        ? []
        : await this.siteUnitsRepository.findBy({ id: In(siteUnitIds) });
    const siteUnitById = new Map(siteUnits.map(unit => [unit.id, unit]));

    const units = rooms.map(room =>
      this.toWizardUnit(
        room,
        room.site_unit_id === null
          ? undefined
          : siteUnitById.get(room.site_unit_id),
      ),
    );

    return { units, summary: summarizeUnits(units) };
  }

  private toWizardUnit(
    room: RoomEntity,
    siteUnit: SiteUnitEntity | undefined,
  ): WizardUnit {
    return {
      id: room.id,
      site_unit_id: room.site_unit_id,
      site_unit_name: siteUnit?.name ?? null,
      is_full_use: siteUnit?.is_full_use ?? false,
      name: room.name,
      description: room.description ?? null,
      price_per_night: Number(room.price_per_night),
      max_guests: Number(room.max_guests),
      bathrooms: Number(room.bathrooms),
      is_active: room.is_active,
      sort_order: room.sort_order,
      board_options: room.board_options.map(option => ({
        code: option.code,
        price: Number(option.price),
        is_included: option.is_included,
        is_default: option.is_default,
        is_active: option.is_active,
      })),
      extras: room.extras.map(extra => ({
        id: extra.id,
        name: extra.name,
        description: extra.description ?? null,
        pricing_mode: extra.pricing_mode,
        price: Number(extra.price),
        is_active: extra.is_active,
      })),
    };
  }
}
