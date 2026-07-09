import type { StripeWebhookEvent } from "../types/stripe-webhook-event.type";

import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { ReservationEntity } from "../../reservations/entities/reservation.entity";
import { ReservationService } from "../../reservations/services/reservation.service";
import { ReservationEmailService } from "../../reservations/services/reservation-email.service";

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

  constructor(
    private readonly reservationService: ReservationService,
    private readonly reservationEmailService: ReservationEmailService,
    @InjectRepository(ReservationEntity)
    private readonly reservationRepository: Repository<ReservationEntity>,
  ) {}

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
      const { reservation, activated } =
        await this.reservationService.activateFromPayment({
          reservationId,
          checkoutSessionId: session.id,
          paymentIntentId,
          amountPaidCents: session.amount_total,
        });
      if (!activated) {
        this.logger.log(
          `Reservation ${reservationId} already activated; skipping confirmation emails`,
        );
        return;
      }

      const site = await this.reservationService.getSiteById(
        reservation.site_id,
      );
      await this.reservationEmailService.sendPaymentConfirmedEmails(
        reservation,
        site,
      );
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

  async handleChargeRefunded(event: StripeWebhookEvent) {
    if (event.type !== "charge.refunded") {
      return;
    }

    const charge = event.data.object as {
      payment_intent?: string | { id: string } | null;
      amount_refunded?: number;
    };
    const paymentIntentId =
      typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : charge.payment_intent?.id;

    if (!paymentIntentId) {
      this.logger.warn("charge.refunded without payment_intent");
      return;
    }

    const reservation = await this.reservationRepository.findOne({
      where: { stripe_payment_intent_id: paymentIntentId },
    });
    if (!reservation) {
      this.logger.warn(
        `charge.refunded: no reservation for payment_intent ${paymentIntentId}`,
      );
      return;
    }

    if (reservation.payment_status === "refunded") {
      return;
    }

    const updated = await this.reservationRepository.preload({
      id: reservation.id,
      payment_status: "refunded",
    });
    if (!updated) {
      return;
    }
    const saved = await this.reservationRepository.save(updated);
    const site = await this.reservationService.getSiteById(saved.site_id);
    await this.reservationEmailService.sendRefundProcessedEmails(saved, site);
  }

  async handleChargeDisputeCreated(event: StripeWebhookEvent) {
    if (event.type !== "charge.dispute.created") {
      return;
    }

    const dispute = event.data.object as {
      payment_intent?: string | { id: string } | null;
      reason?: string;
    };
    const paymentIntentId =
      typeof dispute.payment_intent === "string"
        ? dispute.payment_intent
        : dispute.payment_intent?.id;

    if (!paymentIntentId) {
      this.logger.warn("charge.dispute.created without payment_intent");
      return;
    }

    const reservation = await this.reservationRepository.findOne({
      where: { stripe_payment_intent_id: paymentIntentId },
    });
    if (!reservation) {
      return;
    }

    const site = await this.reservationService.getSiteById(reservation.site_id);
    await this.reservationEmailService.sendStripeDisputeEmails(
      reservation,
      site,
      dispute.reason ?? "stripe_dispute",
    );
  }

  async handleTransferCreated(event: StripeWebhookEvent) {
    if (event.type !== "transfer.created") {
      return;
    }

    const transfer = event.data.object as {
      id: string;
      source_transaction?: string | null;
    };

    if (!transfer.source_transaction) {
      return;
    }

    const reservations = await this.reservationRepository.find({
      where: { stripe_transfer_id: transfer.id },
    });
    if (reservations.length > 0) {
      return;
    }

    this.logger.log(
      `transfer.created ${transfer.id} — backup sync if needed (source_transaction=${transfer.source_transaction})`,
    );
  }
}
