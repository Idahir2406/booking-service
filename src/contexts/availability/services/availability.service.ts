import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, Repository } from "typeorm";

import { AvailabilityEntity } from "@/contexts/availability/entities/availability.entity";

import { MysqlService } from "../../shared/services/mysql.service";
import { CreateAvailabilityDto } from "../dto/create-availability.dto";
import { UpdateAvailabilityDto } from "../dto/update-availability.dto";

@Injectable()
export class AvailabilityService {
  constructor(
    @InjectRepository(AvailabilityEntity)
    private readonly availabilityRepository: Repository<AvailabilityEntity>,
    private readonly mysqlService: MysqlService,
  ) {}

  async create(create_dto: CreateAvailabilityDto) {
    const base_date = new Date();
    base_date.setHours(0, 0, 0, 0);
    if (create_dto.anchor_date) {
      const parts = create_dto.anchor_date.split("-").map(Number);
      const y = parts[0] ?? Number.NaN;
      const m = parts[1] ?? Number.NaN;
      const d = parts[2] ?? Number.NaN;
      base_date.setFullYear(y, m - 1, d);
    } else {
      base_date.setDate(base_date.getDate() + 1);
    }

    const is_available_initial = create_dto.is_available ?? true;
    const days_numbers = Array.from({ length: create_dto.day }, (_, i) => {
      const date = new Date(base_date);
      date.setDate(base_date.getDate() + i);
      const y = date.getFullYear();
      const mo = `${date.getMonth() + 1}`.padStart(2, "0");
      const da = `${date.getDate()}`.padStart(2, "0");
      return `${y}-${mo}-${da}`;
    });

    const rows_payload = days_numbers.map(date_string => ({
      site_id: create_dto.site_id,
      min_nights: create_dto.min_nights,
      max_nights: create_dto.max_nights,
      is_available: is_available_initial,
      date: date_string,
    }));

    const rows_created = this.availabilityRepository.create(rows_payload);
    return this.availabilityRepository.save(rows_created);
  }

  async findAll() {
    return this.availabilityRepository.find({
      order: { created_at: "DESC" },
    });
  }

  async findOne(id: string) {
    const row = await this.availabilityRepository.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException(`availability with id ${id} not found`);
    }
    return row;
  }

  async update(id: string, update_dto: UpdateAvailabilityDto) {
    const availability = await this.availabilityRepository.preload({
      id,
      ...update_dto,
    });
    if (!availability) {
      throw new NotFoundException(`availability with id ${id} not found`);
    }
    return this.availabilityRepository.save(availability);
  }

  async remove(id: string) {
    const row = await this.findOne(id);
    await this.availabilityRepository.remove(row);
  }

  async findBySiteAndDateRange({
    site_id,
    from_date,
    to_date,
  }: {
    site_id: number;
    from_date: Date;
    to_date: Date;
  }) {
    return this.availabilityRepository.find({
      where: { site_id, date: Between(from_date, to_date) },
      order: { date: "ASC" },
    });
  }

  async findBySiteAndIsoRange(
    site_id: number,
    from_iso: string,
    to_iso: string,
  ): Promise<AvailabilityEntity[]> {
    return this.findBySiteAndDateRange({
      site_id,
      from_date: new Date(from_iso),
      to_date: new Date(to_iso),
    });
  }

  async checkAvailability({
    site_id,
    from_date,
    to_date,
  }: {
    site_id: number;
    from_date: Date;
    to_date: Date;
  }) {
    const availability = await this.findBySiteAndDateRange({
      site_id,
      from_date,
      to_date,
    });
    if (availability.length === 0) {
      throw new NotFoundException(
        `El alojamiento no está disponible para las fechas ${from_date.toISOString()} a ${to_date.toISOString()}`,
      );
    }

    const unavailableDates = availability.filter(a => !a.is_available);
    if (unavailableDates.length > 0) {
      throw new NotFoundException(
        `El alojamiento no está disponible para las fechas ${unavailableDates.map(a => a.date).join(", ")}`,
      );
    }
    return availability;
  }
}
