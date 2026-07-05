import type { ReservationService } from "../../reservations/services/reservation.service";

import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import Stripe from "stripe";

import { Site } from "@/src/types/site.types";

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
    @Inject(
      forwardRef(
        () =>
          require("../../reservations/services/reservation.service")
            .ReservationService,
      ),
    )
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
      success_url: `${envs.FRONTEND_URL.replace(/\/+$/, "")}/reserva-exito?session_id={CHECKOUT_SESSION_ID}&reservation_id=${reservation.id}`,
      cancel_url: `${envs.FRONTEND_URL.replace(/\/+$/, "")}/reserva-cancelada?site_id=${reservation.site_id}&reservation_id=${reservation.id}`,
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
    const onboardingComplete = account.details_submitted;
    const canUseReservations =
      account.charges_enabled && account.details_submitted;

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

  async transferHostPayout(input: {
    paymentIntentId: string;
    hostUserId: number;
    totalPaidCents: number;
  }) {
    const profile = await this.userProfilesService.findById(input.hostUserId);
    const destination = profile?.stripe_account_id;
    if (!destination) {
      throw new BadRequestException(
        `Host user ${input.hostUserId} has no Stripe account`,
      );
    }

    const platformFeeCents = Math.round(
      input.totalPaidCents * envs.COMMISSION_PERCENTAGE,
    );
    const hostAmountCents = input.totalPaidCents - platformFeeCents;
    if (hostAmountCents <= 0) {
      return null;
    }

    const paymentIntent = await this.stripe.paymentIntents.retrieve(
      input.paymentIntentId,
    );
    const chargeId =
      typeof paymentIntent.latest_charge === "string"
        ? paymentIntent.latest_charge
        : paymentIntent.latest_charge?.id;

    if (!chargeId) {
      throw new BadRequestException(
        `PaymentIntent ${input.paymentIntentId} has no charge`,
      );
    }

    return this.stripe.transfers.create({
      amount: hostAmountCents,
      currency: envs.CURRENCY.toLowerCase(),
      destination,
      source_transaction: chargeId,
    });
  }
}
