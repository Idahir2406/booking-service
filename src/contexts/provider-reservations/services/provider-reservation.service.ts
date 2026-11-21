import type {
  PrebookResult,
  ProviderCancellationPolicy,
  ProviderHotel,
  ProviderHotelRates,
  ProviderPetPolicy,
  ProviderRateOffer,
  ProviderTax,
} from "../../providers/domain/provider.types";
import type {
  ProviderBookingDogRecord,
  ProviderBookingRecord,
  ProviderQuoteChange,
  ProviderQuoteStatus,
  ProviderRatesMessage,
} from "../domain/provider-reservation.types";
import type {
  ProviderCheckoutDto,
  ProviderQuoteDto,
  ProviderRatesQueryDto,
} from "../dto/provider-reservations.dto";

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { actors } from "../../payments/domain/audit-actor";
import { PRICE_LINE_TYPE } from "../../payments/entities/reservation-price-line.entity";
import { SNAPSHOT_REASON } from "../../payments/entities/reservation-snapshot.entity";
import { paymentKeys } from "../../payments/services/payment-ledger.service";
import { PlatformSettingsService } from "../../payments/services/platform-settings.service";
import {
  reservationCurrency,
  ReservationEconomicsService,
} from "../../payments/services/reservation-economics.service";
import { centsToDecimal } from "../../payments/utils/money.util";
import {
  ProviderError,
  ProviderOfferExpiredError,
  ProviderUnavailableError,
} from "../../providers/domain/provider.errors";
import { computeSellPrice } from "../../providers/domain/provider-pricing";
import { ProviderOfferEntity } from "../../providers/entities/provider-offer.entity";
import {
  PROVIDER_PROPERTY_STATUS,
  ProviderPropertyEntity,
} from "../../providers/entities/provider-property.entity";
import { AccommodationProviderRegistry } from "../../providers/services/accommodation-provider.registry";
import { ReservationEntity } from "../../reservations/entities/reservation.entity";
import {
  calcNightsUtc,
  resolveCheckoutExpiry,
  resolvePendingTtlMs,
} from "../../reservations/utils/reservation-policy.util";
import {
  TRAVELER_TOKEN_STATUS,
  verifyTravelerToken,
} from "../../reservations/utils/traveler-token.util";
import { envs } from "../../shared/configs/envs";
import { MysqlService } from "../../shared/services/mysql.service";
import { StripeService } from "../../stripe/services/stripe.service";
import {
  PROVIDER_QUOTE_STATUS,
  PROVIDER_RATES_MESSAGE,
} from "../domain/provider-reservation.types";
import {
  buildDogRemarks,
  clientReferenceFor,
  decideQuoteReconfirmation,
  parseChildrenAges,
} from "../domain/provider-reservation.util";

const MAX_NIGHTS = 30;

export interface ProviderCancellationView {
  /** UTC ISO instant from which the amount is charged. */
  deadline: string;
  /** Penalty in sell terms (provider amount + same V4P markup). */
  amount_cents: number;
  currency: string | null;
  /** Timezone the provider expressed the deadline in (raw). */
  timezone: string | null;
}

export interface ProviderTaxView {
  description: string | null;
  amount_cents: number | null;
  currency: string | null;
}

export interface ProviderOfferView {
  offer_id: string;
  room_name: string | null;
  board_code: string | null;
  board_name: string | null;
  sell_cents: number;
  currency: string;
  refundable: boolean;
  /** Last instant to cancel for free (null = NRFN / no free window). */
  free_cancellation_until: string | null;
  cancellation_policies: ProviderCancellationView[];
  /** Paid at the property (city tax...), not charged by V4P. */
  taxes_not_included: ProviderTaxView[];
  max_occupancy: number | null;
  remarks: string | null;
}

export interface ProviderPetPolicyView {
  allowed: boolean | null;
  fee: boolean | null;
  fee_amount_cents: number | null;
  fee_currency: string | null;
  fee_basis: string | null;
  weight_limit: string | null;
  terms: string | null;
  text: string | null;
}

