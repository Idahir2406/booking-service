import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";

import { CreateRoomBoardOptionDto } from "../dto/create-room-board-option.dto";
import {
  BoardTypeValue,
  RoomBoardOptionEntity,
} from "../entities/room-board-option.entity";

export const BOARD_TYPE_LABELS: Record<BoardTypeValue, string> = {
  room_only: "Solo alojamiento",
  breakfast_included: "Desayuno incluido",
  half_board: "Media pensión",
  full_board: "Pensión completa",
  all_inclusive: "Todo incluido",
};

export interface BoardOptionSnapshot {
  code: string;
  name: string;
  description: string | null;
  is_included: boolean;
  price: number;
  board_amount: number;
}

export interface ResolvedBoardOption {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_included: boolean;
  price: number;
}

@Injectable()
export class RoomBoardOptionsService {
  constructor(
    @InjectRepository(RoomBoardOptionEntity)
    private readonly roomBoardOptionsRepository: Repository<RoomBoardOptionEntity>,
  ) {}

  buildDefaultRoomOnlyOption(): CreateRoomBoardOptionDto {
    return {
      code: "room_only",
      is_included: true,
      price: 0,
      is_default: true,
      is_active: true,
      sort_order: 0,
    };
  }

  resolveBoardTypeLabel(code: string): string {
    return BOARD_TYPE_LABELS[code as BoardTypeValue] ?? code;
  }

  validateBoardOptions(boardOptions: CreateRoomBoardOptionDto[]): void {
    const activeBoard = boardOptions.filter(opt => opt.is_active !== false);

    if (activeBoard.length === 0) {
      throw new BadRequestException("Debe haber al menos una pensión activa.");
    }

    const defaultCount = activeBoard.filter(
      opt => opt.is_default === true,
    ).length;
    if (defaultCount !== 1) {
      throw new BadRequestException(
        "Debe haber exactamente una pensión predeterminada entre las activas.",
      );
    }

    const includedCount = boardOptions.filter(
      opt => opt.is_included === true,
    ).length;
    if (includedCount > 1) {
      throw new BadRequestException(
        "Solo puede haber una pensión marcada como incluida.",
      );
    }

    const codes = boardOptions.map(opt => opt.code);
    const uniqueCodes = new Set(codes);
    if (uniqueCodes.size !== codes.length) {
      throw new BadRequestException(
        "Cada tipo de pensión solo puede aparecer una vez por habitación.",
      );
    }

    for (const opt of boardOptions) {
      if (opt.is_included === true && Number(opt.price) !== 0) {
        throw new BadRequestException(
          "Las pensiones incluidas deben tener precio 0.",
        );
      }
      if (Number(opt.price) < 0) {
        throw new BadRequestException(
          "El suplemento de la pensión no puede ser negativo.",
        );
      }
    }
  }

  normalizeBoardOptionsInput(
    boardOptions?: CreateRoomBoardOptionDto[],
  ): CreateRoomBoardOptionDto[] {
    if (!boardOptions || boardOptions.length === 0) {
      return [this.buildDefaultRoomOnlyOption()];
    }
    return boardOptions.map((opt, index) => ({
      ...opt,
      description: opt.description?.trim() || undefined,
      is_included: opt.is_included ?? false,
      is_default: opt.is_default ?? false,
      is_active: opt.is_active ?? true,
      sort_order: opt.sort_order ?? index,
      price: opt.is_included ? 0 : Number(opt.price),
    }));
  }

  async replaceBoardOptions(
    manager: EntityManager,
    roomId: string,
    boardOptions: CreateRoomBoardOptionDto[],
  ): Promise<RoomBoardOptionEntity[]> {
    const normalized = this.normalizeBoardOptionsInput(boardOptions);
    this.validateBoardOptions(normalized);

    await manager.delete(RoomBoardOptionEntity, { room_id: roomId });

    const rows = normalized.map(opt =>
      manager.create(RoomBoardOptionEntity, {
        room_id: roomId,
        code: opt.code,
        description: opt.description ?? null,
        price: opt.is_included ? 0 : opt.price,
        is_included: opt.is_included ?? false,
        is_default: opt.is_default ?? false,
        is_active: opt.is_active ?? true,
        sort_order: opt.sort_order ?? 0,
      }),
    );

    return manager.save(RoomBoardOptionEntity, rows);
  }

  async findActiveBoardOptionsByRoom(
    roomId: string,
  ): Promise<RoomBoardOptionEntity[]> {
    return this.roomBoardOptionsRepository.find({
      where: {
        room_id: roomId,
        is_active: true,
      },
      order: { sort_order: "ASC", id: "ASC" },
    });
  }

  resolveBoardOptionFromList(
    boardOptions: RoomBoardOptionEntity[],
    boardOptionId?: string,
  ): RoomBoardOptionEntity {
    if (boardOptions.length === 0) {
      throw new BadRequestException(
        "La habitación no tiene pensiones configuradas.",
      );
    }

    if (boardOptionId) {
      const selected = boardOptions.find(opt => opt.id === boardOptionId);
      if (!selected) {
        throw new BadRequestException(
          "La pensión seleccionada no pertenece a esta habitación.",
        );
      }
      return selected;
    }

    const defaultOpt = boardOptions.find(opt => opt.is_default);
    if (defaultOpt) {
      return defaultOpt;
    }

    return boardOptions[0];
  }

  calculateBoardAmount(
    isIncluded: boolean,
    price: number,
    nights: number,
  ): number {
    if (isIncluded) {
      return 0;
    }
    return Number(price) * nights;
  }

  calculateBoardAmountForOption(
    option: RoomBoardOptionEntity,
    nights: number,
  ): number {
    return this.calculateBoardAmount(
      option.is_included,
      Number(option.price),
      nights,
    );
  }

  toResolvedBoardOption(option: RoomBoardOptionEntity): ResolvedBoardOption {
    return {
      id: option.id,
      code: option.code,
      name: this.resolveBoardTypeLabel(option.code),
      description: option.description ?? null,
      is_included: option.is_included,
      price: Number(option.price),
    };
  }

  buildBoardSnapshot(
    option: RoomBoardOptionEntity,
    boardAmount: number,
  ): BoardOptionSnapshot {
    return {
      code: option.code,
      name: this.resolveBoardTypeLabel(option.code),
      description: option.description ?? null,
      is_included: option.is_included,
      price: Number(option.price),
      board_amount: boardAmount,
    };
  }
}
