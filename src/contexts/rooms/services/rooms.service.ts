import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, In, Repository } from "typeorm";

import { omit_undefined } from "@/shared/utils/omit-undefined";

import { CreateRoomDto } from "../dto/create-room.dto";
import { CreateRoomBoardOptionDto } from "../dto/create-room-board-option.dto";
import { CreateRoomExtraDto } from "../dto/create-room-extra.dto";
import { UpdateRoomDto } from "../dto/update-room.dto";
import { RoomEntity } from "../entities/room.entity";
import { RoomBoardOptionsService } from "./room-board-options.service";
import { RoomExtrasService } from "./room-extras.service";

@Injectable()
export class RoomsService {
  constructor(
    @InjectRepository(RoomEntity)
    private readonly roomsRepository: Repository<RoomEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly roomBoardOptionsService: RoomBoardOptionsService,
    private readonly roomExtrasService: RoomExtrasService,
  ) {}

  /**
   * Runs `work` inside the caller's transaction when `manager` is given
   * (e.g. the onboarding wizard, which also updates legacy derived columns),
   * otherwise opens its own transaction.
   */
  private inTransaction<T>(
    work: (manager: EntityManager) => Promise<T>,
    manager?: EntityManager,
  ): Promise<T> {
    return manager ? work(manager) : this.dataSource.transaction(work);
  }

  async create(
    createDto: CreateRoomDto,
    outerManager?: EntityManager,
  ): Promise<RoomEntity> {
    const { board_options, extras, ...roomFields } = createDto;

    return this.inTransaction(async manager => {
      const room = await manager.save(
        RoomEntity,
        manager.create(RoomEntity, {
          ...roomFields,
          max_pets: roomFields.max_pets ?? 0,
          bathrooms: roomFields.bathrooms ?? 0,
          is_active: roomFields.is_active ?? true,
          sort_order: roomFields.sort_order ?? 0,
        }),
      );

      await this.roomBoardOptionsService.replaceBoardOptions(
        manager,
        room.id,
        board_options ?? [],
      );
      await this.roomExtrasService.replaceRoomExtras(
        manager,
        room.id,
        extras ?? [],
      );

      return this.findOneWithRelations(room.id, manager);
    }, outerManager);
  }

  async findBySite(siteId: number): Promise<RoomEntity[]> {
    const rows = await this.roomsRepository.find({
      where: { site_id: siteId },
      relations: { board_options: true, extras: true },
      order: {
        sort_order: "ASC",
        created_at: "ASC",
      },
    });
    return rows.map(row => this.sortRoomRelations(row));
  }

  async findActiveBySite(siteId: number): Promise<RoomEntity[]> {
    const rows = await this.roomsRepository.find({
      where: { site_id: siteId, is_active: true },
      relations: { board_options: true, extras: true },
      order: {
        sort_order: "ASC",
        created_at: "ASC",
      },
    });
    return rows
      .map(row => this.filterActiveRelations(row))
      .map(row => this.sortRoomRelations(row));
  }

  async findOne(id: number): Promise<RoomEntity> {
    return this.findOneWithRelations(id);
  }

  async findOneForSite(id: number, siteId: number): Promise<RoomEntity> {
    const row = await this.findOne(id);
    if (row.site_id !== siteId) {
      throw new NotFoundException(
        `room with id ${id} not found for site ${siteId}`,
      );
    }
    return row;
  }

  async update(
    id: number,
    updateDto: UpdateRoomDto,
    outerManager?: EntityManager,
  ): Promise<RoomEntity> {
    const { board_options, extras, ...roomFields } = updateDto;
    const payload = omit_undefined(roomFields as Record<string, unknown>);
    for (const imageKey of [
      "image1",
      "image2",
      "image3",
      "image4",
      "image5",
    ] as const) {
      if (imageKey in payload && payload[imageKey] === "") {
        payload[imageKey] = null;
      }
    }

    return this.inTransaction(async manager => {
      const merged = await manager.preload(RoomEntity, {
        id,
        ...payload,
      });
      if (!merged) {
        throw new NotFoundException(`room with id ${id} not found`);
      }
      await manager.save(RoomEntity, merged);

      if (board_options !== undefined) {
        await this.roomBoardOptionsService.replaceBoardOptions(
          manager,
          id,
          board_options as CreateRoomBoardOptionDto[],
        );
      }

      if (extras !== undefined) {
        await this.roomExtrasService.replaceRoomExtras(
          manager,
          id,
          extras as CreateRoomExtraDto[],
        );
      }

      return this.findOneWithRelations(id, manager);
    }, outerManager);
  }

  /**
   * Deletes the room, or only deactivates it when it has future
   * pending/confirmed reservations. Returns what actually happened.
   */
  async remove(
    id: number,
    manager: EntityManager = this.roomsRepository.manager,
  ): Promise<"deleted" | "deactivated"> {
    const room = await this.findOneWithRelations(id, manager);
    const todayIso = new Date().toISOString().slice(0, 10);

    // MariaDB: `?` placeholders; COUNT(*) may come back as string/bigint -> Number()
    const futureReservation = await manager.query<{ count: string | number }[]>(
      `SELECT COUNT(*) AS count FROM reservations
       WHERE room_id = ?
         AND status IN ('pending', 'confirmed')
         AND checkout > ?`,
      [id, todayIso],
    );

    const count = Number(futureReservation[0]?.count ?? 0);
    if (count > 0) {
      const deactivated = await manager.preload(RoomEntity, {
        id: room.id,
        is_active: false,
      });
      if (!deactivated) {
        throw new NotFoundException(`room with id ${id} not found`);
      }
      await manager.save(RoomEntity, deactivated);
      return "deactivated";
    }

    await manager.remove(RoomEntity, room);
    return "deleted";
  }

  async getRoomNameMap(roomIds: number[]): Promise<Map<number, string>> {
    if (roomIds.length === 0) {
      return new Map();
    }
    const rows = await this.roomsRepository.find({
      where: { id: In(roomIds) },
    });
    return new Map(rows.map(row => [row.id, row.name]));
  }

  private async findOneWithRelations(
    id: number,
    manager: EntityManager = this.roomsRepository.manager,
  ): Promise<RoomEntity> {
    const row = await manager.findOne(RoomEntity, {
      where: { id },
      relations: { board_options: true, extras: true },
    });
    if (!row) {
      throw new NotFoundException(`room with id ${id} not found`);
    }
    return this.sortRoomRelations(row);
  }

  private filterActiveRelations(room: RoomEntity): RoomEntity {
    room.board_options = room.board_options.filter(option => option.is_active);
    room.extras = room.extras.filter(extra => extra.is_active);
    return room;
  }

  private sortRoomRelations(room: RoomEntity): RoomEntity {
    room.board_options = [...room.board_options].sort((a, b) => {
      if (a.sort_order !== b.sort_order) {
        return a.sort_order - b.sort_order;
      }
      return String(a.id).localeCompare(String(b.id));
    });
    room.extras = [...room.extras].sort((a, b) => {
      if (a.sort_order !== b.sort_order) {
        return a.sort_order - b.sort_order;
      }
      return String(a.id).localeCompare(String(b.id));
    });
    return room;
  }
}
