import type {
  SiteWizardState,
  WizardBookingSettingsPayload,
} from "../types/site-wizard.types";
import type {
  BookingSettingsInput,
  StoredAvailabilityRule,
} from "../utils/site-booking.utils";

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";

import { LegacyDbService } from "@/shared/legacy-db/legacy-db.service";
import {
  LEGACY_CUSTOMER,
  LEGACY_TABLE,
  legacyTableSql,
} from "@/shared/legacy-db/legacy-tables";

import { AvailabilityEntity } from "@/contexts/availability/entities/availability.entity";
import { RoomEntity } from "@/contexts/rooms/entities/room.entity";

import { SiteSettingsEntity } from "../entities/site-settings.entity";
import {
  BOOKING_LIMITS,
  buildAvailabilityDates,
  isAvailabilityConfigured,
  parseBookingSettingsInput,
  toIsoDate,
} from "../utils/site-booking.utils";
import { SiteWizardService } from "./site-wizard.service";

/** Step reached once "Reservas" (step 6) has been confirmed. */
const STEP_AFTER_BOOKING = 7;

interface IdRow {
  id: number;
}

/**
 * Wizard step 6 ("Reservas"): availability rule of the site. "all_year"
 * makes every ACTIVE unit bookable for a rolling window of 365 nights
 * starting today, with the chosen min/max nights.
 *
 * Non-destructive by design:
 * - missing nights are inserted (is_available = 1);
 * - existing nights keep is_available (0 may be a reservation hold or a
 *   night the host closed) and only get the new min/max when they still
 *   carry the PREVIOUS wizard values (= rows the wizard wrote); rows the host
 *   configured with other values in the PHP calendar are left alone;
 * - blocks (own table, checked separately by quote/checkout) are untouched.
 * Re-running it is idempotent and also extends the rolling window.
 */
@Injectable()
export class SiteBookingSettingsWizardService {
  constructor(
    private readonly legacyDb: LegacyDbService,
    private readonly siteWizardService: SiteWizardService,
    @InjectRepository(SiteSettingsEntity)
    private readonly siteSettingsRepository: Repository<SiteSettingsEntity>,
    @InjectRepository(RoomEntity)
    private readonly roomsRepository: Repository<RoomEntity>,
  ) {}

  async get(siteId: number): Promise<WizardBookingSettingsPayload> {
    await this.assertSiteExists(siteId);
    const [settings, roomsCount] = await Promise.all([
      this.siteSettingsRepository.findOne({ where: { site_id: siteId } }),
      this.roomsRepository.count({
        where: { site_id: siteId, is_active: true },
      }),
    ]);
    const configured = isAvailabilityConfigured(settings);
    return {
      availability: {
        configured,
        mode: configured ? settings.availability_mode : null,
        min_nights: configured ? settings.min_nights : null,
        max_nights: configured ? settings.max_nights : null,
      },
      rooms_count: roomsCount,
    };
  }

  async update(
    siteId: number,
    body: unknown,
  ): Promise<WizardBookingSettingsPayload> {
    await this.assertSiteExists(siteId);
    const parsed = parseBookingSettingsInput(body);
    if (!parsed.ok) {
      throw new BadRequestException(parsed.errors);
    }
    const input = parsed.value;

    await this.legacyDb.transaction(async manager => {
      await this.lockSite(manager, siteId);
      const previous = await manager
        .getRepository(SiteSettingsEntity)
        .findOne({ where: { site_id: siteId } });

      const table = this.siteSettingsRepository.metadata.tableName;
      await manager.query(
        `INSERT INTO \`${table}\` (site_id, availability_mode, min_nights, max_nights)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           availability_mode = VALUES(availability_mode),
           min_nights = VALUES(min_nights),
           max_nights = VALUES(max_nights)`,
        [siteId, input.mode, input.min_nights, input.max_nights],
      );

      const rooms = await manager.getRepository(RoomEntity).find({
        where: { site_id: siteId, is_active: true },
        select: { id: true },
      });
      await this.applyToRooms(
        manager,
        siteId,
        rooms.map(room => room.id),
        input,
        previous,
      );
    });

    return this.get(siteId);
  }

  async confirm(siteId: number): Promise<SiteWizardState> {
    const payload = await this.get(siteId);
    if (!payload.availability.configured) {
      throw new BadRequestException([
        "availability: Configura la disponibilidad",
      ]);
    }
    const table = this.siteSettingsRepository.metadata.tableName;
    await this.siteSettingsRepository.manager.query(
      `INSERT INTO \`${table}\` (site_id, wizard_step)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         wizard_step = GREATEST(wizard_step, VALUES(wizard_step))`,
      [siteId, STEP_AFTER_BOOKING],
    );
    return this.siteWizardService.getState(siteId);
  }

  /**
   * Units created after step 6 (step 2 hook): same availability as the
   * rest of the site when the rule is configured. Runs in the caller's
   * transaction.
   */
  async applyStoredRuleToRooms(
    manager: EntityManager,
    siteId: number,
    roomIds: readonly number[],
  ): Promise<void> {
    const settings = await manager
      .getRepository(SiteSettingsEntity)
      .findOne({ where: { site_id: siteId } });
    if (!isAvailabilityConfigured(settings)) {
      return;
    }
    await this.applyToRooms(
      manager,
      siteId,
      roomIds,
      {
        mode: settings.availability_mode,
        min_nights: settings.min_nights,
        max_nights: settings.max_nights,
      },
      settings,
    );
  }

  private async applyToRooms(
    manager: EntityManager,
    siteId: number,
    roomIds: readonly number[],
    rule: BookingSettingsInput,
    previous: StoredAvailabilityRule | null,
  ): Promise<void> {
    if (roomIds.length === 0) {
      return;
    }
    const dates = buildAvailabilityDates(
      toIsoDate(new Date()),
      BOOKING_LIMITS.WINDOW_DAYS,
    );
    const from = dates.at(0);
    const to = dates.at(-1);
    if (from === undefined || to === undefined) {
      return;
    }
    const table = manager.getRepository(AvailabilityEntity).metadata.tableName;

    // 1) Nights the wizard wrote before follow the new limits
    if (
      isAvailabilityConfigured(previous) &&
      (previous.min_nights !== rule.min_nights ||
        previous.max_nights !== rule.max_nights)
    ) {
      await manager.query(
        `UPDATE \`${table}\`
         SET min_nights = ?, max_nights = ?
         WHERE site_id = ? AND room_id IN (?)
           AND date BETWEEN ? AND ?
           AND min_nights = ? AND max_nights = ?`,
        [
          rule.min_nights,
          rule.max_nights,
          siteId,
          roomIds,
          from,
          to,
          previous.min_nights,
          previous.max_nights,
        ],
      );
    }

    // 2) Missing nights are created bookable; existing rows are kept as-is
    for (const roomId of roomIds) {
      await manager.query(
        `INSERT INTO \`${table}\`
           (date, site_id, room_id, is_available, min_nights, max_nights)
         VALUES ${dates.map(() => "(?, ?, ?, 1, ?, ?)").join(", ")}
         ON DUPLICATE KEY UPDATE id = id`,
        dates.flatMap(date => [
          date,
          siteId,
          roomId,
          rule.min_nights,
          rule.max_nights,
        ]),
      );
    }
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
