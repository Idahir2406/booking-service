import type { StripeWebhookEvent } from "../types/stripe-webhook-event.type";

import { Injectable, Logger } from "@nestjs/common";

import { ReservationService } from "../../reservations/services/reservation.service";

interface CheckoutSessionPayload {
  id: string;
  payment_status: string;
  metadata?: Record<string, string>;
  payment_intent?: string | { id: string } | null;
  amount_total?: number | null;
}

@Injectable()
export class ReservationWebhookService {
  private readonly logger = new Logger(ReservationWebhookService.name);

  constructor(private readonly reservationService: ReservationService) {}

  async handleCheckoutCompleted(event: StripeWebhookEvent) {
    if (event.type !== "checkout.session.completed") {
      return;
    }

    const session = event.data.object as CheckoutSessionPayload;

    if (session.payment_status !== "paid") {
      this.logger.log(
        `Checkout session ${session.id} completed with payment_status=${session.payment_status}`,
      );
      return;
    }

    const reservationId = Number(session.metadata?.reservation_id);
    if (!reservationId || Number.isNaN(reservationId)) {
      this.logger.warn(
        `Checkout session ${session.id} missing metadata.reservation_id`,
      );
      return;
    }

    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : (session.payment_intent?.id ?? undefined);

    if (!paymentIntentId) {
      this.logger.warn(`Checkout session ${session.id} missing payment_intent`);
      return;
    }

    if (!session.amount_total) {
      this.logger.warn(`Checkout session ${session.id} missing amount_total`);
      return;
    }

    try {
      await this.reservationService.activateFromPayment({
        reservationId,
        checkoutSessionId: session.id,
        paymentIntentId,
        amountPaidCents: session.amount_total,
      });
    } catch (error) {
      this.logger.error(
        `Failed to activate reservation ${reservationId} from checkout session ${session.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async handleCheckoutExpired(event: StripeWebhookEvent) {
    if (event.type !== "checkout.session.expired") {
      return;
    }

    const session = event.data.object as CheckoutSessionPayload;
    const reservationId = Number(session.metadata?.reservation_id);
    if (!reservationId || Number.isNaN(reservationId)) {
      this.logger.warn(
        `Expired checkout session ${session.id} missing metadata.reservation_id`,
      );
      return;
    }

    const reservation = await this.reservationService.findById(reservationId);
    if (!reservation) {
      this.logger.warn(
        `Expired checkout session ${session.id} references missing reservation ${reservationId}`,
      );
      return;
    }

    if (reservation.status !== "pending") {
      return;
    }

    await this.reservationService.cancel(reservationId);
    this.logger.log(
      `Cancelled pending reservation ${reservationId} after checkout session ${session.id} expired`,
    );
  }
}
