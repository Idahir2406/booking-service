import type { PriceLinesSummary } from "../../payments/domain/price-lines";
import type {
  SnapshotBoard,
  SnapshotDeposit,
  SnapshotF2Extension,
  SnapshotRoom,
} from "../../payments/domain/reservation-snapshot";
import type { DogCompatibilityResult } from "../../pet-policies/domain/dog-compatibility";
import type { UnitPetPolicyEntity } from "../../pet-policies/entities/unit-pet-policy.entity";
import type { RoomExtraEntity } from "../../rooms/entities/room-extra.entity";
import type { ResolvedBoardOption } from "../../rooms/services/room-board-options.service";
import type { StripeService } from "../../stripe/services/stripe.service";
import type { PublicRoomCalendarDto } from "../dto/public-room-calendar.dto";
import type { ReservationWithRoomName } from "../dto/reservation-with-room.dto";

import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, In, LessThan, Repository } from "typeorm";

import { Site } from "@/src/types/site.types";

import { AvailabilityEntity } from "../../availability/entities/availability.entity";
import { AvailabilityService } from "../../availability/services/availability.service";
import { BlocksService } from "../../blocks/services/blocks.service";
import { type Actor, actors } from "../../payments/domain/audit-actor";
import {
  buildCheckoutPriceLines,
  type PriceLineDraft,
  summarizePriceLines,
} from "../../payments/domain/price-lines";
import {
  type PricedExtraOption,
  priceLineDetail,
} from "../../payments/domain/reservation-pricing";
import { SNAPSHOT_REASON } from "../../payments/entities/reservation-snapshot.entity";
import { paymentKeys } from "../../payments/services/payment-ledger.service";
import {
  freezeReservationFields,
  type FrozenTerms,
  ReservationEconomicsService,
} from "../../payments/services/reservation-economics.service";
import { centsToDecimal, toCents } from "../../payments/utils/money.util";
import { RoomBoardOptionsService } from "../../rooms/services/room-board-options.service";
import { RoomExtrasService } from "../../rooms/services/room-extras.service";
import { RoomsService } from "../../rooms/services/rooms.service";
import { envs } from "../../shared/configs/envs";
import { MysqlService } from "../../shared/services/mysql.service";
import { stripeIdempotencyKeys } from "../../stripe/utils/stripe-idempotency.util";
import { TravelerDogsService } from "../../traveler-dogs/services/traveler-dogs.service";
import { CheckoutReservationDto } from "../dto/checkout-reservation.dto";
import { CreateReservationDto } from "../dto/create-reservation.dto";
import { QuoteReservationDto } from "../dto/quote-reservation.dto";
import { ReservationPublicSummaryDto } from "../dto/reservation-public-summary.dto";
import {
  PaymentStatusValue,
  ReservationEntity,
  StatusValue,
} from "../entities/reservation.entity";
import { expectedChargeCents } from "../utils/reservation-amount.util";
import { HostPayoutBlockService } from "./host-payout-block.service";
import {
  calcNightsUtc,
  computeReservationPolicyCapabilities,
  formatUtcIsoDate,
  getNightDatesUtc,
  isReservationBlockingInventory,
  parseIsoDateAtUtcMidnight,
  resolvePendingTtlMs,
} from "../utils/reservation-policy.util";
import {
  assembleQuotePricing,
  type AvailableExtraOption,
  type AvailableServiceOption,
  type PublicDogPolicySummary,
  type QuotePricingInput,
  type SelectionIssue,
  toPublicDogPolicy,
  type UnitDogPolicyInput,
} from "../utils/reservation-quote.util";
import {
  linkSavedDogs,
  requestedSavedDogIds,
} from "../utils/saved-dog-link.util";
import {
  TRAVELER_TOKEN_STATUS,
  verifyTravelerToken,
} from "../utils/traveler-token.util";
import { ReservationEventService } from "./reservation-event.service";
import { ReservationQuoteContextService } from "./reservation-quote-context.service";

export interface ActivateFromPaymentInput {
  reservationId: number;
  checkoutSessionId: string;
  paymentIntentId: string | null;
  amountPaidCents: number;
  /** Who applies it (Stripe event id for webhooks). Defaults to stripe. */
  actor?: Actor;
}

export const PAYMENT_ACTIVATION_OUTCOME = {
  /** pending reservation confirmed and nights blocked after Stripe succeeded. */
  ACTIVATED: "activated",
  /** cancelled/expired reservation re-confirmed: dates were still free. */
  REACTIVATED: "reactivated",
  /** replay of an already-applied payment: nothing to do. */
  ALREADY_ACTIVE: "already_active",
  /** payment could not be honoured: full automatic refund issued. */
  REFUNDED: "refunded",
} as const;

export type PaymentActivationOutcome =
  (typeof PAYMENT_ACTIVATION_OUTCOME)[keyof typeof PAYMENT_ACTIVATION_OUTCOME];

export const AUTO_REFUND_REASON = {
  DATES_UNAVAILABLE: "payment_after_expiry_dates_unavailable",
  AMOUNT_MISMATCH: "amount_mismatch",
  DUPLICATE_PAYMENT: "duplicate_payment",
  INVALID_STATE: "invalid_state",
} as const;

export type AutoRefundReason =
  (typeof AUTO_REFUND_REASON)[keyof typeof AUTO_REFUND_REASON];

export interface ActivateFromPaymentResult {
  reservation: ReservationEntity;
  outcome: PaymentActivationOutcome;
  /** Only for REFUNDED. */
  refundReason?: AutoRefundReason;
}

/** Price line as exposed by the public quote (cents, same lines as checkout). */
export interface PublicPriceLine {
  type: string;
  description: string;
  detail: string | null;
  quantity: number;
  unit_amount_cents: number;
  amount_cents: number;
  is_optional: boolean;
  is_commissionable: boolean;
  is_penalizable: boolean;
}

/** Traveler-facing totals (no V4P commission: A2, internal only). */
export interface QuoteTotals {
  total_cents: number;
  mandatory_cents: number;
  optional_cents: number;
  penalizable_cents: number;
}

/**
 * Checkout-only data computed by the same quote (never serialized: the
 * controller strips it with toPublicQuote()).
 */
export interface QuoteInternal {
  lines: PriceLineDraft[];
  totals: PriceLinesSummary;
  pets: number;
  board: SnapshotBoard | null;
  snapshotExtension: SnapshotF2Extension;
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
  // ---- F2 (complete price) --------------------------------------------
  currency?: string;
  /** Dogs counted (dogs.length, or legacy `pets`). */
  pets?: number;
  price_lines?: PublicPriceLine[];
  totals?: QuoteTotals | null;
  compatibility?: DogCompatibilityResult | null;
  dog_policy?: PublicDogPolicySummary | null;
  /** Informative only (A26): not charged, not part of total. */
  deposit?: SnapshotDeposit | null;
  available_services?: AvailableServiceOption[];
  available_extras?: AvailableExtraOption[];
  selection_issues?: SelectionIssue[];
  /** Hook: no tourist-tax data source yet (F2 doc). */
  tourist_tax?: null;
  internal?: QuoteInternal;
}

/** Public shape of a quote: drops the internal checkout payload. */
export function toPublicQuote(
  quote: QuoteReservationResult,
): Omit<QuoteReservationResult, "internal"> {
  const rest: QuoteReservationResult = { ...quote };
  delete rest.internal;
  return rest;
}

function toPublicLine(line: PriceLineDraft): PublicPriceLine {
  return {
    type: line.type,
    description: line.description,
    detail: priceLineDetail(line),
    quantity: line.quantity,
    unit_amount_cents: line.unit_amount_cents,
    amount_cents: line.amount_cents,
    is_optional: line.is_optional,
    is_commissionable: line.is_commissionable,
    is_penalizable: line.is_penalizable,
  };
}

function toPolicyInput(
  policy: UnitPetPolicyEntity | null,
): UnitDogPolicyInput | null {
  if (!policy) {
    return null;
  }
  return {
    id: policy.id,
    room_id: policy.room_id,
    species_id: policy.species_id,
    max_size_id: policy.max_size_id,
    ppp_allowed:
      policy.ppp_allowed === null ? null : Boolean(policy.ppp_allowed),
    supplement_mode: policy.supplement_mode,
    supplement_amount: policy.supplement_amount,
    left_alone: policy.left_alone,
    left_alone_conditions: policy.left_alone_conditions,
    full_unit_access:
      policy.full_unit_access === null
        ? null
        : Boolean(policy.full_unit_access),
    deposit_required:
      policy.deposit_required === null
        ? null
        : Boolean(policy.deposit_required),
    deposit_amount: policy.deposit_amount,
    deposit_return: policy.deposit_return,
    deposit_return_days: policy.deposit_return_days,
    common_zones_answered: policy.common_zones_answered,
    dining_zones_answered: policy.dining_zones_answered,
    notes: policy.notes,
    zones: policy.zones.map(zone => ({
      zone_id: zone.zone_id,
      slug: zone.zone.slug,
      name: zone.zone.name,
      allows_dining: Boolean(zone.allows_dining),
      other_text: zone.other_text,
    })),
  };
}

