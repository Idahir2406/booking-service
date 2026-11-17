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

import { PAYMENT_STATUS } from "../../payments/domain/payment-state-machine";
import {
  isDeferredUnpaid,
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

/** Fase 4: ledger states in which a deferred reservation can be paid. */
const DEFERRED_PAYABLE_STATUSES = new Set<string>([
  PAYMENT_STATUS.METHOD_VALIDATED,
  PAYMENT_STATUS.FAILED,
  PAYMENT_STATUS.PENDING_REGULARIZATION,
]);

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

    // Fase 4: a confirmed flexible reservation whose deferred charge is
    // unpaid (regularization, or paying before charge_at) pays its total
    // through a normal Checkout Session. Its nights are already blocked.
    const deferred = isDeferredUnpaid(reservation);
    if (deferred) {
      await this.assertDeferredPayable(reservation, now);
    } else {
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
    }

    const currentSessionId = reservation.stripe_checkout_session_id ?? null;
    if (currentSessionId !== null) {
      const fetched =
        await this.stripeService.retrieveCheckoutSessionState(currentSessionId);
      // The completed setup session of a flexible reservation is not a
      // payment: a new payment session replaces it.
      const session = deferred && fetched?.mode === "setup" ? null : fetched;
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

    const expiresAtUnix = deferred
      ? this.resolveDeferredExpiry(reservation, now)
      : this.resolveReplacementExpiry(reservation, now);
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
   * Fase 4: confirmed flexible + unpaid. Payable while the saved-card charge
   * is not running: method_validated (early payment) or failed /
   * pending_regularization (before regularization_deadline_at).
   */
  private async assertDeferredPayable(
    reservation: ReservationEntity,
    now: Date,
  ): Promise<void> {
    const deadline = reservation.regularization_deadline_at
      ? new Date(reservation.regularization_deadline_at).getTime()
      : null;
    if (deadline !== null && deadline <= now.getTime()) {
      throw payError(
        410,
        TRAVELER_PAY_ERROR.EXPIRED,
        "El plazo para pagar esta reserva ha terminado.",
      );
    }
    const status = await this.reservationService.findLatestPaymentStatus(
      reservation.id,
    );
    if (status === PAYMENT_STATUS.PROCESSING) {
      throw payError(
        409,
        TRAVELER_PAY_ERROR.PAYMENT_PROCESSING,
        "El pago de esta reserva se está procesando.",
      );
    }
    if (status === null || !DEFERRED_PAYABLE_STATUSES.has(status)) {
      throw payError(
        409,
        TRAVELER_PAY_ERROR.NOT_PAYABLE,
        "Esta reserva no se puede pagar.",
      );
    }
  }

  /**
   * Fase 4: session expiry for a deferred payment: the regularization
   * deadline when there is one, else Stripe's 24 h maximum. Needs >= 30 min.
   */
  private resolveDeferredExpiry(
    reservation: ReservationEntity,
    now: Date,
  ): number {
    const maxMs = now.getTime() + STRIPE_CHECKOUT_MAX_EXPIRY_MS;
    const deadlineMs = reservation.regularization_deadline_at
      ? new Date(reservation.regularization_deadline_at).getTime()
      : maxMs;
    const minMs =
      now.getTime() +
      STRIPE_CHECKOUT_MIN_EXPIRY_MS +
      STRIPE_CHECKOUT_EXPIRY_MARGIN_MS;
    if (!Number.isFinite(deadlineMs) || deadlineMs < minMs) {
      throw payError(
        410,
        TRAVELER_PAY_ERROR.EXPIRED,
        "El plazo para pagar esta reserva ha terminado.",
      );
    }
    return Math.floor(Math.min(deadlineMs, maxMs) / 1000);
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
