import type { StripeService } from "../../stripe/services/stripe.service";
import type { TravelerPayResponseDto } from "../dto/traveler-panel.dto";
import type { ReservationEntity } from "../entities/reservation.entity";

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";

import {
  STRIPE_CHECKOUT_EXPIRY_MARGIN_MS,
  STRIPE_CHECKOUT_MAX_EXPIRY_MS,
  STRIPE_CHECKOUT_MIN_EXPIRY_MS,
} from "../utils/reservation-policy.util";
import { resolveTravelerPayability } from "../utils/traveler-panel-status.util";
import { ReservationService } from "./reservation.service";

/** Stable error codes of POST traveler/:user_id/reservations/:id/pay. */
export const TRAVELER_PAY_ERROR = {
  /** 410: payment window closed (hold expired, cancelled by expiry, < 30 min left). */
  EXPIRED: "expired",
  /** 409: dates no longer free (immediate checkout holds no nights). */
  UNAVAILABLE: "unavailable",
  /** 409: already paid. */
  ALREADY_PAID: "already_paid",
  /** 409: a payment of the current session is being processed. */
  PAYMENT_PROCESSING: "payment_processing",
  /** 409: any other non-payable state. */
  NOT_PAYABLE: "not_payable",
  /** 409: the session changed concurrently; the client may retry. */
  SESSION_CONFLICT: "session_conflict",
} as const;

export type TravelerPayErrorCode =
  (typeof TRAVELER_PAY_ERROR)[keyof typeof TRAVELER_PAY_ERROR];

/** cancel_reason values written by the pending-expiry paths. */
const EXPIRY_CANCEL_REASONS = new Set([
  "expired",
  "checkout_session_expired",
  "async_payment_failed",
  "checkout_session_failed",
]);

const STRIPE_CHECKOUT_HOST_RE = /(^|\.)stripe\.com$/i;

/** Only https URLs on stripe.com (checkout.stripe.com) are handed out. */
export function isStripeCheckoutUrl(value: string | null | undefined): boolean {
  if (typeof value !== "string" || value === "") {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && STRIPE_CHECKOUT_HOST_RE.test(url.hostname)
    );
  } catch {
    return false;
  }
}

function payError(
  status: 409 | 410,
  code: TravelerPayErrorCode,
  message: string,
): ConflictException | GoneException {
  const body = { statusCode: status, code, message };
  return status === 410 ? new GoneException(body) : new ConflictException(body);
}

/**
 * "Pagar reserva" (pay-pending). Sends the traveler back to Stripe for an
 * unfinished pending checkout of the SAME reservation:
 * - the current Checkout Session is still open -> its url;
 * - expired/missing -> a NEW session with the same frozen price lines
 *   (no repricing, no new reservation), expires_at <= expiration_date.
 * Never changes pricing, commission, refund or payout data.
 */
@Injectable()
export class TravelerReservationPayService {
  private readonly logger = new Logger(TravelerReservationPayService.name);

  constructor(
    private readonly reservationService: ReservationService,
    @Inject(
      forwardRef(
        // Circular StripeModule <-> ReservationModule (pre-existing pattern).
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-return, node/no-missing-require
        () => require("../../stripe/services/stripe.service").StripeService,
      ),
    )
    private readonly stripeService: StripeService,
  ) {}

