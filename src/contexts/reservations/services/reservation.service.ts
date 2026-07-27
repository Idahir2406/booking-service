import type { RoomExtraEntity } from "../../rooms/entities/room-extra.entity";
import type { ResolvedBoardOption } from "../../rooms/services/room-board-options.service";
import type { StripeService } from "../../stripe/services/stripe.service";
import type { ReservationWithRoomName } from "../dto/reservation-with-room.dto";

import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { In, LessThan, MoreThan, Repository } from "typeorm";

import { Site } from "@/src/types/site.types";

import { AvailabilityService } from "../../availability/services/availability.service";
import { BlocksService } from "../../blocks/services/blocks.service";
import { RoomBoardOptionsService } from "../../rooms/services/room-board-options.service";
import { RoomExtrasService } from "../../rooms/services/room-extras.service";
import { RoomsService } from "../../rooms/services/rooms.service";
import { envs } from "../../shared/configs/envs";
import { MysqlService } from "../../shared/services/mysql.service";
import { CheckoutReservationDto } from "../dto/checkout-reservation.dto";
import { CreateReservationDto } from "../dto/create-reservation.dto";
import { QuoteReservationDto } from "../dto/quote-reservation.dto";
import { ReservationPublicSummaryDto } from "../dto/reservation-public-summary.dto";
import {
  PaymentStatusValue,
  ReservationEntity,
  StatusValue,
} from "../entities/reservation.entity";
import {
  computeReservationPolicyCapabilities,
  formatUtcIsoDate,
  parseIsoDateAtUtcMidnight,
} from "../utils/reservation-policy.util";

export interface ActivateFromPaymentInput {
  reservationId: number;
  checkoutSessionId: string;
  paymentIntentId: string | null;
  amountPaidCents: number;
}

export interface ActivateFromPaymentResult {
  reservation: ReservationEntity;
  activated: boolean;
}

export interface QuoteReservationResult {
  valid: boolean;
  nights: number;
  nightly_rate: number;
  base_subtotal: number;
  board_amount: number;
  subtotal: number;
  commission: number;
  total: number;
  min_nights: number | null;
  max_nights: number | null;
  board_option: ResolvedBoardOption | null;
  extras: RoomExtraEntity[];
  errors: string[];
}

