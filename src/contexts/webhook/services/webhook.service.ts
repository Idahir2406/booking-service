import type { StripeWebhookEvent } from "../types/stripe-webhook-event.type";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { StripeWebhookEventEntity } from "../entities/stripe-webhook-event.entity";
import { ExpressAccountsService } from "./express-accounts.service";
import { ReservationWebhookService } from "./reservation-webhook.service";

@Injectable()
export class WebhookService {
  constructor(
    @InjectRepository(StripeWebhookEventEntity)
    private readonly stripeWebhookEventRepository: Repository<StripeWebhookEventEntity>,
    private readonly reservationWebhookService: ReservationWebhookService,
    private readonly expressAccountsService: ExpressAccountsService,
  ) {}

  async handleWebhook(event: StripeWebhookEvent) {
    const existing = await this.stripeWebhookEventRepository.findOne({
      where: { stripe_event_id: event.id },
    });
    if (existing) {
      return { duplicate: true };
    }

    switch (event.type) {
      case "checkout.session.completed": {
        await this.reservationWebhookService.handleCheckoutCompleted(event);
        break;
      }
      case "checkout.session.expired": {
        await this.reservationWebhookService.handleCheckoutExpired(event);
        break;
      }
      case "account.updated": {
        await this.expressAccountsService.handleAccountUpdated(event);
        break;
      }
      default: {
        break;
      }
    }

    await this.stripeWebhookEventRepository.save({
      stripe_event_id: event.id,
      type: event.type,
      payload: event.data.object as Record<string, unknown>,
      processed_at: new Date(),
      reservation_id: this.extractReservationId(event),
    });

    return { duplicate: false };
  }

  private extractReservationId(event: StripeWebhookEvent): number | undefined {
    if (
      event.type !== "checkout.session.completed" &&
      event.type !== "checkout.session.expired"
    ) {
      return undefined;
    }

    const session = event.data.object as {
      metadata?: { reservation_id?: string };
    };
    const reservationId = Number(session.metadata?.reservation_id);
    if (!reservationId || Number.isNaN(reservationId)) {
      return undefined;
    }
    return reservationId;
  }
}
