import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";

import { CreateRoomExtraDto } from "../dto/create-room-extra.dto";
import { RoomExtraEntity } from "../entities/room-extra.entity";

@Injectable()
export class RoomExtrasService {
  constructor(
    @InjectRepository(RoomExtraEntity)
    private readonly roomExtrasRepository: Repository<RoomExtraEntity>,
  ) {}

  validateRoomExtras(extras: CreateRoomExtraDto[]): void {
    for (const extra of extras) {
      if (!extra.name.trim()) {
        throw new BadRequestException(
          "Cada servicio extra debe tener un nombre.",
        );
      }
      if (Number(extra.price) < 0) {
        throw new BadRequestException(
          "El precio del servicio extra no puede ser negativo.",
        );
      }
    }
  }

  normalizeExtrasInput(extras?: CreateRoomExtraDto[]): CreateRoomExtraDto[] {
    if (!extras || extras.length === 0) {
      return [];
    }
    return extras.map((extra, index) => ({
      ...extra,
      is_active: extra.is_active ?? true,
      sort_order: extra.sort_order ?? index,
      price: Number(extra.price),
    }));
  }

  async replaceRoomExtras(
    manager: EntityManager,
    roomId: string,
    extras: CreateRoomExtraDto[],
  ): Promise<RoomExtraEntity[]> {
    const normalized = this.normalizeExtrasInput(extras);
    this.validateRoomExtras(normalized);

    await manager.delete(RoomExtraEntity, { room_id: roomId });

    const rows = normalized.map(extra =>
      manager.create(RoomExtraEntity, {
        room_id: roomId,
        name: extra.name.trim(),
        description: extra.description?.trim() || undefined,
        pricing_mode: extra.pricing_mode,
        price: extra.price,
        is_active: extra.is_active ?? true,
        sort_order: extra.sort_order ?? 0,
      }),
    );

    if (rows.length === 0) {
      return [];
    }

    return manager.save(RoomExtraEntity, rows);
  }

  async findActiveExtrasByRoom(roomId: string): Promise<RoomExtraEntity[]> {
    return this.roomExtrasRepository.find({
      where: {
        room_id: roomId,
        is_active: true,
      },
      order: { sort_order: "ASC", id: "ASC" },
    });
  }
}