@Injectable()
export class ReservationService {
  private readonly logger = new Logger(ReservationService.name);

  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    private readonly mysqlService: MysqlService,
    private readonly availabilityService: AvailabilityService,
    private readonly blocksService: BlocksService,
    private readonly roomsService: RoomsService,
    private readonly roomBoardOptionsService: RoomBoardOptionsService,
    private readonly roomExtrasService: RoomExtrasService,
    @Inject(
      forwardRef(
        () => require("../../stripe/services/stripe.service").StripeService,
      ),
    )
    private readonly stripeService: StripeService,
  ) {}

  async quoteReservation(
    dto: QuoteReservationDto,
  ): Promise<QuoteReservationResult> {
    const errors: string[] = [];
    const nights = this.calcNights(dto.checkin, dto.checkout);

    if (nights <= 0) {
      errors.push("La fecha de salida debe ser posterior al check-in.");
      return this.buildInvalidQuote(errors);
    }

    const site = await this.mysqlService.queryOne<Site>(
      `SELECT * FROM ${envs.DB_PREFIX}sites1 WHERE id = ?`,
      [dto.site_id],
    );
    if (!site) {
      errors.push("El alojamiento no existe.");
      return this.buildInvalidQuote(errors, nights);
    }

    let room;
    try {
      room = await this.roomsService.findOneForSite(dto.room_id, dto.site_id);
    } catch {
      errors.push("La habitación seleccionada no existe.");
      return this.buildInvalidQuote(errors, nights);
    }

    if (!room.is_active) {
      errors.push("La habitación seleccionada no está disponible.");
    }

    if (dto.guests > room.max_guests) {
      errors.push(
        `El máximo de huéspedes para esta habitación es ${room.max_guests}.`,
      );
    }

    if (dto.pets > room.max_pets) {
      errors.push(
        `El máximo de mascotas para esta habitación es ${room.max_pets}.`,
      );
    }

    const nightlyRate = Number(room.price_per_night);
    if (!Number.isFinite(nightlyRate) || nightlyRate <= 0) {
      errors.push("La habitación no tiene un precio válido configurado.");
    }

    const nightDates = this.getNightDates(dto.checkin, dto.checkout);
    const lastNight = nightDates.at(-1);
    const availabilityRows =
      lastNight === undefined
        ? []
        : await this.availabilityService.findByRoomAndIsoRange(
            dto.room_id,
            dto.checkin,
            lastNight,
          );

    const availabilityByDate = new Map(
      availabilityRows.map(row => [this.formatIsoDate(row.date), row]),
    );

    const missingDates = nightDates.filter(
      date => !availabilityByDate.has(date),
    );
    if (missingDates.length > 0) {
      errors.push("No hay disponibilidad para las fechas seleccionadas.");
    }

    const unavailableDates = nightDates.filter(date => {
      const row = availabilityByDate.get(date);
      return row !== undefined && !row.is_available;
    });
    if (unavailableDates.length > 0) {
      errors.push("Una o más fechas seleccionadas no están disponibles.");
    }

    const checkinRow = availabilityByDate.get(dto.checkin);
    const minNights = checkinRow?.min_nights ?? null;
    const maxNights = checkinRow?.max_nights ?? null;

    if (minNights !== null && nights < minNights) {
      errors.push(`La estancia mínima es de ${minNights} noches.`);
    }

    if (maxNights !== null && nights > maxNights) {
      errors.push(`La estancia máxima es de ${maxNights} noches.`);
    }

    const blocking = await this.blocksService.find_blocking_overlap(
      dto.site_id,
      dto.room_id,
      dto.checkin,
      dto.checkout,
    );
    if (blocking) {
      errors.push(
        `Fechas bloqueadas del ${blocking.start_date} al ${blocking.end_date}.`,
      );
    }

    const overlappingReservation = await this.findOverlappingReservation(
      dto.site_id,
      dto.room_id,
      dto.checkin,
      dto.checkout,
    );
    if (overlappingReservation) {
      errors.push(
        `Ya existe una reserva activa del ${overlappingReservation.checkin} al ${overlappingReservation.checkout}.`,
      );
    }

    const hostUserId = site.user_id ?? 0;
    if (hostUserId) {
      try {
        const connectStatus =
          await this.stripeService.getConnectStatus(hostUserId);
        if (!connectStatus.can_use_reservations) {
          errors.push(
            "El anfitrión aún no puede recibir pagos. Inténtalo más tarde.",
          );
        }
      } catch {
        errors.push(
          "El anfitrión aún no puede recibir pagos. Inténtalo más tarde.",
        );
      }
    } else {
      errors.push("El anfitrión no está configurado para recibir reservas.");
    }

    const rate = Math.max(nightlyRate, 0);
    const baseSubtotal = nights * rate;

    const boardOptions =
      await this.roomBoardOptionsService.findActiveBoardOptionsByRoom(
        dto.room_id,
      );

    let boardOption = null as
      | Awaited<
          ReturnType<RoomBoardOptionsService["findActiveBoardOptionsByRoom"]>
        >[number]
      | null;

    if (boardOptions.length === 0) {
      errors.push("La habitación no tiene pensiones configuradas.");
    } else {
      try {
        boardOption = this.roomBoardOptionsService.resolveBoardOptionFromList(
          boardOptions,
          dto.board_option_id,
        );
      } catch (error) {
        if (error instanceof BadRequestException) {
          const response = error.getResponse();
          if (typeof response === "string") {
            errors.push(response);
          } else if (typeof response === "object" && "message" in response) {
            const message = (response as { message?: string | string[] })
              .message;
            if (Array.isArray(message)) {
              errors.push(...message);
            } else if (message) {
              errors.push(message);
            }
          }
        } else {
          errors.push("La pensión seleccionada no está disponible.");
        }
      }
    }

    const boardAmount =
      boardOption === null
        ? 0
        : this.roomBoardOptionsService.calculateBoardAmountForOption(
            boardOption,
            nights,
          );

    const activeExtras = await this.roomExtrasService.findActiveExtrasByRoom(
      dto.room_id,
    );

    const subtotal = baseSubtotal + boardAmount;
    const commission = 0;
    const total = subtotal;

    return {
      valid: errors.length === 0,
      nights,
      nightly_rate: rate,
      base_subtotal: baseSubtotal,
      board_amount: boardAmount,
      subtotal,
      commission,
      total,
      min_nights: minNights,
      max_nights: maxNights,
      board_option:
        boardOption === null
          ? null
          : this.roomBoardOptionsService.toResolvedBoardOption(boardOption),
      extras: activeExtras,
      errors,
    };
  }

  async checkout(dto: CheckoutReservationDto) {
    const quote = await this.quoteReservation(dto);
    if (!quote.valid) {
      throw new BadRequestException({
        message: "La reserva no es válida.",
        errors: quote.errors,
      });
    }

    const reservation = await this.createPendingFromCheckout(dto, quote);
    const stripeResult = await this.stripeService.createSitePaymentLink({
      reservation_id: reservation.id,
      email: dto.guest_email,
    });

    return {
      reservation_id: reservation.id,
      checkout_url: stripeResult.url,
      expires_at: reservation.expiration_date,
    };
  }

  async getPublicSummary(id: number): Promise<ReservationPublicSummaryDto> {
    const reservation = await this.findById(id);
    if (!reservation) {
      throw new NotFoundException(`Reservation with id ${id} not found`);
    }

    return {
      id: reservation.id,
      code: `#RES-${reservation.id}`,
      site_id: reservation.site_id,
      status: reservation.status,
      payment_status: reservation.payment_status,
      checkin: reservation.checkin,
      checkout: reservation.checkout,
      guests: reservation.guests,
      pets: reservation.pets,
      subtotal:
        reservation.subtotal || reservation.subtotal
          ? null
          : Number(reservation.subtotal),
      commission:
        reservation.commission || reservation.commission
          ? null
          : Number(reservation.commission),
      total:
        reservation.total || reservation.total
          ? null
          : Number(reservation.total),
      guest_name: reservation.guest_name ?? null,
    };
  }

  async getSiteById(siteId: number): Promise<Site> {
    const site = await this.mysqlService.queryOne<Site>(
      `SELECT * FROM ${envs.DB_PREFIX}sites1 WHERE id = ?`,
      [siteId],
    );
    if (!site) {
      throw new NotFoundException(`Site with id ${siteId} not found`);
    }
    return site;
  }

  async create(createReservationDto: CreateReservationDto) {
    await this.roomsService.findOneForSite(
      createReservationDto.room_id,
      createReservationDto.site_id,
    );

    const overlapping_reservation = await this.findOverlappingReservation(
      createReservationDto.site_id,
      createReservationDto.room_id,
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
      createReservationDto.room_id,
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
      room_id: createReservationDto.room_id,
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

  private async createPendingFromCheckout(
    dto: CheckoutReservationDto,
    quote: QuoteReservationResult,
  ) {
    const nightDates = this.getNightDates(dto.checkin, dto.checkout);
    const lastNight = nightDates.at(-1);
    const availabilityRows =
      lastNight === undefined
        ? []
        : await this.availabilityService.findByRoomAndIsoRange(
            dto.room_id,
            dto.checkin,
            lastNight,
          );

    const expirationDate = new Date(
      Date.now() + envs.PENDING_RESERVATION_EXPIRATION_TIME,
    );

    const reservation = this.reservationRepository.create({
      site_id: dto.site_id,
      room_id: dto.room_id,
      board_option_id: quote.board_option?.id,
      board_snapshot:
        quote.board_option === null
          ? undefined
          : {
              code: quote.board_option.code,
              name: quote.board_option.name,
              description: quote.board_option.description,
              is_included: quote.board_option.is_included,
              price: quote.board_option.price,
              board_amount: quote.board_amount,
            },
      extras_snapshot: [],
      source: "internal",
      user_id: dto.user_id ?? 0,
      checkin: dto.checkin,
      checkout: dto.checkout,
      guests: dto.guests,
      pets: dto.pets,
      subtotal: quote.subtotal,
      commission: quote.commission,
      total: quote.total,
      guest_name: dto.guest_name,
      guest_email: dto.guest_email,
      guest_phone: dto.guest_phone,
      guest_notes: dto.guest_notes,
      status: "pending",
      payment_status: "pending",
      expiration_date: expirationDate,
    });

    await this.reservationRepository.save(reservation);

    for (const date of availabilityRows) {
      await this.availabilityService.update(date.id, {
        is_available: false,
      });
    }

    return reservation;
  }

  async findById(id: number) {
    return this.reservationRepository.findOne({
      where: { id },
    });
  }

  async find_active_by_site_and_range(
    site_id: number,
    from_iso: string,
    to_iso: string,
  ): Promise<ReservationWithRoomName[]> {
    const rows = await this.reservationRepository
      .createQueryBuilder("r")
      .where("r.site_id = :site_id", { site_id })
      .andWhere("r.status IN (:...sts)", {
        sts: ["pending", "confirmed", "finalized"],
      })
      .andWhere("r.checkin <= :to_iso", { to_iso })
      .andWhere("r.checkout >= :from_iso", { from_iso })
      .orderBy("r.checkin", "ASC")
      .addOrderBy("r.id", "ASC")
      .getMany();
    const roomIds = [...new Set(rows.map(row => row.room_id))];
    const roomNames = new Map<string, string>();
    for (const roomId of roomIds) {
      try {
        const room = await this.roomsService.findOne(roomId);
        roomNames.set(roomId, room.name);
      } catch {
        roomNames.set(roomId, "");
      }
    }

    return rows.map(row => {
      const subtotal = row.subtotal;
      const checkinMs = new Date(row.checkin).getTime();
      const checkoutMs = new Date(row.checkout).getTime();
      const nights =
        Number.isFinite(checkinMs) && Number.isFinite(checkoutMs)
          ? Math.max(
              0,
              Math.round((checkoutMs - checkinMs) / (24 * 60 * 60 * 1000)),
            )
          : 0;
      const boardAmount = row.board_snapshot?.board_amount ?? 0;
      const base_subtotal = subtotal ? Math.max(0, subtotal - boardAmount) : 0;

      const policy = computeReservationPolicyCapabilities(row);

      return {
        ...row,
        subtotal,
        commission: row.commission,
        total: row.total,
        room_name: roomNames.get(row.room_id) ?? null,
        nights,
        base_subtotal,
        can_cancel: policy.can_cancel,
        can_refund: policy.can_refund,
        can_finalize: policy.can_finalize,
        refund_deadline: policy.refund_deadline,
      };
    });
  }

  private async findOverlappingReservation(
    site_id: number,
    room_id: string,
    checkin: string,
    checkout: string,
  ) {
    return this.reservationRepository.findOne({
      where: {
        site_id,
        room_id,
        status: In([
          "pending",
          "confirmed",
          "finalized",
        ] satisfies StatusValue[]),
        checkin: LessThan(checkout),
        checkout: MoreThan(checkin),
      },
    });
  }

  async saveStripeCheckoutSessionId(id: number, checkoutSessionId: string) {
    const reservation = await this.reservationRepository.preload({
      id,
      stripe_checkout_session_id: checkoutSessionId,
    });
    if (!reservation) {
      throw new NotFoundException(`Reservation with id ${id} not found`);
    }
    return this.reservationRepository.save(reservation);
  }

  async activateFromPayment(
    input: ActivateFromPaymentInput,
  ): Promise<ActivateFromPaymentResult> {
    const reservation = await this.reservationRepository.findOne({
      where: { id: input.reservationId },
    });
    if (!reservation) {
      throw new NotFoundException(
        `Reservation with id ${input.reservationId} not found`,
      );
    }

    if (
      reservation.status === "confirmed" &&
      reservation.payment_status === "paid"
    ) {
      return { reservation, activated: false };
    }

    if (reservation.status === "cancelled") {
      this.logger.warn(
        `Payment received for cancelled reservation ${reservation.id} (session ${input.checkoutSessionId}). Manual review required.`,
      );
      return { reservation, activated: false };
    }

    if (
      reservation.status !== "pending" ||
      reservation.payment_status !== "pending"
    ) {
      this.logger.warn(
        `Payment received for reservation ${reservation.id} in unexpected state: status=${reservation.status}, payment_status=${reservation.payment_status}`,
      );
      return { reservation, activated: false };
    }
    const expectedAmountCents = Math.round(
      (Number(reservation.subtotal) + Number(reservation.commission)) * 100,
    );

    if (input.amountPaidCents !== expectedAmountCents) {
      throw new BadRequestException(
        `Payment amount mismatch for reservation ${reservation.id}: expected ${expectedAmountCents} cents, got ${input.amountPaidCents}`,
      );
    }

    const paidAt = new Date();
    const totalPaid = input.amountPaidCents / 100;

    const updated = await this.reservationRepository.preload({
      id: reservation.id,
      status: "confirmed" as StatusValue,
      payment_status: "paid" as PaymentStatusValue,
      payout_status: "held",
      paid_at: paidAt,
      stripe_checkout_session_id: input.checkoutSessionId,
      stripe_payment_intent_id: input.paymentIntentId ?? undefined,
      total: totalPaid,
    });

    if (!updated) {
      throw new NotFoundException(
        `Reservation with id ${input.reservationId} not found`,
      );
    }

    const saved = await this.reservationRepository.save(updated);
    return { reservation: saved, activated: true };
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
    await this.releaseAvailabilityForReservation(saved);
    return saved;
  }

  async releaseAvailabilityForReservation(reservation: ReservationEntity) {
    await this.releaseAvailability(reservation);
  }

  async releaseRemainingAvailabilityForReservation(
    reservation: ReservationEntity,
  ) {
    const todayIso = formatUtcIsoDate(new Date());
    const checkinIso = reservation.checkin.slice(0, 10);
    const checkoutIso = reservation.checkout.slice(0, 10);
    const releaseFromMs = Math.max(
      parseIsoDateAtUtcMidnight(checkinIso).getTime(),
      parseIsoDateAtUtcMidnight(todayIso).getTime(),
    );
    const releaseFromIso = formatUtcIsoDate(new Date(releaseFromMs));

    if (releaseFromIso >= checkoutIso) {
      return;
    }

    const nightDates = this.getNightDates(releaseFromIso, reservation.checkout);
    const lastNight = nightDates.at(-1);
    if (lastNight === undefined) {
      return;
    }

    const availability = await this.availabilityService.findByRoomAndIsoRange(
      reservation.room_id,
      releaseFromIso,
      lastNight,
    );

    if (availability.length === 0) {
      return;
    }

    await Promise.all(
      availability.map(date =>
        this.availabilityService.update(date.id, { is_available: true }),
      ),
    );
  }

  private async releaseAvailability(reservation: ReservationEntity) {
    const nightDates = this.getNightDates(
      reservation.checkin,
      reservation.checkout,
    );
    const lastNight = nightDates.at(-1);
    if (lastNight === undefined) {
      return;
    }

    const availability = await this.availabilityService.findByRoomAndIsoRange(
      reservation.room_id,
      reservation.checkin,
      lastNight,
    );

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
    const reservation = await this.reservationRepository.findOne({
      where: { id },
    });
    if (!reservation) {
      throw new NotFoundException(`Reservation with id ${id} not found`);
    }

    if (
      reservation.status === "confirmed" &&
      reservation.payment_status === "paid"
    ) {
      return reservation;
    }

    if (reservation.status !== "pending") {
      throw new BadRequestException(
        `Cannot confirm reservation ${id} with status ${reservation.status}`,
      );
    }

    const updated = await this.reservationRepository.preload({
      id,
      status: "confirmed" as StatusValue,
      payment_status: "paid" as PaymentStatusValue,
      paid_at: new Date(),
    });
    if (!updated) {
      throw new NotFoundException(`Reservation with id ${id} not found`);
    }
    return this.reservationRepository.save(updated);
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

  private buildInvalidQuote(
    errors: string[],
    nights = 0,
  ): QuoteReservationResult {
    return {
      valid: false,
      nights,
      nightly_rate: 0,
      base_subtotal: 0,
      board_amount: 0,
      subtotal: 0,
      commission: 0,
      total: 0,
      min_nights: null,
      max_nights: null,
      board_option: null,
      extras: [],
      errors,
    };
  }

  private calcNights(checkin: string, checkout: string): number {
    const start = new Date(`${checkin}T00:00:00`);
    const end = new Date(`${checkout}T00:00:00`);
    const diffMs = end.getTime() - start.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  private getNightDates(checkin: string, checkout: string): string[] {
    const dates: string[] = [];
    const current = new Date(`${checkin}T00:00:00`);
    const end = new Date(`${checkout}T00:00:00`);

    while (current < end) {
      dates.push(this.formatIsoDate(current));
      current.setDate(current.getDate() + 1);
    }

    return dates;
  }

  private formatIsoDate(value: Date | string): string {
    if (typeof value === "string") {
      return value.slice(0, 10);
    }

    const year = value.getFullYear();
    const month = `${value.getMonth() + 1}`.padStart(2, "0");
    const day = `${value.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private parseSiteNightlyRate(
    precio: string | null | undefined,
  ): number | null {
    if (!precio) {
      return null;
    }

    const cleaned = precio.replaceAll(/[^\d.,]/g, "").replace(",", ".");
    const rate = Number.parseFloat(cleaned);
    if (!Number.isFinite(rate) || rate <= 0) {
      return null;
    }

    return rate;
  }
}