export interface ProviderRatesResponse {
  site_id: number;
  checkin: string;
  checkout: string;
  nights: number;
  currency: string;
  empty: boolean;
  message_key: ProviderRatesMessage | null;
  hotel_timezone: string | null;
  pet_policy: ProviderPetPolicyView | null;
  offers: ProviderOfferView[];
}

export interface ProviderQuoteResponse {
  status: ProviderQuoteStatus;
  changes: ProviderQuoteChange[];
  offer: ProviderOfferView;
  /** Only when status = ok. */
  reservation_id: number | null;
  client_reference: string | null;
  expires_at: string | null;
}

export interface ProviderCheckoutResponse {
  reservation_id: number;
  checkout_url: string | null;
  session_id: string;
  expires_at: string;
}

interface SiteRow {
  id: number;
  name: string | null;
}

function toPetPolicyView(snapshot: unknown): ProviderPetPolicyView | null {
  if (typeof snapshot !== "object" || snapshot === null) {
    return null;
  }
  const raw = snapshot as Partial<ProviderPetPolicy> & {
    petsAllowed?: boolean | null;
    petPolicy?: Partial<ProviderPetPolicy> | null;
  };
  // Accept both a bare ProviderPetPolicy and { petsAllowed, petPolicy }.
  const policy: Partial<ProviderPetPolicy> = raw.petPolicy ?? raw;
  const allowed =
    typeof raw.petsAllowed === "boolean"
      ? raw.petsAllowed
      : (policy.allowed ?? null);
  return {
    allowed,
    fee: policy.fee ?? null,
    fee_amount_cents: policy.feeAmountCents ?? null,
    fee_currency: policy.feeCurrency ?? null,
    fee_basis: policy.feeBasis ?? null,
    weight_limit: policy.weightLimit ?? null,
    terms: policy.terms ?? null,
    text: policy.text ?? null,
  };
}

