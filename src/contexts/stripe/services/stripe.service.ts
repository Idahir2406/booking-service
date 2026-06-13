import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import Stripe from "stripe";

import { Site } from "@/src/types/site.types";

import { ReservationService } from "../../reservations/services/reservation.service";
import { envs } from "../../shared/configs/envs";
import { MysqlService } from "../../shared/services/mysql.service";
import { CreateExpressAccountDto } from "../dto/create-express-account.dto";
import { CreateSitePaymentIntentDto } from "../dto/create-site-payment-intent.dto";
import { StripeConnectStatusDto } from "../dto/stripe-connect-status.dto";
import { UserProfilesService } from "./user-profiles.service";

@Injectable()
export class StripeService {
  private readonly stripe: Stripe.Stripe;

  constructor(
    private readonly mysqlService: MysqlService,
    private readonly reservationService: ReservationService,
    private readonly userProfilesService: UserProfilesService,
  ) {
    this.stripe = new Stripe(envs.STRIPE_API_KEY, {
      apiVersion: "2026-04-22.dahlia",
    });
  }

  constructWebhookEvent(rawBody: Buffer, signature: string) {
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      envs.STRIPE_WEBHOOK_SECRET,
    );
  }

  async createSitePaymentLink(body: CreateSitePaymentIntentDto) {
    const reservation = await this.reservationService.findById(
      body.reservation_id,
    );

    if (!reservation) {
      throw new NotFoundException(
        `Reservation with id ${body.reservation_id} not found`,
      );
    }

    if (
      reservation.status !== "pending" ||
      reservation.payment_status !== "pending"
    ) {
      throw new BadRequestException(
        `Reservation ${reservation.id} is not pending payment`,
      );
    }

    const site = await this.mysqlService.queryOne<Site>(
      `SELECT * FROM ${envs.DB_PREFIX}sites1 WHERE id = ?`,
      [reservation.site_id],
    );
    if (!site) {
      throw new NotFoundException(
        `Site with id ${reservation.site_id} not found`,
      );
    }

    const amountCents = Math.round(
      (Number(reservation.subtotal) + Number(reservation.commission)) * 100,
    );
    if (amountCents <= 0) {
      throw new BadRequestException(
        `Reservation ${reservation.id} has invalid payment amount`,
      );
    }

    const customer = await this.createOrGetCustomer(body.email);

    const checkoutSession = await this.stripe.checkout.sessions.create({
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: envs.CURRENCY,
            product_data: {
              name: site.name ?? "Pago de alojamiento",
            },
            unit_amount: amountCents,
          },
        },
      ],
      metadata: {
        reservation_id: reservation.id.toString(),
      },
      customer: customer.id,
      success_url: `${envs.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${envs.FRONTEND_URL}/cancel`,
      currency: envs.CURRENCY,
      mode: "payment",
    });

    await this.reservationService.saveStripeCheckoutSessionId(
      reservation.id,
      checkoutSession.id,
    );

    return {
      url: checkoutSession.url,
      session_id: checkoutSession.id,
    };
  }

  async getConnectStatus(userId: number): Promise<StripeConnectStatusDto> {
    const profile = await this.userProfilesService.findById(userId);
    if (!profile) {
      throw new NotFoundException(`User profile with id ${userId} not found`);
    }

    const stripeAccountId = profile.stripe_account_id ?? null;
    if (!stripeAccountId) {
      return {
        user_id: userId,
        stripe_account_id: null,
        has_account: false,
        onboarding_complete: false,
        can_use_reservations: false,
      };
    }

    const account = await this.stripe.accounts.retrieve(stripeAccountId);
    const onboardingComplete = account.details_submitted === true;
    const canUseReservations =
      account.charges_enabled === true && account.details_submitted === true;

    return {
      user_id: userId,
      stripe_account_id: stripeAccountId,
      has_account: true,
      onboarding_complete: onboardingComplete,
      can_use_reservations: canUseReservations,
    };
  }

  async expressAccount(body: CreateExpressAccountDto) {
    const userId = body.user_id;
    const profile = await this.userProfilesService.findById(userId);
    if (!profile) {
      throw new NotFoundException(`User profile with id ${userId} not found`);
    }

    let accountId = profile.stripe_account_id ?? undefined;

    if (!accountId) {
      const account = await this.stripe.accounts.create({
        type: "express",
        metadata: {
          user_id: userId.toString(),
        },
      });
      accountId = account.id;
      await this.userProfilesService.saveStripeAccountId(userId, accountId);
    }

    const returnUrl = `${envs.FRONTEND_URL}/mi-perfil-textos?selTab=tab8&stripe_connect=done`;
    const refreshUrl = `${envs.FRONTEND_URL}/mi-perfil-textos?selTab=tab8&stripe_connect=refresh`;

    const accountLink = await this.stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: refreshUrl,
      return_url: returnUrl,
    });

    return {
      account_id: accountId,
      onboarding_url: accountLink.url,
      user_id: userId,
    };
  }

  async createOrGetCustomer(email: string) {
    const customer = await this.stripe.customers.list({
      email,
    });
    if (customer.data.length > 0) {
      return customer.data[0];
    }
    return await this.stripe.customers.create({
      email,
    });
  }
}