export interface BuildPricedQuoteInput {
  /** Errors already found (dates, availability, board, host...). */
  errors: string[];
  nights: number;
  nightlyRate: number;
  minNights: number | null;
  maxNights: number | null;
  guests: number;
  resolvedBoard: ResolvedBoardOption | null;
  activeExtras: RoomExtraEntity[];
  pricing: QuotePricingInput;
}

/**
 * Pure: quote result (public fields + internal checkout payload) from the
 * F2 pricing assembly. Used by quoteReservation() and by tests.
 */
export function buildPricedQuote(
  input: BuildPricedQuoteInput,
): QuoteReservationResult {
  const errors = [...input.errors];
  const outcome = assembleQuotePricing(input.pricing);
  for (const violation of outcome.compatibility.violations) {
    errors.push(violation.message);
  }
  for (const issue of outcome.selectionIssues) {
    errors.push(issue.message);
  }

  const { lines, totals } = outcome.pricing;
  const sumOf = (type: string) =>
    lines
      .filter(line => line.type === type)
      .reduce((sum, line) => sum + line.amount_cents, 0);
  const accommodationCents = sumOf("accommodation");
  const boardCents = sumOf("board");
  const totalDecimal = centsToDecimal(totals.total_cents);
  const board = input.resolvedBoard;
  const snapshotBoard: SnapshotBoard | null =
    board === null
      ? null
      : {
          id: board.id,
          code: board.code,
          name: board.name,
          is_included: board.is_included,
          price_cents: toCents(board.price),
          amount_cents: boardCents,
        };

  return {
    valid: errors.length === 0,
    nights: input.nights,
    nightly_rate: input.nightlyRate,
    base_subtotal: centsToDecimal(accommodationCents),
    board_amount: centsToDecimal(boardCents),
    // Legacy decimals: subtotal == total (all lines); `commission` is the
    // legacy traveler surcharge (always 0), NOT the V4P commission.
    subtotal: totalDecimal,
    commission: 0,
    total: totalDecimal,
    min_nights: input.minNights,
    max_nights: input.maxNights,
    board_option: board,
    extras: input.activeExtras,
    errors,
    currency: envs.CURRENCY.toLowerCase(),
    pets: outcome.compatibility.dog_count,
    price_lines: lines.map(line => toPublicLine(line)),
    totals: {
      total_cents: totals.total_cents,
      mandatory_cents: totals.total_cents - totals.optional_cents,
      optional_cents: totals.optional_cents,
      penalizable_cents: totals.penalizable_cents,
    },
    compatibility: outcome.compatibility,
    dog_policy: toPublicDogPolicy(
      outcome.dogPolicy,
      outcome.compatibility,
      input.nights,
      input.guests,
    ),
    deposit: outcome.deposit,
    available_services: outcome.availableServices,
    available_extras: outcome.availableExtras,
    selection_issues: outcome.selectionIssues,
    tourist_tax: null,
    internal: {
      lines,
      totals,
      pets: outcome.compatibility.dog_count,
      board: snapshotBoard,
      snapshotExtension: outcome.snapshotExtension,
    },
  };
}

/** Runs inside the insert transaction, right after the reservation row exists. */
type AfterInsertHook = (
  manager: EntityManager,
  reservation: ReservationEntity,
) => Promise<void>;

interface NewReservationEconomicsDraft {
  terms: FrozenTerms;
  lines: PriceLineDraft[];
  room: SnapshotRoom | null;
  board: SnapshotBoard | null;
  actor: Actor;
  reason: string;
  nights: number;
  snapshotExtension?: SnapshotF2Extension | null;
}

interface InventoryHoldTarget {
  site_id: number;
  room_id: number;
  checkin: string;
  checkout: string;
  /** Reservation being (re)activated; excluded from the overlap check. */
  exclude_reservation_id?: number;
}

/** F-PV7b: quote a change of an existing reservation (no pricing change). */
export interface QuoteReservationOptions {
  /**
   * Reservation being changed: its own nights (same site + room) and its own
   * row do not count as unavailable / overlapping.
   */
  excludeReservation?: Pick<
    ReservationEntity,
    "id" | "site_id" | "room_id" | "checkin" | "checkout"
  >;
  /** Skip the host Stripe Connect read (the stay is already paid). */
  skipHostPaymentCheck?: boolean;
}

/** F-PV7b: where an accepted change moves the reservation. */
export interface ChangeNightsTarget {
  site_id: number;
  room_id: number;
  checkin: string;
  checkout: string;
}

export interface ExpirePendingOptions {
  /**
   * Stripe session that triggered the expiry: skip if the reservation is now
   * attached to a different (newer) Checkout Session.
   */
  onlyIfSessionId?: string;
}

/** Cron grace so a late checkout.session.completed is not raced by expiry. */
export const PENDING_EXPIRY_GRACE_MS = 2 * 60 * 1000;

/** Max span accepted by the public calendar endpoint. */
const PUBLIC_CALENDAR_MAX_DAYS = 400;