function hotelTimezone(contentSnapshot: unknown): string | null {
  if (typeof contentSnapshot !== "object" || contentSnapshot === null) {
    return null;
  }
  const timezone = (contentSnapshot as Partial<ProviderHotel>).timezone;
  return typeof timezone === "string" && timezone !== "" ? timezone : null;
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function sameCurrency(a: string | null | undefined, b: string): boolean {
  return (a ?? "").toUpperCase() === b.toUpperCase();
}

/**
 * Public side of provider reservations (called by PHP with X-Internal-Key):
 * live rates with the V4P sell price, quote (prebook + pending reservation)
 * and the manual-capture Stripe Checkout. Never touches availability.
 */
@Injectable()
export class ProviderReservationService {
  private readonly logger = new Logger(ProviderReservationService.name);

  constructor(
    @InjectRepository(ProviderPropertyEntity)
    private readonly propertyRepository: Repository<ProviderPropertyEntity>,
    @InjectRepository(ProviderOfferEntity)
    private readonly offerRepository: Repository<ProviderOfferEntity>,
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
    private readonly registry: AccommodationProviderRegistry,
    private readonly settings: PlatformSettingsService,
    private readonly economics: ReservationEconomicsService,
    private readonly stripeService: StripeService,
    private readonly mysqlService: MysqlService,
  ) {}

  // ------------------------------------------------------------------ rates

  async getRates(query: ProviderRatesQueryDto): Promise<ProviderRatesResponse> {
    const property = await this.resolveProperty(
      query.site_id,
      query.admin_preview === "1",
    );
    const { checkin, checkout, nights } = this.validateStay(
      query.checkin,
      query.checkout,
    );
    const currency = envs.CURRENCY.toUpperCase();
    const petPolicy = toPetPolicyView(property.pets_snapshot);
    const base: ProviderRatesResponse = {
      site_id: query.site_id,
      checkin,
      checkout,
      nights,
      currency,
      empty: true,
      message_key: PROVIDER_RATES_MESSAGE.NO_AVAILABILITY,
      hotel_timezone: hotelTimezone(property.content_snapshot),
      pet_policy: petPolicy,
      offers: [],
    };

    if ((query.pets ?? 0) > 0 && petPolicy?.allowed === false) {
      return { ...base, message_key: PROVIDER_RATES_MESSAGE.PETS_NOT_ALLOWED };
    }

    const provider = this.registry.get(property.provider);
    let hotels: ProviderHotelRates[];
    try {
      hotels = await provider.searchRates({
        hotelIds: [property.provider_hotel_id],
        checkin,
        checkout,
        occupancies: [
          {
            adults: query.adults,
            childrenAges: parseChildrenAges(query.children_ages),
          },
        ],
        currency,
      });
    } catch (error) {
      if (error instanceof ProviderError) {
        this.logger.warn(
          `Rates failed for site ${query.site_id} (${error.name} ${error.code}): ${error.message}`,
        );
        return { ...base, message_key: PROVIDER_RATES_MESSAGE.PROVIDER_ERROR };
      }
      throw error;
    }

    const markupRate = await this.settings.get("provider_markup_rate");
    const offers = hotels
      .filter(hotel => hotel.hotelId === property.provider_hotel_id)
      .flatMap(hotel => hotel.offers)
      .map(offer => this.toOfferView(offer, markupRate, currency))
      .filter((offer): offer is ProviderOfferView => offer !== null)
      .sort((a, b) => a.sell_cents - b.sell_cents);

    if (offers.length === 0) {
      return base;
    }
    return { ...base, empty: false, message_key: null, offers };
  }

  // ------------------------------------------------------------------ quote

  async quote(dto: ProviderQuoteDto): Promise<ProviderQuoteResponse> {
    const property = await this.resolveProperty(dto.site_id, false);
    const { checkin, checkout, nights } = this.validateStay(
      dto.checkin,
      dto.checkout,
    );
    const dogs: ProviderBookingDogRecord[] = (dto.dogs ?? []).map(dog => ({
      name: emptyToNull(dog.name),
      weight_kg: dog.weight_kg,
      is_ppp: dog.is_ppp,
    }));
    const pets = dto.dogs ? dogs.length : (dto.pets ?? 0);
    const petPolicy = toPetPolicyView(property.pets_snapshot);
    if (pets > 0 && petPolicy?.allowed === false) {
      throw new UnprocessableEntityException({
        code: "pets_not_allowed",
        message: "Este alojamiento no admite perros.",
      });
    }

    const currency = envs.CURRENCY.toUpperCase();
    const prebook = await this.prebookOrFail(property.provider, dto.offer_id);
    if (
      prebook.hotelId !== null &&
      prebook.hotelId !== property.provider_hotel_id
    ) {
      throw new ConflictException({
        code: "offer_mismatch",
        message: "La oferta no corresponde a este alojamiento.",
      });
    }
    const netCents = prebook.offer.netCents;
    if (netCents === null || netCents <= 0) {
      throw new ServiceUnavailableException({
        code: "provider_invalid_price",
        message: "No hemos podido confirmar el precio. Inténtalo de nuevo.",
      });
    }
    if (!sameCurrency(prebook.offer.currency, currency)) {
      throw new UnprocessableEntityException({
        code: "currency_unsupported",
        message: "La tarifa no está disponible en esta moneda.",
      });
    }

    const markupRate = await this.settings.get("provider_markup_rate");
    const price = computeSellPrice(netCents, markupRate);
    const offerView = this.toOfferView(
      { ...prebook.offer, offerId: prebook.offerId ?? dto.offer_id },
      markupRate,
      currency,
    );
    if (!offerView) {
      throw new ServiceUnavailableException({
        code: "provider_invalid_price",
        message: "No hemos podido confirmar el precio. Inténtalo de nuevo.",
      });
    }

    const decision = decideQuoteReconfirmation({
      priceDifferencePercent: prebook.priceDifferencePercent,
      cancellationChanged: prebook.cancellationChanged,
      boardChanged: prebook.boardChanged,
      sellCents: price.sellCents,
      acceptedPriceCents: dto.accepted_price_cents ?? null,
    });
    if (decision.requiresReconfirmation) {
      return {
        status: PROVIDER_QUOTE_STATUS.REQUIRES_RECONFIRMATION,
        changes: decision.changes,
        offer: offerView,
        reservation_id: null,
        client_reference: null,
        expires_at: null,
      };
    }

    const travelerUserId = this.resolveTravelerUserId(dto.traveler_token);
    const terms = await this.economics.resolveFrozenTerms();
    const timezone = hotelTimezone(property.content_snapshot) ?? terms.timezone;
    const now = new Date();
    const record: ProviderBookingRecord = {
      version: 1,
      holder: {
        firstName: dto.guest_first_name.trim(),
        lastName: dto.guest_last_name.trim(),
        email: dto.guest_email.trim(),
        phone: emptyToNull(dto.guest_phone),
      },
      adults: dto.adults,
      children_ages: dto.children_ages ?? [],
      dogs,
      remarks: buildDogRemarks(dogs, pets),
      authorized_at: null,
      booking_started_at: null,
      hotel_confirmation_code: null,
      booking: null,
      failure: null,
    };
    const totalDecimal = centsToDecimal(price.sellCents);
    const roomLabel = prebook.offer.roomName ?? "Habitación";
    const expirationDate = new Date(
      now.getTime() +
        resolvePendingTtlMs(envs.PENDING_RESERVATION_EXPIRATION_TIME),
    );
    const actor = actors.traveler(travelerUserId > 0 ? travelerUserId : null);

    const reservation = await this.reservationRepository.manager.transaction(
      async manager => {
        const repository = manager.getRepository(ReservationEntity);
        const created = repository.create({
          site_id: property.site_id,
          // Provider reservations have no V4P room/availability (room 0).
          room_id: 0,
          board_snapshot: prebook.offer.boardCode
            ? {
                code: prebook.offer.boardCode,
                name: prebook.offer.boardName ?? prebook.offer.boardCode,
                description: null,
                is_included: true,
                price: 0,
                board_amount: 0,
              }
            : undefined,
          source: "nuitee",
          user_id: travelerUserId,
          guest_name: `${record.holder.firstName} ${record.holder.lastName}`,
          guest_email: record.holder.email,
          guest_phone: dto.guest_phone,
          guest_notes: dto.guest_notes,
          checkin,
          checkout,
          guests: dto.adults + (dto.children_ages?.length ?? 0),
          pets,
          subtotal: totalDecimal,
          commission: 0,
          total: totalDecimal,
          status: "pending",
          payment_status: "pending",
          charge_mode: "immediate",
          expiration_date: expirationDate,
          commission_rate: price.markupRate,
          commission_cents: price.markupCents,
          total_cents: price.sellCents,
          currency: reservationCurrency(),
          timezone,
          provider_status: "prebooked",
          provider_booking_json: record,
        });
        await repository.save(created);
        created.client_reference = clientReferenceFor(created.id);
        await repository.save(created);

        await this.economics.recordNewReservation(manager, created, {
          terms: {
            ...terms,
            commissionRate: price.markupRate,
            timezone,
            cancellationPolicy: null,
            chargePlan: null,
          },
          lines: [
            {
              type: PRICE_LINE_TYPE.ACCOMMODATION,
              description: `Alojamiento · ${roomLabel}`,
              quantity: nights,
              unit_amount_cents: Math.round(price.sellCents / nights),
              amount_cents: price.sellCents,
              is_optional: false,
              is_commissionable: true,
              is_penalizable: true,
              metadata: {
                provider: property.provider,
                net_cents: price.netCents,
                markup_cents: price.markupCents,
                board: prebook.offer.boardName,
              },
            },
          ],
          room: null,
          board: prebook.offer.boardCode
            ? {
                id: null,
                code: prebook.offer.boardCode,
                name: prebook.offer.boardName ?? prebook.offer.boardCode,
                is_included: true,
                price_cents: 0,
                amount_cents: 0,
              }
            : null,
          actor,
          reason: SNAPSHOT_REASON.CHECKOUT,
          nights,
          paymentIdempotencyKey: paymentKeys.checkout(created.id),
        });
        if (created.snapshot_version) {
          await repository.update(created.id, {
            snapshot_version: created.snapshot_version,
          });
        }

        const offers = manager.getRepository(ProviderOfferEntity);
        await offers.save(
          offers.create({
            reservation_id: created.id,
            provider: property.provider,
            provider_hotel_id: property.provider_hotel_id,
            offer_id: prebook.offerId ?? dto.offer_id,
            prebook_id: prebook.prebookId,
            prebook_at: now,
            expires_at: new Date(
              now.getTime() + envs.PROVIDER_PREBOOK_TTL_MINUTES * 60_000,
            ),
            net_cents: price.netCents,
            sell_cents: price.sellCents,
            markup_cents: price.markupCents,
            markup_rate: price.markupRate,
            currency,
            room_name: prebook.offer.roomName,
            board_code: prebook.offer.boardCode,
            board_name: prebook.offer.boardName,
            refundable: prebook.offer.refundable,
            cancellation_json: prebook.offer.cancellationPolicies,
            taxes_not_included_json: prebook.offer.taxesNotIncluded,
            raw_prebook_json: (prebook.raw ?? null) as object | null,
          }),
        );
        return created;
      },
    );

    return {
      status: PROVIDER_QUOTE_STATUS.OK,
      changes: decision.changes,
      offer: offerView,
      reservation_id: reservation.id,
      client_reference: reservation.client_reference ?? null,
      expires_at: expirationDate.toISOString(),
    };
  }

  // --------------------------------------------------------------- checkout

  async checkout(dto: ProviderCheckoutDto): Promise<ProviderCheckoutResponse> {
    const reservation = await this.reservationRepository.findOne({
      where: { id: dto.reservation_id },
    });
    if (!reservation || reservation.source !== "nuitee") {
      throw new NotFoundException(
        `Provider reservation ${dto.reservation_id} not found`,
      );
    }
    if (
      reservation.status !== "pending" ||
      reservation.payment_status !== "pending" ||
      reservation.provider_status !== "prebooked" ||
      reservation.stripe_payment_intent_id
    ) {
      throw new ConflictException({
        code: "reservation_not_payable",
        message: "Esta reserva ya no se puede pagar.",
      });
    }
    const totalCents = reservation.total_cents ?? 0;
    const email = String(reservation.guest_email ?? "").trim();
    if (totalCents <= 0 || email === "") {
      throw new BadRequestException(
        `Reservation ${reservation.id} has no amount or email`,
      );
    }
    if (new Date(reservation.expiration_date).getTime() <= Date.now()) {
      throw new ConflictException({
        code: "reservation_expired",
        message: "La reserva ha caducado. Vuelve a buscar disponibilidad.",
      });
    }

    // Stripe needs >= 30 min: the hold is extended to the session expiry.
    const expiry = resolveCheckoutExpiry(new Date(reservation.expiration_date));
    const previous = reservation.stripe_checkout_session_id ?? null;
    if (previous) {
      const state =
        await this.stripeService.retrieveCheckoutSessionState(previous);
      if (state?.status === "open" && state.url) {
        return {
          reservation_id: reservation.id,
          checkout_url: state.url,
          session_id: state.id,
          expires_at: state.expires_at.toISOString(),
        };
      }
    }

    const [site, offer] = await Promise.all([
      this.mysqlService.queryOne<SiteRow>(
        `SELECT id, name FROM ${envs.DB_PREFIX}sites1 WHERE id = ?`,
        [reservation.site_id],
      ),
      this.offerRepository.findOne({
        where: { reservation_id: reservation.id },
        order: { id: "DESC" },
      }),
    ]);
    const description = [site?.name ?? "Alojamiento", offer?.room_name]
      .filter(Boolean)
      .join(" · ");

    const session = await this.stripeService.createManualCaptureCheckoutSession(
      {
        reservationId: reservation.id,
        siteId: reservation.site_id,
        amountCents: totalCents,
        currency: reservation.currency ?? envs.CURRENCY,
        email,
        description,
        expiresAtUnix: expiry.expiresAtUnix,
        replacedSessionId: previous,
        metadata: {
          client_reference:
            reservation.client_reference ?? clientReferenceFor(reservation.id),
        },
      },
    );

    await this.reservationRepository.manager.transaction(async manager => {
      await manager.getRepository(ReservationEntity).update(reservation.id, {
        stripe_checkout_session_id: session.sessionId,
        expiration_date: expiry.expirationDate,
      });
      await this.economics.attachCheckoutSession(
        manager,
        reservation.id,
        session.sessionId,
        actors.system("provider_checkout"),
      );
    });

    return {
      reservation_id: reservation.id,
      checkout_url: session.url,
      session_id: session.sessionId,
      expires_at: session.expiresAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------- helpers

  private async resolveProperty(
    siteId: number,
    allowDraft: boolean,
  ): Promise<ProviderPropertyEntity> {
    const property = await this.propertyRepository.findOne({
      where: { site_id: siteId },
    });
    const visible =
      property?.status === PROVIDER_PROPERTY_STATUS.ACTIVE ||
      (allowDraft && property?.status === PROVIDER_PROPERTY_STATUS.DRAFT);
    if (!property || !visible || !this.registry.has(property.provider)) {
      throw new NotFoundException({
        code: "provider_property_not_found",
        message: "Este alojamiento no admite reserva inmediata.",
      });
    }
    return property;
  }

  private validateStay(
    checkinRaw: string,
    checkoutRaw: string,
  ): { checkin: string; checkout: string; nights: number } {
    const checkin = checkinRaw.slice(0, 10);
    const checkout = checkoutRaw.slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const nights = calcNightsUtc(checkin, checkout);
    if (checkin < today || nights < 1 || nights > MAX_NIGHTS) {
      throw new BadRequestException({
        code: "invalid_dates",
        message: "Las fechas no son válidas.",
      });
    }
    return { checkin, checkout, nights };
  }

  private async prebookOrFail(
    providerName: string,
    offerId: string,
  ): Promise<PrebookResult> {
    try {
      return await this.registry.get(providerName).prebook(offerId);
    } catch (error) {
      if (
        error instanceof ProviderUnavailableError ||
        error instanceof ProviderOfferExpiredError
      ) {
        throw new ConflictException({
          code: "offer_unavailable",
          message:
            "Esta tarifa ya no está disponible. Vuelve a consultar la disponibilidad.",
        });
      }
      // NotConfigured / Transient / any other provider error.
      if (error instanceof ProviderError) {
        this.logger.warn(
          `Prebook failed (${error.name} ${error.code}): ${error.message}`,
        );
        throw new ServiceUnavailableException({
          code: "provider_unavailable",
          message: "No hemos podido confirmar la tarifa. Inténtalo de nuevo.",
        });
      }
      throw error;
    }
  }

  private toOfferView(
    offer: ProviderRateOffer,
    markupRate: number,
    currency: string,
  ): ProviderOfferView | null {
    if (offer.netCents === null || offer.netCents <= 0) {
      return null;
    }
    if (!sameCurrency(offer.currency, currency)) {
      return null;
    }
    const price = computeSellPrice(offer.netCents, markupRate);
    const policies = offer.cancellationPolicies.map(
      (policy: ProviderCancellationPolicy): ProviderCancellationView => ({
        deadline: policy.deadline,
        amount_cents: computeSellPrice(
          Math.max(0, Math.round(policy.amountCents)),
          markupRate,
        ).sellCents,
        currency: policy.currency,
        timezone: policy.timezone,
      }),
    );
    const firstPaid = policies.find(policy => policy.amount_cents > 0);
    return {
      offer_id: offer.offerId,
      room_name: offer.roomName,
      board_code: offer.boardCode,
      board_name: offer.boardName,
      sell_cents: price.sellCents,
      currency,
      refundable: offer.refundable,
      free_cancellation_until:
        offer.refundable && firstPaid ? firstPaid.deadline : null,
      cancellation_policies: policies,
      taxes_not_included: offer.taxesNotIncluded.map(
        (tax: ProviderTax): ProviderTaxView => ({
          description: tax.description,
          amount_cents: tax.amountCents,
          currency: tax.currency,
        }),
      ),
      max_occupancy: offer.maxOccupancy,
      remarks: offer.remarks,
    };
  }

  private resolveTravelerUserId(token: string | undefined): number {
    const result = verifyTravelerToken(token, envs.INTERNAL_API_KEY);
    if (result.status === TRAVELER_TOKEN_STATUS.VALID) {
      return result.userId ?? 0;
    }
    if (result.status !== TRAVELER_TOKEN_STATUS.MISSING) {
      this.logger.warn(
        `Provider quote traveler_token rejected (${result.status}); booking as guest`,
      );
    }
    return 0;
  }
}
