import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { omit_undefined } from "@/shared/utils/omit-undefined";

import { BlocksEntity } from "@/contexts/blocks/entities/blocks.entity";

import { CreateBlocksDto } from "../dto/create-blocks.dto";
import { UpdateBlocksDto } from "../dto/update-blocks.dto";

@Injectable()
export class BlocksService {
  constructor(
    @InjectRepository(BlocksEntity)
    private readonly blocks_repository: Repository<BlocksEntity>,
  ) {}

  async create(create_dto: CreateBlocksDto) {
    const overlapping_block = await this.find_blocking_overlap(
      create_dto.site_id,
      create_dto.start_date,
      create_dto.end_date,
    );
    if (overlapping_block) {
      throw new BadRequestException(
        `Ya existe un bloque activo en el rango ${overlapping_block.start_date} al ${overlapping_block.end_date}.`,
      );
    }
    const row = this.blocks_repository.create(create_dto);
    return this.blocks_repository.save(row);
  }

  async find_all() {
    return this.blocks_repository.find({
      order: { created_at: "DESC" },
    });
  }

  /**
   * Todos los bloqueos del alojamiento, opcionalmente solo los que siguen vigentes (end_date >= hoy ISO).
   * El listado del host no debe depender del mes del calendario.
   */
  async find_by_site(
    site_id: number,
    options: { only_future?: boolean } = {},
  ): Promise<BlocksEntity[]> {
    const qb = this.blocks_repository
      .createQueryBuilder("b")
      .where("b.site_id = :site_id", { site_id })
      .orderBy("b.start_date", "DESC")
      .addOrderBy("b.id", "ASC");

    if (options.only_future === true) {
      const today_iso = new Date().toISOString().slice(0, 10);
      qb.andWhere("b.end_date >= :today_iso", { today_iso });
    }

    return qb.getMany();
  }

  /** Bloques que solapan el rango de consulta inclusive [from_iso, to_iso]. */
  async find_by_site_and_range(
    site_id: number,
    from_iso: string,
    to_iso: string,
  ): Promise<BlocksEntity[]> {
    return this.blocks_repository
      .createQueryBuilder("b")
      .where("b.site_id = :site_id", { site_id })
      .andWhere("b.start_date <= :to_iso", { to_iso })
      .andWhere("b.end_date >= :from_iso", { from_iso })
      .orderBy("b.start_date", "ASC")
      .addOrderBy("b.id", "ASC")
      .getMany();
  }

  /** ¿Existe bloque activo que interseca [checkin, checkout] mismo criterio que reservas? */
  async find_blocking_overlap(
    site_id: number,
    checkin: string,
    checkout: string,
  ): Promise<BlocksEntity | null> {
    return this.blocks_repository
      .createQueryBuilder("b")
      .where("b.site_id = :site_id", { site_id })
      .andWhere("b.start_date < :checkout", { checkout })
      .andWhere("b.end_date > :checkin", { checkin })
      .getOne();
  }

  async find_one(id: string) {
    const row = await this.blocks_repository.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException(`block with id ${id} not found`);
    }
    return row;
  }

  async update(id: string, update_dto: UpdateBlocksDto) {
    const payload = omit_undefined(update_dto as Record<string, unknown>);
    const merged = await this.blocks_repository.preload({
      id,
      ...payload,
    });
    if (!merged) {
      throw new NotFoundException(`block with id ${id} not found`);
    }
    return this.blocks_repository.save(merged);
  }

  async remove(id: string) {
    const row = await this.find_one(id);
    await this.blocks_repository.softRemove(row);
  }
}