const UNAVAILABLE_MESSAGE = "Las fechas seleccionadas ya no están disponibles.";

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
        // Circular StripeModule <-> ReservationModule (pre-existing pattern).
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-return, node/no-missing-require
        () => require("../../stripe/services/stripe.service").StripeService,
      ),
    )
    private readonly stripeService: StripeService,
    private readonly reservationEventService: ReservationEventService,
    private readonly economics: ReservationEconomicsService,
    private readonly quoteContext: ReservationQuoteContextService,
    private readonly travelerDogs: TravelerDogsService,
    // Punto 9 (optional so unit fixtures built without it keep working).
    @Optional()
    private readonly hostPayoutBlock?: HostPayoutBlockService,
  ) {}

  async quoteReservation(
    dto: QuoteReservationDto,
    options: QuoteReservationOptions = {},
  ): Promise<QuoteReservationResult> {
    const errors: string[] = [];
    const excluded = options.excludeReservation;
    const ownNights =
      excluded &&
      excluded.site_id === dto.site_id &&
      excluded.room_id === dto.room_id
        ? new Set(
            getNightDatesUtc(
              String(excluded.checkin).slice(0, 10),
              String(excluded.checkout).slice(0, 10),
            ),
          )
        : new Set<string>();
    const nights = calcNightsUtc(dto.checkin, dto.checkout);

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

    // F2: the dog count (and size/PPP) is validated by the compatibility
    // engine below (site_settings.max_pets, rooms.max_pets fallback).

    const nightlyRate = Number(room.price_per_night);
    if (!Number.isFinite(nightlyRate) || nightlyRate <= 0) {
      errors.push("La habitación no tiene un precio válido configurado.");
    }

    const nightDates = getNightDatesUtc(dto.checkin, dto.checkout);
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
      return row !== undefined && !row.is_available && !ownNights.has(date);
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
      undefined,
      excluded?.id,
    );
    if (overlappingReservation) {
      errors.push(
        `Ya existe una reserva activa del ${overlappingReservation.checkin} al ${overlappingReservation.checkout}.`,
      );
    }

    const hostUserId = site.user_id ?? 0;
    if (options.skipHostPaymentCheck) {
      // F-PV7b: change of a paid stay; V4P vets the host of an alternative.
    } else if (hostUserId) {
      try {
        const connectStatus =
          await this.stripeService.getConnectStatus(hostUserId);
        if (!connectStatus.can_use_reservations) {
          errors.push(
            "El anfitrión aún no puede recibir pagos. Inténtalo más tarde.",
          );
        } else if (this.hostPayoutBlock) {
          const block =
            await this.hostPayoutBlock.getHostPayoutBlock(hostUserId);
          if (block.blocked) {
            errors.push(
              "El alojamiento no admite nuevas reservas temporalmente.",
            );
          }
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

    const [activeExtras, dogContext] = await Promise.all([
      this.roomExtrasService.findActiveExtrasByRoom(dto.room_id),
      this.quoteContext.load(dto.site_id, dto.room_id),
    ]);

    const resolvedBoard =
      boardOption === null
        ? null
        : this.roomBoardOptionsService.toResolvedBoardOption(boardOption);
    const roomExtras: PricedExtraOption[] = activeExtras.map(extra => ({
      id: extra.id,
      name: extra.name,
      description: extra.description ?? null,
      price_cents: toCents(extra.price),
      pricing_mode: extra.pricing_mode,
    }));

    // F2: ONE pure function prices the quote AND the checkout.
    return buildPricedQuote({
      errors,
      nights,
      nightlyRate: rate,
      minNights,
      maxNights,
      guests: dto.guests,
      resolvedBoard,
      activeExtras,
      pricing: {
        roomId: room.id,
        roomName: room.name,
        roomMaxPets: room.max_pets,
        nightlyRateCents: toCents(rate),
        nights,
        guests: dto.guests,
        board:
          resolvedBoard === null
            ? null
            : {
                id: resolvedBoard.id,
                code: resolvedBoard.code,
                name: resolvedBoard.name,
                is_included: resolvedBoard.is_included,
                price_cents: toCents(resolvedBoard.price),
              },
        dogs: dto.dogs ?? null,
        legacyPets: dto.pets ?? 0,
        serviceSelections: dto.services ?? [],
        extraSelections: dto.extras ?? [],
        sizes: dogContext.sizes,
        policy: toPolicyInput(dogContext.policy),
        siteSettings: dogContext.siteSettings,
        dogServices: dogContext.dogServices,
        additionalServices: dogContext.additionalServices,
        roomExtras,
      },
    });
  }

  async checkout(dto: CheckoutReservationDto) {
    const quote = await this.quoteReservation(dto);
    if (!quote.valid) {
      throw this.invalidQuoteException(quote);
    }
    if (!quote.internal) {
      throw new InternalServerErrorException("Quote without pricing data");
    }

    const travelerUserId = this.resolveTravelerUserId(dto.traveler_token);

    // Frozen terms + room data + saved-dog links are read before the insert.
    const [terms, room, snapshotExtension] = await Promise.all([
      this.economics.resolveFrozenTerms(),
      this.loadSnapshotRoom(dto.room_id),
      this.linkSavedDogsToSnapshot(dto, quote.internal, travelerUserId),
    ]);
    const reservation = await this.createPendingFromCheckout(
      dto,
      quote,
      { ...quote.internal, snapshotExtension },
      terms,
      room,
      travelerUserId,
    );

    let stripeResult: Awaited<
      ReturnType<StripeService["createSitePaymentLink"]>
    >;
    try {
      stripeResult = await this.stripeService.createSitePaymentLink({
        reservation_id: reservation.id,
        email: dto.guest_email,
      });
    } catch (error) {
      // No session => nobody can pay. Cancel without freeing nights that were never held.
      await this.expirePendingReservation(
        reservation.id,
        "checkout_session_failed",
      );
      throw error;
    }

    return {
      reservation_id: reservation.id,
      checkout_url: stripeResult.url,
      expires_at: stripeResult.expires_at,
    };
  }

  /**
   * B3/C2: dog incompatibilities alone -> 422 with every violation (codes +
   * Spanish messages, no host contact data). Anything else -> 400 (legacy
   * contract), still carrying the violations for the UI.
   */
  private invalidQuoteException(quote: QuoteReservationResult) {
    const violations = quote.compatibility?.violations ?? [];
    const issues = quote.selection_issues ?? [];
    const dogMessages = new Set(violations.map(violation => violation.message));
    const onlyDogProblems =
      violations.length > 0 &&
      quote.errors.every(message => dogMessages.has(message));
    const body = {
      message: onlyDogProblems
        ? "Tu perro o perros no son compatibles con esta opción."
        : "La reserva no es válida.",
      code: onlyDogProblems ? "dogs_incompatible" : "invalid_reservation",
      errors: quote.errors,
      violations,
      selection_issues: issues,
    };
    return onlyDogProblems
      ? new UnprocessableEntityException(body)
      : new BadRequestException(body);
  }

  /**
   * Spec 2.2/2.3: snapshot dogs keep `saved_dog_id` only when it is an active
   * dog of the authenticated traveler. Guests, foreign/deleted/duplicate ids
   * or a failed lookup just drop the link: it never blocks the booking and
   * never touches pricing.
   */
  private async linkSavedDogsToSnapshot(
    dto: CheckoutReservationDto,
    internal: QuoteInternal,
    travelerUserId: number,
  ): Promise<SnapshotF2Extension> {
    const requested = requestedSavedDogIds(dto.dogs);
    let owned = new Set<number>();
    if (requested.length > 0 && travelerUserId > 0) {
      try {
        owned = await this.travelerDogs.findActiveOwnedIds(
          travelerUserId,
          requested,
        );
      } catch (error) {
        this.logger.warn(
          `saved_dog_id lookup failed; booking without dog links: ${String(error)}`,
        );
      }
    }
    const { dogs, dropped } = linkSavedDogs(
      internal.snapshotExtension.dogs,
      dto.dogs,
      owned,
    );
    if (dropped.length > 0) {
      this.logger.debug(
        `saved_dog_id dropped (${travelerUserId > 0 ? "not owned/deleted/duplicate" : "guest"}): ${dropped.join(",")}`,
      );
    }
    return { ...internal.snapshotExtension, dogs };
  }

  /** F2 security fix: traveler id only from a PHP-signed token, never raw. */
  private resolveTravelerUserId(token: string | undefined): number {
    const result = verifyTravelerToken(token, envs.INTERNAL_API_KEY);
    if (result.status === TRAVELER_TOKEN_STATUS.VALID) {
      return result.userId ?? 0;
    }
    if (result.status !== TRAVELER_TOKEN_STATUS.MISSING) {
      this.logger.warn(
        `Checkout traveler_token rejected (${result.status}); booking as guest`,
      );
    }
    return 0;
  }

  /** Immutable price lines (Stripe line_items / emails). */
  getPriceLines(reservationId: number) {
    return this.economics.findPriceLines(reservationId);
  }

  /**
   * Success page summary. Requires the Checkout Session id Stripe appended to
   * success_url: reservation ids are sequential, so the id alone must not
   * expose anything (F0).
   */
  async getPublicSummary(
    id: number,
    sessionId: string | undefined,
  ): Promise<ReservationPublicSummaryDto> {
    const reservation = await this.findById(id);
    const expectedSession = reservation?.stripe_checkout_session_id ?? "";
    if (
      !reservation ||
      !sessionId ||
      expectedSession === "" ||
      expectedSession !== sessionId
    ) {
      throw new NotFoundException(`Reservation with id ${id} not found`);
    }

    return {
      id: reservation.id,
      code: `#RES-${reservation.id}`,
      status: reservation.status,
      payment_status: reservation.payment_status,
      checkin: reservation.checkin,
      checkout: reservation.checkout,
      total: this.toNullableNumber(reservation.total),
    };
  }

  /** Public date-picker data for one room: occupancy only, no guest data. */
  async getPublicRoomCalendar(
    roomId: number,
    fromIso: string,
    toIso: string,
  ): Promise<PublicRoomCalendarDto> {
    const span = calcNightsUtc(fromIso, toIso);
    if (span < 0 || span > PUBLIC_CALENDAR_MAX_DAYS) {
      throw new BadRequestException(
        `El rango debe estar entre 0 y ${PUBLIC_CALENDAR_MAX_DAYS} días.`,
      );
    }

    const room = await this.roomsService.findOne(roomId);
    if (!room.is_active) {
      throw new NotFoundException(`room with id ${roomId} not found`);
    }

    const [availability, blocks] = await Promise.all([
      this.availabilityService.findByRoomAndIsoRange(roomId, fromIso, toIso),
      this.blocksService.find_by_room_and_range(roomId, fromIso, toIso),
    ]);

    const now = new Date();
    const reservations = await this.reservationRepository
      .createQueryBuilder("r")
      .select([
        "r.id",
        "r.checkin",
        "r.checkout",
        "r.status",
        "r.payment_status",
        "r.expiration_date",
      ])
      .where("r.room_id = :roomId", { roomId })
      .andWhere("r.checkin <= :toIso", { toIso })
      .andWhere("r.checkout > :fromIso", { fromIso })
      .andWhere("r.status != :cancelled", {
        cancelled: "cancelled" satisfies StatusValue,
      })
      .getMany();

    return {
      room_id: roomId,
      availability: availability.map(row => ({
        date: this.formatIsoDate(row.date),
        is_available: Boolean(row.is_available),
        min_nights: row.min_nights,
        max_nights: row.max_nights,
      })),
      blocks: blocks.map(block => ({
        start_date: String(block.start_date).slice(0, 10),
        end_date: String(block.end_date).slice(0, 10),
        type: block.type,
      })),
      reservations: reservations
        .filter(row => isReservationBlockingInventory(row, now))
        .map(row => ({
          checkin: String(row.checkin).slice(0, 10),
          checkout: String(row.checkout).slice(0, 10),
        })),
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

  /** Internal (X-Internal-Key) manual reservation; same locked path as checkout. */
  async create(createReservationDto: CreateReservationDto) {
    await this.roomsService.findOneForSite(
      createReservationDto.room_id,
      createReservationDto.site_id,
    );

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

    await this.getSiteById(createReservationDto.site_id);

    const [terms, room] = await Promise.all([
      this.economics.resolveFrozenTerms(),
      this.loadSnapshotRoom(createReservationDto.room_id),
    ]);
    // Legacy contract: charged amount = subtotal + commission (surcharge).
    const lines = buildCheckoutPriceLines({
      nights: 0,
      nightly_rate: 0,
      base_subtotal: createReservationDto.subtotal,
      board_amount: 0,
      total:
        Number(createReservationDto.subtotal) +
        Number(createReservationDto.commission),
      room_name: room?.name ?? null,
    });
    const frozen = freezeReservationFields(terms, summarizePriceLines(lines));

    return this.holdInventoryAndInsert(
      createReservationDto,
      {
        ...createReservationDto,
        ...frozen,
        status: "pending" as StatusValue,
        payment_status: "pending" as PaymentStatusValue,
        charge_mode: "immediate",
        expiration_date: new Date(
          Date.now() +
            resolvePendingTtlMs(envs.PENDING_RESERVATION_EXPIRATION_TIME),
        ),
      },
      this.economicsHook({
        terms,
        lines,
        room,
        board: null,
        actor: actors.system("internal_api"),
        reason: SNAPSHOT_REASON.MANUAL_CREATE,
        nights: calcNightsUtc(
          createReservationDto.checkin,
          createReservationDto.checkout,
        ),
      }),
    );
  }

  /** Room data frozen in the snapshot (null if it cannot be read). */
  async loadSnapshotRoom(roomId: number): Promise<SnapshotRoom | null> {
    try {
      const room = await this.roomsService.findOne(roomId);
      return {
        id: room.id,
        name: room.name,
        max_guests: room.max_guests,
        max_pets: room.max_pets,
        price_per_night_cents: toCents(room.price_per_night),
      };
    } catch {
      return null;
    }
  }

  /**
   * Price lines + payment row + snapshot v1 written in the SAME transaction
   * as the reservation insert (F1): a reservation never exists without its
   * economic record.
   */
  private economicsHook(draft: NewReservationEconomicsDraft): AfterInsertHook {
    return async (manager, reservation) => {
      await this.economics.recordNewReservation(manager, reservation, {
        ...draft,
        snapshotExtension: draft.snapshotExtension ?? null,
        paymentIdempotencyKey:
          draft.reason === SNAPSHOT_REASON.MANUAL_CREATE
            ? paymentKeys.manual(reservation.id)
            : paymentKeys.checkout(reservation.id),
      });
    };
  }

  private async createPendingFromCheckout(
    dto: CheckoutReservationDto,
    quote: QuoteReservationResult,
    internal: QuoteInternal,
    terms: FrozenTerms,
    room: SnapshotRoom | null,
    travelerUserId: number,
  ) {
    const expirationDate = new Date(
      Date.now() +
        resolvePendingTtlMs(envs.PENDING_RESERVATION_EXPIRATION_TIME),
    );

    // F2: the very lines the traveler saw in the quote (same pure function).
    const lines = internal.lines;
    const totals = summarizePriceLines(lines);
    // commission_cents = round_half_up(rate x commissionable base) (A2/A3).
    const frozen = freezeReservationFields(terms, totals);
    const board = internal.board;
    const totalDecimal = centsToDecimal(totals.total_cents);

    return this.insertWithoutInventoryHold(
      dto,
      {
        site_id: dto.site_id,
        room_id: dto.room_id,
        charge_mode: "immediate",
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
        // Legacy JSON read by PHP: selected paid services/extras (F2).
        extras_snapshot: {
          services: internal.snapshotExtension.services,
          extras: internal.snapshotExtension.extras,
        },
        source: "internal",
        user_id: travelerUserId,
        checkin: dto.checkin,
        checkout: dto.checkout,
        guests: dto.guests,
        pets: internal.pets,
        // Legacy decimals mirror the lines: subtotal == total, surcharge 0.
        subtotal: totalDecimal,
        commission: 0,
        total: totalDecimal,
        guest_name: dto.guest_name,
        guest_email: dto.guest_email,
        guest_phone: dto.guest_phone,
        guest_notes: dto.guest_notes,
        status: "pending",
        payment_status: "pending",
        expiration_date: expirationDate,
        ...frozen,
      },
      this.economicsHook({
        terms,
        lines,
        room,
        board,
        actor: actors.traveler(travelerUserId > 0 ? travelerUserId : null),
        reason: SNAPSHOT_REASON.CHECKOUT,
        nights: quote.nights,
        snapshotExtension: internal.snapshotExtension,
      }),
    );
  }

  /**
   * Anti-overbooking (F0): lock the room's availability rows for every night
   * (SELECT ... FOR UPDATE on the unique (site_id, room_id, date) index),
   * re-check them + overlapping reservations AFTER the lock, insert the
   * reservation and flip the nights, all in ONE transaction. A concurrent
   * checkout for the same nights blocks on the lock and then sees
   * is_available = false -> 409.
   */
  private async holdInventoryAndInsert(
    target: InventoryHoldTarget,
    payload: Partial<ReservationEntity>,
    afterInsert?: AfterInsertHook,
  ): Promise<ReservationEntity> {
    return this.reservationRepository.manager.transaction(async manager => {
      const nights = await this.lockFreeNightsOrFail(manager, target);
      const repository = manager.getRepository(ReservationEntity);
      const reservation = repository.create(payload);
      await repository.save(reservation);
      await this.setNightsAvailability(manager, nights, false);
      if (afterInsert) {
        await afterInsert(manager, reservation);
      }
      return reservation;
    });
  }

  /**
   * B7 immediate checkout: economics + reservation row without blocking nights.
   * A best-effort availability read still rejects obviously full dates.
   */
  private async insertWithoutInventoryHold(
    target: InventoryHoldTarget,
    payload: Partial<ReservationEntity>,
    afterInsert?: AfterInsertHook,
  ): Promise<ReservationEntity> {
    return this.reservationRepository.manager.transaction(async manager => {
      await this.verifyNightsAvailableOrFail(manager, target);
      const repository = manager.getRepository(ReservationEntity);
      const reservation = repository.create(payload);
      await repository.save(reservation);
      if (afterInsert) {
        await afterInsert(manager, reservation);
      }
      return reservation;
    });
  }

  private async verifyNightsAvailableOrFail(
    manager: EntityManager,
    target: InventoryHoldTarget,
  ): Promise<void> {
    const nightDates = getNightDatesUtc(target.checkin, target.checkout);
    const firstNight = nightDates.at(0);
    const lastNight = nightDates.at(-1);
    if (firstNight === undefined || lastNight === undefined) {
      throw new BadRequestException(
        "La fecha de salida debe ser posterior al check-in.",
      );
    }

    const rows = await manager
      .getRepository(AvailabilityEntity)
      .createQueryBuilder("a")
      .where("a.site_id = :siteId", { siteId: target.site_id })
      .andWhere("a.room_id = :roomId", { roomId: target.room_id })
      .andWhere("a.date >= :firstNight", { firstNight })
      .andWhere("a.date <= :lastNight", { lastNight })
      .orderBy("a.date", "ASC")
      .getMany();

    const byDate = new Map(
      rows.map(row => [this.formatIsoDate(row.date), row]),
    );
    for (const date of nightDates) {
      const row = byDate.get(date);
      if (!row?.is_available) {
        throw new ConflictException(UNAVAILABLE_MESSAGE);
      }
    }

    const overlapping = await this.findOverlappingReservation(
      target.site_id,
      target.room_id,
      target.checkin,
      target.checkout,
      manager,
      target.exclude_reservation_id,
    );
    if (overlapping) {
      throw new ConflictException(UNAVAILABLE_MESSAGE);
    }
  }

  /**
   * Locks availability rows for [checkin, checkout) and verifies they are all
   * present, owned by the site, available and not overlapped by another
   * blocking reservation. Throws ConflictException otherwise.
   */
  async lockFreeNightsOrFail(
    manager: EntityManager,
    target: InventoryHoldTarget,
    options?: { allowSelfHold?: boolean },
  ): Promise<AvailabilityEntity[]> {
    const nightDates = getNightDatesUtc(target.checkin, target.checkout);
    const firstNight = nightDates.at(0);
    const lastNight = nightDates.at(-1);
    if (firstNight === undefined || lastNight === undefined) {
      throw new BadRequestException(
        "La fecha de salida debe ser posterior al check-in.",
      );
    }

    const rows = await manager
      .getRepository(AvailabilityEntity)
      .createQueryBuilder("a")
      .setLock("pessimistic_write")
      .where("a.site_id = :siteId", { siteId: target.site_id })
      .andWhere("a.room_id = :roomId", { roomId: target.room_id })
      .andWhere("a.date >= :firstNight", { firstNight })
      .andWhere("a.date <= :lastNight", { lastNight })
      .orderBy("a.date", "ASC")
      .getMany();

    const byDate = new Map(
      rows.map(row => [this.formatIsoDate(row.date), row]),
    );
    const nights: AvailabilityEntity[] = [];
    for (const date of nightDates) {
      const row = byDate.get(date);
      const heldByThisReservation =
        options?.allowSelfHold === true &&
        row !== undefined &&
        !row.is_available;
      if (!row || (!row.is_available && !heldByThisReservation)) {
        throw new ConflictException(UNAVAILABLE_MESSAGE);
      }
      nights.push(row);
    }

    const overlapping = await this.findOverlappingReservation(
      target.site_id,
      target.room_id,
      target.checkin,
      target.checkout,
      manager,
      target.exclude_reservation_id,
    );
    if (overlapping) {
      throw new ConflictException(UNAVAILABLE_MESSAGE);
    }

    return nights;
  }

  /**
   * F-PV7b: moves the nights an accepted change needs, inside the caller's
   * transaction (reservation row already locked FOR UPDATE, same order as
   * activateFromPayment: reservation, then nights). Locks the availability
   * rows of the current and the target stay, then re-checks AFTER the lock:
   * host blocks, missing rows, nights taken by someone else and overlapping
   * blocking reservations (this one excluded). Nights already held by this
   * reservation (same site + room) stay held; new nights are blocked like
   * activateFromPayment does; nights the stay no longer uses are released
   * unless another blocking reservation covers them. ConflictException when
   * the target is no longer free (nothing written).
   */
  async moveNightsForChange(
    manager: EntityManager,
    reservation: ReservationEntity,
    target: ChangeNightsTarget,
  ): Promise<void> {
    const currentCheckin = String(reservation.checkin).slice(0, 10);
    const currentCheckout = String(reservation.checkout).slice(0, 10);
    const targetCheckin = target.checkin.slice(0, 10);
    const targetCheckout = target.checkout.slice(0, 10);
    const targetNights = getNightDatesUtc(targetCheckin, targetCheckout);
    const firstNight = targetNights.at(0);
    const lastNight = targetNights.at(-1);
    if (firstNight === undefined || lastNight === undefined) {
      throw new BadRequestException(
        "La fecha de salida debe ser posterior al check-in.",
      );
    }
    const sameUnit =
      reservation.site_id === target.site_id &&
      reservation.room_id === target.room_id;
    const currentNights = getNightDatesUtc(currentCheckin, currentCheckout);
    const ownNights = new Set(sameUnit ? currentNights : []);

    const blocking = await this.blocksService.find_blocking_overlap(
      target.site_id,
      target.room_id,
      targetCheckin,
      targetCheckout,
    );
    if (blocking) {
      throw new ConflictException(UNAVAILABLE_MESSAGE);
    }

    const lockRange = async (
      siteId: number,
      roomId: number,
      from: string,
      to: string,
    ): Promise<AvailabilityEntity[]> =>
      manager
        .getRepository(AvailabilityEntity)
        .createQueryBuilder("a")
        .setLock("pessimistic_write")
        .where("a.site_id = :siteId", { siteId })
        .andWhere("a.room_id = :roomId", { roomId })
        .andWhere("a.date >= :firstNight", { firstNight: from })
        .andWhere("a.date <= :lastNight", { lastNight: to })
        .orderBy("a.date", "ASC")
        .getMany();

    const currentFirst = currentNights.at(0);
    const currentLast = currentNights.at(-1);
    let targetRows: AvailabilityEntity[];
    let currentRows: AvailabilityEntity[] = [];
    if (sameUnit && currentFirst !== undefined && currentLast !== undefined) {
      // One locked range covering both stays of the same unit.
      const rows = await lockRange(
        target.site_id,
        target.room_id,
        // ISO dates (strings): lexicographic min/max, not Math.min/max.
        // eslint-disable-next-line unicorn/prefer-math-min-max
        currentFirst < firstNight ? currentFirst : firstNight,
        // eslint-disable-next-line unicorn/prefer-math-min-max
        currentLast > lastNight ? currentLast : lastNight,
      );
      targetRows = rows;
      currentRows = rows;
    } else {
      if (currentFirst !== undefined && currentLast !== undefined) {
        currentRows = await lockRange(
          reservation.site_id,
          reservation.room_id,
          currentFirst,
          currentLast,
        );
      }
      targetRows = await lockRange(
        target.site_id,
        target.room_id,
        firstNight,
        lastNight,
      );
    }

    const targetByDate = new Map(
      targetRows.map(row => [this.formatIsoDate(row.date), row]),
    );
    const toBlock: AvailabilityEntity[] = [];
    for (const date of targetNights) {
      const row = targetByDate.get(date);
      if (!row) {
        throw new ConflictException(UNAVAILABLE_MESSAGE);
      }
      if (ownNights.has(date)) {
        continue;
      }
      if (!row.is_available) {
        throw new ConflictException(UNAVAILABLE_MESSAGE);
      }
      toBlock.push(row);
    }

    const overlapping = await this.findOverlappingReservation(
      target.site_id,
      target.room_id,
      targetCheckin,
      targetCheckout,
      manager,
      reservation.id,
    );
    if (overlapping) {
      throw new ConflictException(UNAVAILABLE_MESSAGE);
    }

    // Nights of the current stay the target does not use any more.
    const targetSet = new Set(sameUnit ? targetNights : []);
    const freed = currentNights.filter(date => !targetSet.has(date));
    const toRelease: AvailabilityEntity[] = [];
    if (freed.length > 0) {
      const others = await this.findBlockingReservations(
        reservation.site_id,
        reservation.room_id,
        currentCheckin,
        currentCheckout,
        manager,
        reservation.id,
      );
      const heldByOther = new Set<string>();
      for (const other of others) {
        for (const date of getNightDatesUtc(
          String(other.checkin).slice(0, 10),
          String(other.checkout).slice(0, 10),
        )) {
          heldByOther.add(date);
        }
      }
      const currentByDate = new Map(
        currentRows.map(row => [this.formatIsoDate(row.date), row]),
      );
      for (const date of freed) {
        const row = currentByDate.get(date);
        if (row && !row.is_available && !heldByOther.has(date)) {
          toRelease.push(row);
        }
      }
    }

    await this.setNightsAvailability(manager, toBlock, false);
    await this.setNightsAvailability(manager, toRelease, true);
  }

  private async setNightsAvailability(
    manager: EntityManager,
    nights: AvailabilityEntity[],
    isAvailable: boolean,
  ): Promise<void> {
    if (nights.length === 0) {
      return;
    }
    await manager
      .getRepository(AvailabilityEntity)
      .update(
        { id: In(nights.map(night => night.id)) },
        { is_available: isAvailable },
      );
  }

  async findById(id: number) {
    return this.reservationRepository.findOne({
      where: { id },
    });
  }

  /**
   * Host listing. Pure read: expiring pending holds is the cron's job
   * (processPendingReservations), never a side effect of a GET (F0).
   */
  async find_active_by_site_and_range(
    site_id: number,
    from_iso: string,
    to_iso: string,
  ): Promise<ReservationWithRoomName[]> {
    const now = new Date();
    const rows = await this.reservationRepository
      .createQueryBuilder("r")
      .where("r.site_id = :site_id", { site_id })
      .andWhere("r.checkin <= :to_iso", { to_iso })
      .andWhere("r.checkout > :from_iso", { from_iso })
      .andWhere(
        `(
          r.payment_status = :paid
          OR r.status IN (:...blockingStatuses)
        )`,
        {
          paid: "paid" satisfies PaymentStatusValue,
          blockingStatuses: ["confirmed", "finalized"] satisfies StatusValue[],
        },
      )
      .andWhere("r.status != :cancelled", {
        cancelled: "cancelled" satisfies StatusValue,
      })
      .orderBy("r.checkin", "ASC")
      .addOrderBy("r.id", "ASC")
      .getMany();

    const activeRows = rows.filter(row =>
      isReservationBlockingInventory(row, now),
    );
    const roomIds = [...new Set(activeRows.map(row => row.room_id))];
    const roomNames = new Map<string, string>();
    for (const roomId of roomIds) {
      try {
        const room = await this.roomsService.findOne(roomId);
        roomNames.set(String(roomId), room.name);
      } catch {
        roomNames.set(String(roomId), "");
      }
    }

    return activeRows.map(row => {
      const subtotal = row.subtotal;
      const nights = Math.max(0, calcNightsUtc(row.checkin, row.checkout));
      const boardAmount = row.board_snapshot?.board_amount ?? 0;
      const base_subtotal = subtotal ? Math.max(0, subtotal - boardAmount) : 0;

      const policy = computeReservationPolicyCapabilities(row);

      return {
        ...row,
        subtotal,
        commission: row.commission,
        total: row.total,
        room_name: roomNames.get(String(row.room_id)) ?? null,
        nights,
        base_subtotal,
        can_cancel: policy.can_cancel,
        can_refund: policy.can_refund,
        can_finalize: policy.can_finalize,
        can_report_no_show: policy.can_report_no_show,
        refund_deadline: policy.refund_deadline,
      };
    });
  }

  private async findOverlappingReservation(
    site_id: number,
    room_id: number,
    checkin: string,
    checkout: string,
    manager?: EntityManager,
    excludeReservationId?: number,
  ) {
    const rows = await this.findBlockingReservations(
      site_id,
      room_id,
      checkin,
      checkout,
      manager,
      excludeReservationId,
    );
    return rows.at(0) ?? null;
  }

  private async findBlockingReservations(
    site_id: number,
    room_id: number,
    checkin: string,
    checkout: string,
    manager?: EntityManager,
    excludeReservationId?: number,
  ): Promise<ReservationEntity[]> {
    const now = new Date();
    const repository = manager
      ? manager.getRepository(ReservationEntity)
      : this.reservationRepository;
    const query = repository
      .createQueryBuilder("r")
      .where("r.site_id = :site_id", { site_id })
      .andWhere("r.room_id = :room_id", { room_id })
      .andWhere("r.checkin < :checkout", { checkout })
      .andWhere("r.checkout > :checkin", { checkin })
      .andWhere(
        `(
          r.payment_status = :paid
          OR r.status IN (:...blockingStatuses)
        )`,
        {
          paid: "paid" satisfies PaymentStatusValue,
          blockingStatuses: ["confirmed", "finalized"] satisfies StatusValue[],
        },
      )
      .andWhere("r.status != :cancelled", {
        cancelled: "cancelled" satisfies StatusValue,
      });
    if (excludeReservationId !== undefined) {
      query.andWhere("r.id != :excludeReservationId", { excludeReservationId });
    }
    const rows = await query.getMany();
    return rows.filter(row => isReservationBlockingInventory(row, now));
  }

  async saveStripeCheckoutSessionId(id: number, checkoutSessionId: string) {
    await this.reservationRepository.manager.transaction(async manager => {
      const result = await manager
        .getRepository(ReservationEntity)
        .update(id, { stripe_checkout_session_id: checkoutSessionId });
      if (!result.affected) {
        throw new NotFoundException(`Reservation with id ${id} not found`);
      }
      await this.economics.attachCheckoutSession(
        manager,
        id,
        checkoutSessionId,
        actors.system("checkout"),
      );
    });
  }

  /**
   * pay-pending: swaps the reservation's Checkout Session with a
   * compare-and-set under the row lock. Only a still pending/pending
   * reservation whose current session is `replacedSessionId` (or already
   * `nextSessionId`, idempotent retry) is updated; the payment row records
   * the new session (attempts + 1). Returns false when another request or a
   * webhook changed the reservation first.
   */
  async replaceCheckoutSessionId(
    id: number,
    replacedSessionId: string | null,
    nextSessionId: string,
  ): Promise<boolean> {
    return this.reservationRepository.manager.transaction(async manager => {
      const repository = manager.getRepository(ReservationEntity);
      const reservation = await repository.findOne({
        where: { id },
        lock: { mode: "pessimistic_write" },
      });
      if (
        !reservation ||
        reservation.status !== "pending" ||
        reservation.payment_status !== "pending"
      ) {
        return false;
      }
      const current = reservation.stripe_checkout_session_id ?? null;
      if (current === nextSessionId) {
        return true;
      }
      if (current !== replacedSessionId) {
        return false;
      }
      await repository.update(id, {
        stripe_checkout_session_id: nextSessionId,
      });
      await this.economics.attachCheckoutSession(
        manager,
        id,
        nextSessionId,
        actors.system("traveler_pay_pending"),
      );
      await this.reservationEventService.logEventInTransaction(
        manager,
        id,
        "checkout_session_replaced",
        {
          replaced_checkout_session_id: replacedSessionId,
          checkout_session_id: nextSessionId,
        },
      );
      return true;
    });
  }

  /**
   * pay-pending: immediate checkout holds no nights (B7), so before sending
   * the traveler back to Stripe the dates are re-checked (availability rows,
   * host blocks, other blocking reservations). Throws ConflictException.
   */
  async assertPendingDatesStillFree(
    reservation: ReservationEntity,
  ): Promise<void> {
    const checkin = String(reservation.checkin).slice(0, 10);
    const checkout = String(reservation.checkout).slice(0, 10);
    const blocking = await this.blocksService.find_blocking_overlap(
      reservation.site_id,
      reservation.room_id,
      checkin,
      checkout,
    );
    if (blocking) {
      throw new ConflictException(UNAVAILABLE_MESSAGE);
    }
    await this.reservationRepository.manager.transaction(manager =>
      this.verifyNightsAvailableOrFail(manager, {
        site_id: reservation.site_id,
        room_id: reservation.room_id,
        checkin,
        checkout,
        exclude_reservation_id: reservation.id,
      }),
    );
  }

  /** Keeps reservation.expiration_date == Checkout Session expires_at. */
  async updateExpirationDate(id: number, expirationDate: Date) {
    await this.reservationRepository.update(
      { id, status: "pending", payment_status: "pending" },
      { expiration_date: expirationDate },
    );
  }

  /**
   * Applies a paid Checkout Session to its reservation. MUST run inside the
   * webhook transaction (`manager`); the reservation row is locked FOR UPDATE.
   *
   * - pending                      -> lock nights; confirm and block if free, else refund
   * - cancelled/expired, dates free -> reactivate: re-lock + block nights + confirm
   * - cancelled/expired, dates gone -> full refund (idempotency key) + audit event
   * - amount mismatch / duplicate   -> full refund of THIS payment + audit event
   * Never "just log" a captured payment (F0).
   */
  async activateFromPayment(
    input: ActivateFromPaymentInput,
    manager: EntityManager,
  ): Promise<ActivateFromPaymentResult> {
    const repository = manager.getRepository(ReservationEntity);
    const reservation = await repository.findOne({
      where: { id: input.reservationId },
      lock: { mode: "pessimistic_write" },
    });
    if (!reservation) {
      throw new NotFoundException(
        `Reservation with id ${input.reservationId} not found`,
      );
    }

    const samePaymentIntent =
      !!input.paymentIntentId &&
      reservation.stripe_payment_intent_id === input.paymentIntentId;

    if (samePaymentIntent && reservation.payment_status !== "pending") {
      return {
        reservation,
        outcome: PAYMENT_ACTIVATION_OUTCOME.ALREADY_ACTIVE,
      };
    }

    if (reservation.payment_status !== "pending") {
      return this.refundUnhonoredPayment(
        manager,
        reservation,
        input,
        AUTO_REFUND_REASON.DUPLICATE_PAYMENT,
      );
    }

    // F2: the charged amount is total_cents (= SUM(price lines)); legacy
    // rows without it keep the old subtotal + surcharge rule.
    const expectedAmountCents = expectedChargeCents(reservation);
    if (input.amountPaidCents !== expectedAmountCents) {
      this.logger.error(
        `Payment amount mismatch for reservation ${reservation.id}: expected ${expectedAmountCents} cents, got ${input.amountPaidCents}`,
      );
      return this.refundUnhonoredPayment(
        manager,
        reservation,
        input,
        AUTO_REFUND_REASON.AMOUNT_MISMATCH,
      );
    }

    if (reservation.status === "pending") {
      const nights = await this.tryClaimNightsForPayment(manager, reservation);
      if (!nights) {
        return this.refundUnhonoredPayment(
          manager,
          reservation,
          input,
          AUTO_REFUND_REASON.DATES_UNAVAILABLE,
        );
      }
      await this.setNightsAvailability(manager, nights, false);
      const saved = await this.confirmPaid(manager, reservation, input);
      await this.recordActivation(manager, saved, input, "pending", null);
      await this.reservationEventService.logEventInTransaction(
        manager,
        reservation.id,
        "payment_confirmed",
        { checkout_session_id: input.checkoutSessionId },
      );
      return {
        reservation: saved,
        outcome: PAYMENT_ACTIVATION_OUTCOME.ACTIVATED,
      };
    }

    if (reservation.status === "cancelled") {
      const nights = await this.tryLockNightsForReactivation(
        manager,
        reservation,
      );
      if (!nights) {
        return this.refundUnhonoredPayment(
          manager,
          reservation,
          input,
          AUTO_REFUND_REASON.DATES_UNAVAILABLE,
        );
      }

      await this.setNightsAvailability(manager, nights, false);
      const previousCancelReason = reservation.cancel_reason ?? null;
      reservation.cancelled_at = null;
      reservation.cancel_reason = null;
      const saved = await this.confirmPaid(manager, reservation, input);
      await this.recordActivation(
        manager,
        saved,
        input,
        "cancelled",
        previousCancelReason,
      );
      await this.reservationEventService.logEventInTransaction(
        manager,
        reservation.id,
        "reactivated_after_expiry",
        {
          checkout_session_id: input.checkoutSessionId,
          payment_intent_id: input.paymentIntentId,
          previous_cancel_reason: previousCancelReason,
        },
      );
      return {
        reservation: saved,
        outcome: PAYMENT_ACTIVATION_OUTCOME.REACTIVATED,
      };
    }

    return this.refundUnhonoredPayment(
      manager,
      reservation,
      input,
      AUTO_REFUND_REASON.INVALID_STATE,
    );
  }

  private async confirmPaid(
    manager: EntityManager,
    reservation: ReservationEntity,
    input: ActivateFromPaymentInput,
  ): Promise<ReservationEntity> {
    reservation.status = "confirmed";
    reservation.payment_status = "paid";
    await this.economics.transitionPayout(
      manager,
      reservation,
      "held",
      input.actor ?? actors.stripe(),
      // Out-of-order webhook must not fail forever: audit and keep going.
      { onInvalid: "ignore", metadata: { trigger: "payment_confirmed" } },
    );
    reservation.paid_at = new Date();
    reservation.stripe_checkout_session_id = input.checkoutSessionId;
    reservation.stripe_payment_intent_id = input.paymentIntentId ?? undefined;
    reservation.total = input.amountPaidCents / 100;
    reservation.total_cents = input.amountPaidCents;
    return manager.getRepository(ReservationEntity).save(reservation);
  }

  /** Payment row -> paid (state machine) + reservation audit (F1). */
  private async recordActivation(
    manager: EntityManager,
    reservation: ReservationEntity,
    input: ActivateFromPaymentInput,
    previousStatus: StatusValue,
    previousCancelReason: string | null,
  ): Promise<void> {
    const actor = input.actor ?? actors.stripe();
    if (input.paymentIntentId) {
      await this.economics.recordPaymentSucceeded(
        manager,
        reservation,
        input.checkoutSessionId,
        input.paymentIntentId,
        input.amountPaidCents,
        actor,
      );
    }
    await this.economics.auditReservationChange(
      manager,
      reservation.id,
      "reservation.status_changed",
      actor,
      {
        status: previousStatus,
        payment_status: "pending",
        cancel_reason: previousCancelReason,
      },
      {
        status: reservation.status,
        payment_status: reservation.payment_status,
        payout_status: reservation.payout_status ?? null,
      },
      {
        trigger: "payment_confirmed",
        checkout_session_id: input.checkoutSessionId,
        payment_intent_id: input.paymentIntentId,
      },
    );
  }

  /**
   * SELECT ... FOR UPDATE of the stay nights. Free nights are claimed.
   * Nights already unavailable with no other blocking reservation are a
   * legacy hold from this pending row and are claimed too. Anything else
   * (missing row, calendar block, another confirmed stay) is not free.
   */
  private async tryClaimNightsForPayment(
    manager: EntityManager,
    reservation: ReservationEntity,
  ): Promise<AvailabilityEntity[] | null> {
    const blocking = await this.blocksService.find_blocking_overlap(
      reservation.site_id,
      reservation.room_id,
      reservation.checkin,
      reservation.checkout,
    );
    if (blocking) {
      return null;
    }
    try {
      return await this.lockFreeNightsOrFail(
        manager,
        {
          site_id: reservation.site_id,
          room_id: reservation.room_id,
          checkin: String(reservation.checkin).slice(0, 10),
          checkout: String(reservation.checkout).slice(0, 10),
          exclude_reservation_id: reservation.id,
        },
        { allowSelfHold: true },
      );
    } catch (error) {
      if (error instanceof ConflictException) {
        return null;
      }
      throw error;
    }
  }

  private async tryLockNightsForReactivation(
    manager: EntityManager,
    reservation: ReservationEntity,
  ): Promise<AvailabilityEntity[] | null> {
    const blocking = await this.blocksService.find_blocking_overlap(
      reservation.site_id,
      reservation.room_id,
      reservation.checkin,
      reservation.checkout,
    );
    if (blocking) {
      return null;
    }
    try {
      return await this.lockFreeNightsOrFail(manager, {
        site_id: reservation.site_id,
        room_id: reservation.room_id,
        checkin: String(reservation.checkin).slice(0, 10),
        checkout: String(reservation.checkout).slice(0, 10),
        exclude_reservation_id: reservation.id,
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Full refund of a payment we cannot honour. Stripe call uses the
   * idempotency key refund:{reservationId}:{n}; if the DB commit fails after
   * Stripe succeeded, the webhook retry recomputes the same n (not persisted)
   * and Stripe returns the same refund instead of refunding twice.
   */
  private async refundUnhonoredPayment(
    manager: EntityManager,
    reservation: ReservationEntity,
    input: ActivateFromPaymentInput,
    reason: AutoRefundReason,
  ): Promise<ActivateFromPaymentResult> {
    if (!input.paymentIntentId) {
      throw new BadRequestException(
        `Cannot refund reservation ${reservation.id}: missing payment_intent`,
      );
    }

    const sequence = reservation.refund_seq + 1;
    const refund = await this.stripeService.refundPaymentIntent({
      reservationId: reservation.id,
      sequence,
      paymentIntentId: input.paymentIntentId,
      reason,
    });

    const actor = input.actor ?? actors.stripe();
    const before = {
      status: reservation.status,
      payment_status: reservation.payment_status,
    };
    // The money WAS captured: payment row -> paid, then a refund row that
    // Stripe's refund.* webhooks will complete (F1, B4).
    await this.economics.recordPaymentSucceeded(
      manager,
      reservation,
      input.checkoutSessionId,
      input.paymentIntentId,
      input.amountPaidCents,
      actor,
    );
    await this.economics.recordRefundCreated(
      manager,
      {
        reservationId: reservation.id,
        paymentIntentId: input.paymentIntentId,
        amountCents: input.amountPaidCents,
        reason,
        idempotencyKey: stripeIdempotencyKeys.refund(reservation.id, sequence),
        stripeRefundId: refund.id,
        context: {
          requestedBy: actors.system("auto_refund"),
          approvedBy: actors.system("auto_refund"),
          responsible: "platform",
        },
      },
      actor,
    );

    const isDuplicate = reason === AUTO_REFUND_REASON.DUPLICATE_PAYMENT;
    reservation.refund_seq = sequence;

    if (!isDuplicate) {
      // The refunded payment is the only one this reservation ever received.
      const now = new Date();
      reservation.stripe_payment_intent_id = input.paymentIntentId;
      reservation.stripe_checkout_session_id = input.checkoutSessionId;
      reservation.stripe_refund_id = refund.id;
      reservation.paid_at = now;
      reservation.payment_status = "refunded";
      reservation.amount_refunded = input.amountPaidCents / 100;
      if (reservation.status !== "cancelled") {
        reservation.status = "cancelled";
        reservation.cancelled_at = now;
        reservation.cancel_reason = reason;
      }
    }

    const saved = await manager
      .getRepository(ReservationEntity)
      .save(reservation);
    if (!isDuplicate && saved.status === "cancelled") {
      await this.releaseNightsIfHeldByReservation(saved, manager);
    }
    await this.economics.auditReservationChange(
      manager,
      reservation.id,
      "reservation.payment_auto_refunded",
      actor,
      before,
      { status: saved.status, payment_status: saved.payment_status },
      { reason, refund_id: refund.id, refund_seq: sequence },
    );

    await this.reservationEventService.logEventInTransaction(
      manager,
      reservation.id,
      "payment_auto_refunded",
      {
        reason,
        refund_id: refund.id,
        refund_seq: sequence,
        payment_intent_id: input.paymentIntentId,
        checkout_session_id: input.checkoutSessionId,
        amount_cents: input.amountPaidCents,
      },
    );

    this.logger.warn(
      `Auto-refunded payment ${input.paymentIntentId} for reservation ${reservation.id} (${reason}), refund ${refund.id}`,
    );

    return {
      reservation: saved,
      outcome: PAYMENT_ACTIVATION_OUTCOME.REFUNDED,
      refundReason: reason,
    };
  }

  /**
   * Cancels an unpaid pending reservation and marks its payment failed.
   * Idempotent (row lock + state check). Nights are released only when this
   * reservation had taken them (legacy checkout). Immediate checkout never
   * took them, and nights held by another confirmed reservation stay taken.
   * Used by the cron, checkout.session.expired / async_payment_failed and
   * failed session creation.
   */
  async expirePendingReservation(
    id: number,
    reason: string,
    outerManager?: EntityManager,
    actor: Actor = actors.system("pending_expiry"),
    options: ExpirePendingOptions = {},
  ): Promise<boolean> {
    const run = async (manager: EntityManager): Promise<boolean> => {
      const repository = manager.getRepository(ReservationEntity);
      const reservation = await repository.findOne({
        where: { id },
        lock: { mode: "pessimistic_write" },
      });
      if (
        !reservation ||
        reservation.status !== "pending" ||
        reservation.payment_status !== "pending"
      ) {
        return false;
      }
      // pay-pending: a stale session's expiry must not cancel a reservation
      // that now has a newer session (checked under the row lock).
      const currentSession = reservation.stripe_checkout_session_id ?? null;
      if (
        options.onlyIfSessionId !== undefined &&
        currentSession !== null &&
        currentSession !== options.onlyIfSessionId
      ) {
        return false;
      }
      reservation.status = "cancelled";
      reservation.cancelled_at = new Date();
      reservation.cancel_reason = reason;
      const saved = await repository.save(reservation);
      await this.releaseNightsIfHeldByReservation(saved, manager);
      await this.economics.recordPaymentFailed(
        manager,
        id,
        reason,
        actor,
        reason === "checkout_session_expired" ||
          reason === "async_payment_failed"
          ? (saved.stripe_checkout_session_id ?? null)
          : null,
      );
      await this.economics.auditReservationChange(
        manager,
        id,
        "reservation.expired",
        actor,
        { status: "pending", payment_status: "pending" },
        { status: "cancelled", payment_status: "pending" },
        { reason },
      );
      await this.reservationEventService.logEventInTransaction(
        manager,
        id,
        "pending_expired",
        { reason },
      );
      return true;
    };

    if (outerManager) {
      return run(outerManager);
    }
    return this.reservationRepository.manager.transaction(run);
  }

  async releaseAvailabilityForReservation(
    reservation: ReservationEntity,
    manager?: EntityManager,
  ) {
    await this.releaseAvailability(reservation, manager);
  }

  async releaseRemainingAvailabilityForReservation(
    reservation: ReservationEntity,
    manager?: EntityManager,
  ) {
    const todayIso = formatUtcIsoDate(new Date());
    const checkinIso = String(reservation.checkin).slice(0, 10);
    const checkoutIso = String(reservation.checkout).slice(0, 10);
    const releaseFromMs = Math.max(
      parseIsoDateAtUtcMidnight(checkinIso).getTime(),
      parseIsoDateAtUtcMidnight(todayIso).getTime(),
    );
    const releaseFromIso = formatUtcIsoDate(new Date(releaseFromMs));

    if (releaseFromIso >= checkoutIso) {
      return;
    }

    await this.releaseNights(
      reservation,
      getNightDatesUtc(releaseFromIso, checkoutIso),
      manager,
    );
  }

  /**
   * Releases unavailable nights that no other blocking reservation covers.
   * Immediate checkout leaves nights available, so this is a no-op. A legacy
   * pending that flipped them is the holder and they are freed. Nights of
   * another confirmed reservation are not touched.
   */
  private async releaseNightsIfHeldByReservation(
    reservation: ReservationEntity,
    manager: EntityManager,
  ): Promise<void> {
    const checkin = String(reservation.checkin).slice(0, 10);
    const checkout = String(reservation.checkout).slice(0, 10);
    const nightDates = getNightDatesUtc(checkin, checkout);
    const firstNight = nightDates.at(0);
    const lastNight = nightDates.at(-1);
    if (firstNight === undefined || lastNight === undefined) {
      return;
    }

    const rows = await manager
      .getRepository(AvailabilityEntity)
      .createQueryBuilder("a")
      .setLock("pessimistic_write")
      .where("a.site_id = :siteId", { siteId: reservation.site_id })
      .andWhere("a.room_id = :roomId", { roomId: reservation.room_id })
      .andWhere("a.date >= :firstNight", { firstNight })
      .andWhere("a.date <= :lastNight", { lastNight })
      .orderBy("a.date", "ASC")
      .getMany();

    const others = await this.findBlockingReservations(
      reservation.site_id,
      reservation.room_id,
      checkin,
      checkout,
      manager,
      reservation.id,
    );
    const heldByOther = new Set<string>();
    for (const other of others) {
      for (const date of getNightDatesUtc(
        String(other.checkin).slice(0, 10),
        String(other.checkout).slice(0, 10),
      )) {
        heldByOther.add(date);
      }
    }

    const byDate = new Map(
      rows.map(row => [this.formatIsoDate(row.date), row]),
    );
    const toRelease: AvailabilityEntity[] = [];
    for (const date of nightDates) {
      const row = byDate.get(date);
      if (!row || row.is_available || heldByOther.has(date)) {
        continue;
      }
      toRelease.push(row);
    }
    await this.setNightsAvailability(manager, toRelease, true);
  }

  private async releaseAvailability(
    reservation: ReservationEntity,
    manager?: EntityManager,
  ) {
    await this.releaseNights(
      reservation,
      getNightDatesUtc(
        String(reservation.checkin).slice(0, 10),
        String(reservation.checkout).slice(0, 10),
      ),
      manager,
    );
  }

  private async releaseNights(
    reservation: ReservationEntity,
    nightDates: string[],
    manager?: EntityManager,
  ) {
    const firstNight = nightDates.at(0);
    const lastNight = nightDates.at(-1);
    if (firstNight === undefined || lastNight === undefined) {
      return;
    }
    const repository = manager
      ? manager.getRepository(AvailabilityEntity)
      : this.reservationRepository.manager.getRepository(AvailabilityEntity);
    await repository
      .createQueryBuilder()
      .update(AvailabilityEntity)
      .set({ is_available: true })
      .where("site_id = :siteId", { siteId: reservation.site_id })
      .andWhere("room_id = :roomId", { roomId: reservation.room_id })
      .andWhere("date >= :firstNight", { firstNight })
      .andWhere("date <= :lastNight", { lastNight })
      .execute();
  }

  /**
   * Expires unpaid holds. Grace period avoids racing a late
   * checkout.session.completed; if a payment still lands after expiry,
   * activateFromPayment reactivates or refunds it.
   */
  @Cron(CronExpression.EVERY_10_SECONDS)
  async processPendingReservations() {
    const reservations = await this.reservationRepository.find({
      select: { id: true },
      where: {
        status: "pending",
        payment_status: "pending",
        expiration_date: LessThan(
          new Date(Date.now() - PENDING_EXPIRY_GRACE_MS),
        ),
      },
      take: 100,
    });

    for (const reservation of reservations) {
      try {
        await this.expirePendingReservation(reservation.id, "expired");
      } catch (error) {
        this.logger.error(
          `Failed to expire pending reservation ${reservation.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
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

  private toNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /**
   * DATE columns come back from mysql2 as local-midnight Date objects, so
   * local getters are the correct inverse here (strings are passed through).
   */
  private formatIsoDate(value: Date | string): string {
    if (typeof value === "string") {
      return value.slice(0, 10);
    }

    const year = value.getFullYear();
    const month = `${value.getMonth() + 1}`.padStart(2, "0");
    const day = `${value.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
}
