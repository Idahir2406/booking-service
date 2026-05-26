import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { In, LessThan, MoreThan, Repository } from "typeorm";

import { Site } from "@/src/types/site.types";

import { AvailabilityService } from "../../availability/services/availability.service";
import { BlocksService } from "../../blocks/services/blocks.service";
import { envs } from "../../shared/configs/envs";
import { MysqlService } from "../../shared/services/mysql.service";
import { CreateReservationDto } from "../dto/create-reservation.dto";
import {
  PaymentStatusValue,
  ReservationEntity,
  StatusValue,
} from "../entities/reservation.entity";

@Injectable()
export class ReservationService {
  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    private readonly mysqlService: MysqlService,
    private readonly availabilityService: AvailabilityService,
    private readonly blocksService: BlocksService,
  ) {}

  async create(createReservationDto: CreateReservationDto) {
    const overlapping_reservation = await this.findOverlappingReservation(
      createReservationDto.site_id,
      createReservationDto.checkin,
      createReservationDto.checkout,
    );
    if (overlapping_reservation) {
      throw new BadRequestException(
        `Ya existe una reserva activa del ${overlapping_reservation.checkin} al ${overlapping_reservation.checkout}.`,
      );
    }

    const blocking = await this.blocksService.find_blocking_overlap(
      createReservationDto.site_id,
      createReservationDto.checkin,
      createReservationDto.checkout,
    );
    if (blocking) {
      throw new BadRequestException(
        `Fechas no disponibles: bloque (${blocking.type}) del ${blocking.start_date} al ${blocking.end_date}.`,
      );
    }

    const availability = await this.availabilityService.checkAvailability({
      site_id: createReservationDto.site_id,
      from_date: new Date(createReservationDto.checkin),
      to_date: new Date(createReservationDto.checkout),
    });

    const sites = await this.mysqlService.query<Site[]>(
      `SELECT * FROM ${envs.DB_PREFIX}sites1 WHERE id = ?`,
      [createReservationDto.site_id],
    );
    if (sites.length === 0) {
      throw new NotFoundException(
        `Site with id ${createReservationDto.site_id} not found`,
      );
    }
    const payload = {
      ...createReservationDto,
      status: "pending" as StatusValue,
      payment_status: "pending" as PaymentStatusValue,
      expiration_date: new Date(
        Date.now() + envs.PENDING_RESERVATION_EXPIRATION_TIME,
      ),
    };
    const reservation = this.reservationRepository.create(payload);

    await this.reservationRepository.save(reservation);

    for (const date of availability) {
      await this.availabilityService.update(date.id, {
        is_available: false,
      });
    }
    return reservation;
  }

  async find_active_by_site_and_range(
    site_id: number,
    from_iso: string,
    to_iso: string,
  ): Promise<ReservationEntity[]> {
    return this.reservationRepository
      .createQueryBuilder("r")
      .where("r.site_id = :site_id", { site_id })
      .andWhere("r.status IN (:...sts)", {
        sts: ["pending", "confirmed"],
      })
      .andWhere("r.checkin <= :to_iso", { to_iso })
      .andWhere("r.checkout >= :from_iso", { from_iso })
      .orderBy("r.checkin", "ASC")
      .addOrderBy("r.id", "ASC")
      .getMany();
  }

  private async findOverlappingReservation(
    site_id: number,
    checkin: string,
    checkout: string,
  ) {
    return this.reservationRepository.findOne({
      where: {
        site_id,
        status: In(["pending", "confirmed"] satisfies StatusValue[]),
        checkin: LessThan(checkout),
        checkout: MoreThan(checkin),
      },
    });
  }

  async cancel(id: number) {
    const reservation = await this.reservationRepository.preload({
      id,
      status: "cancelled" as StatusValue,
    });
    if (!reservation) {
      throw new NotFoundException(`Reservation with id ${id} not found`);
    }
    const saved = await this.reservationRepository.save(reservation);
    await this.releaseAvailability(saved);
    return saved;
  }

  private async releaseAvailability(reservation: ReservationEntity) {
    const availability = await this.availabilityService.findBySiteAndDateRange({
      site_id: reservation.site_id,
      from_date: new Date(reservation.checkin),
      to_date: new Date(reservation.checkout),
    });

    if (availability.length === 0) {
      return;
    }

    await Promise.all(
      availability.map(date =>
        this.availabilityService.update(date.id, { is_available: true }),
      ),
    );
  }

  async confirm(id: number) {
    const reservation = await this.reservationRepository.preload({
      id,
      status: "confirmed" as StatusValue,
    });
    if (!reservation) {
      throw new NotFoundException(`Reservation with id ${id} not found`);
    }
    return this.reservationRepository.save(reservation);
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async processPendingReservations() {
    const reservations = await this.reservationRepository.find({
      where: {
        status: "pending",
        expiration_date: LessThan(new Date()),
      },
    });

    if (reservations.length === 0) {
      return;
    }

    await Promise.all(
      reservations.map(reservation => this.cancel(reservation.id)),
    );
  }
}