  async payForTraveler(
    userId: number,
    reservationId: number,
    now: Date = new Date(),
  ): Promise<TravelerPayResponseDto> {
    if (!Number.isInteger(userId) || userId < 1) {
      throw new BadRequestException("Invalid traveler user_id");
    }
    const reservation = await this.reservationService.findById(reservationId);
    if (!reservation) {
      throw new NotFoundException(
        `Reservation with id ${reservationId} not found`,
      );
    }
    if (reservation.user_id !== userId) {
      throw new ForbiddenException("Reservation access denied");
    }

    this.assertPayable(reservation, now);

    try {
      await this.reservationService.assertPendingDatesStillFree(reservation);
    } catch (error) {
      if (error instanceof ConflictException) {
        throw payError(
          409,
          TRAVELER_PAY_ERROR.UNAVAILABLE,
          "Las fechas ya no están disponibles.",
        );
      }
      throw error;
    }

    const currentSessionId = reservation.stripe_checkout_session_id ?? null;
    if (currentSessionId !== null) {
      const session =
        await this.stripeService.retrieveCheckoutSessionState(currentSessionId);
      if (session?.status === "open") {
        if (!isStripeCheckoutUrl(session.url)) {
          // Never open a second payable session next to an open one.
          throw new BadGatewayException("Invalid checkout url");
        }
        return {
          reservation_id: reservation.id,
          checkout_url: String(session.url),
          expires_at: session.expires_at.toISOString(),
          reused: true,
        };
      }
      if (session?.status === "complete") {
        // Paid or async payment in flight: the webhook settles it.
        throw payError(
          409,
          TRAVELER_PAY_ERROR.PAYMENT_PROCESSING,
          "El pago de esta reserva se está procesando.",
        );
      }
    }

    const expiresAtUnix = this.resolveReplacementExpiry(reservation, now);
    const created = await this.stripeService.createReplacementCheckoutSession({
      reservation,
      replacedSessionId: currentSessionId,
      expiresAtUnix,
    });

    const swapped = await this.reservationService.replaceCheckoutSessionId(
      reservation.id,
      currentSessionId,
      created.session_id,
    );
    if (!swapped) {
      await this.stripeService.expireCheckoutSessionQuietly(created.session_id);
      throw payError(
        409,
        TRAVELER_PAY_ERROR.SESSION_CONFLICT,
        "La reserva ha cambiado. Vuelve a intentarlo.",
      );
    }

    if (!isStripeCheckoutUrl(created.url)) {
      this.logger.error(
        `Replacement Checkout Session for reservation ${reservation.id} returned a non-Stripe url`,
      );
      throw new BadGatewayException("Invalid checkout url");
    }

    this.logger.log(
      `Reservation ${reservation.id}: new Checkout Session replaces ${currentSessionId ?? "none"}`,
    );
    return {
      reservation_id: reservation.id,
      checkout_url: String(created.url),
      expires_at: created.expires_at.toISOString(),
      reused: false,
    };
  }

  private assertPayable(reservation: ReservationEntity, now: Date): void {
    if (reservation.payment_status === "paid") {
      throw payError(
        409,
        TRAVELER_PAY_ERROR.ALREADY_PAID,
        "Esta reserva ya está pagada.",
      );
    }
    if (reservation.status === "cancelled") {
      if (EXPIRY_CANCEL_REASONS.has(String(reservation.cancel_reason ?? ""))) {
        throw payError(
          410,
          TRAVELER_PAY_ERROR.EXPIRED,
          "Esta reserva ha caducado.",
        );
      }
      throw payError(
        409,
        TRAVELER_PAY_ERROR.NOT_PAYABLE,
        "Esta reserva no se puede pagar.",
      );
    }
    if (
      reservation.status !== "pending" ||
      reservation.payment_status !== "pending"
    ) {
      throw payError(
        409,
        TRAVELER_PAY_ERROR.NOT_PAYABLE,
        "Esta reserva no se puede pagar.",
      );
    }
    if (!resolveTravelerPayability(reservation, now).can_pay) {
      throw payError(
        410,
        TRAVELER_PAY_ERROR.EXPIRED,
        "Esta reserva ha caducado.",
      );
    }
  }

  /**
   * New session expiry: the reservation's own expiration_date (never
   * extended), capped at Stripe's 24 h. Stripe needs >= 30 min: with less
   * time left the hold is effectively over -> 410.
   */
  private resolveReplacementExpiry(
    reservation: ReservationEntity,
    now: Date,
  ): number {
    const expiresMs = new Date(reservation.expiration_date).getTime();
    const minMs =
      now.getTime() +
      STRIPE_CHECKOUT_MIN_EXPIRY_MS +
      STRIPE_CHECKOUT_EXPIRY_MARGIN_MS;
    if (!Number.isFinite(expiresMs) || expiresMs < minMs) {
      throw payError(
        410,
        TRAVELER_PAY_ERROR.EXPIRED,
        "Esta reserva ha caducado.",
      );
    }
    const targetMs = Math.min(
      expiresMs,
      now.getTime() + STRIPE_CHECKOUT_MAX_EXPIRY_MS,
    );
    // floor: never beyond the reservation expiration.
    return Math.floor(targetMs / 1000);
  }
}
