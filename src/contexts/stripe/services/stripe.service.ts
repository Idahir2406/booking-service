import type { ReservationEntity } from "../../reservations/entities/reservation.entity";
import type { ReservationService } from "../../reservations/services/reservation.service";

import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import Stripe from "stripe";

import { Site } from "@/src/types/site.types";

import { buildStripeLineItems } from "../../payments/domain/stripe-line-items";
import { expectedChargeCents } from "../../reservations/utils/reservation-amount.util";
import { resolveCheckoutExpiry } from "../../reservations/utils/reservation-policy.util";
import { envs } from "../../shared/configs/envs";
import { MysqlService } from "../../shared/services/mysql.service";
import { CreateDashboardLinkDto } from "../dto/create-dashboard-link.dto";
import {
  CreateExpressAccountDto,
  EXPRESS_ACCOUNT_RETURN_TO,
} from "../dto/create-express-account.dto";
import { CreateSitePaymentIntentDto } from "../dto/create-site-payment-intent.dto";
import { StripeConnectStatusDto } from "../dto/stripe-connect-status.dto";
import {
  reservationTransferGroup,
  stripeIdempotencyKeys,
} from "../utils/stripe-idempotency.util";
import { UserProfilesService } from "./user-profiles.service";

// stripe v22 CJS typings don't expose resource types on the default export
// namespace; derive them from the client methods instead.
type StripeClient = Stripe.Stripe;
export type StripeTransfer = Awaited<
  ReturnType<StripeClient["transfers"]["list"]>
>["data"][number];
export type StripeRefund = Awaited<
  ReturnType<StripeClient["refunds"]["create"]>
>;
type StripeRefundCreateParams = NonNullable<
  Parameters<StripeClient["refunds"]["create"]>[0]
>;

export interface TransferHostPayoutInput {
  reservationId: number;
  paymentIntentId: string;
  hostUserId: number;
  totalPaidCents: number;
  /**
   * Platform fee frozen on the reservation (F1 commission_cents/rate).
   * Omitted only for legacy callers: falls back to COMMISSION_PERCENTAGE.
   */
  platformFeeCents?: number;
}

/** pay-pending: what the traveler pay route needs from a Checkout Session. */
export interface CheckoutSessionState {
  id: string;
  /** "open" | "complete" | "expired" (null if Stripe omits it). */
  status: string | null;
  url: string | null;
  expires_at: Date;
}

export interface ReplacementCheckoutSessionInput {
  reservation: ReservationEntity;
  /** Session being replaced (null when the reservation had none). */
  replacedSessionId: string | null;
  /** Unix seconds; the caller guarantees <= reservation.expiration_date. */
  expiresAtUnix: number;
}

function isStripeResourceMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "resource_missing"
  );
}

export interface RefundPaymentIntentInput {
  reservationId: number;
  /** 1-based sequence of refunds created by us for this reservation. */
  sequence: number;
  paymentIntentId: string;
  amountCents?: number;
  reason?: string;
}

@Injectable()
export class StripeService {
  private readonly stripe: StripeClient;

  constructor(
    private readonly mysqlService: MysqlService,
    @Inject(
      forwardRef(
        () =>
          // Circular StripeModule <-> ReservationModule (pre-existing pattern).
          // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-return, node/no-missing-require
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

  /**
   * Platform endpoint secret first; Connect events (host accounts:
   * account.updated, payout.failed/paid) come from a Connect endpoint with
   * its own secret (STRIPE_CONNECT_WEBHOOK_SECRET), same URL.
   */
  constructWebhookEvent(rawBody: Buffer, signature: string) {
    try {
      return this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        envs.STRIPE_WEBHOOK_SECRET,
      );
    } catch (error) {
      if (!envs.STRIPE_CONNECT_WEBHOOK_SECRET) {
        throw error;
      }
      return this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        envs.STRIPE_CONNECT_WEBHOOK_SECRET,
      );
    }
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

    // F2: charged amount = total_cents (sum of the frozen price lines).
    this.assertPositiveCharge(reservation);

    // Session expiry == reservation expiry (single TTL config). If the stored
    // expiry is already too close for Stripe's 30-min minimum, push both.
    const expiry = resolveCheckoutExpiry(new Date(reservation.expiration_date));
    if (
      expiry.expirationDate.getTime() !==
      new Date(reservation.expiration_date).getTime()
    ) {
      await this.reservationService.updateExpirationDate(
        reservation.id,
        expiry.expirationDate,
      );
    }

    const checkoutSession = await this.createReservationCheckoutSession(
      reservation,
      site,
      body.email,
      expiry.expiresAtUnix,
      stripeIdempotencyKeys.checkoutSession(reservation.id),
    );

    await this.reservationService.saveStripeCheckoutSessionId(
      reservation.id,
      checkoutSession.id,
    );

    return {
      url: checkoutSession.url,
      session_id: checkoutSession.id,
      expires_at: expiry.expirationDate,
    };
  }

  /**
   * pay-pending: current state of a reservation's Checkout Session, or null
   * when Stripe no longer knows it (resource_missing). Other errors throw.
   */
  async retrieveCheckoutSessionState(
    sessionId: string,
  ): Promise<CheckoutSessionState | null> {
    try {
      const session = await this.stripe.checkout.sessions.retrieve(sessionId);
      return {
        id: session.id,
        status: session.status ?? null,
        url: session.url ?? null,
        expires_at: new Date(session.expires_at * 1000),
      };
    } catch (error) {
      if (isStripeResourceMissing(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * pay-pending: NEW Checkout Session for the SAME pending reservation (the
   * previous one expired or is missing). Same frozen amounts and line items
   * as the original (no repricing), `expires_at` given by the caller (never
   * beyond reservation.expiration_date). Does NOT persist the session id:
   * the caller swaps it with a compare-and-set.
   */
  async createReplacementCheckoutSession(
    input: ReplacementCheckoutSessionInput,
  ): Promise<{ url: string | null; session_id: string; expires_at: Date }> {
    const reservation = input.reservation;
    if (
      reservation.status !== "pending" ||
      reservation.payment_status !== "pending"
    ) {
      throw new BadRequestException(
        `Reservation ${reservation.id} is not pending payment`,
      );
    }
    this.assertPositiveCharge(reservation);
    const email = String(reservation.guest_email ?? "").trim();
    if (email === "") {
      throw new BadRequestException(
        `Reservation ${reservation.id} has no guest email`,
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
    const session = await this.createReservationCheckoutSession(
      reservation,
      site,
      email,
      input.expiresAtUnix,
      stripeIdempotencyKeys.checkoutSessionRetry(
        reservation.id,
        input.replacedSessionId,
      ),
    );
    return {
      url: session.url,
      session_id: session.id,
      expires_at: new Date(input.expiresAtUnix * 1000),
    };
  }

  /** Best effort: closes a session nobody should pay (lost compare-and-set). */
  async expireCheckoutSessionQuietly(sessionId: string): Promise<void> {
    try {
      await this.stripe.checkout.sessions.expire(sessionId);
    } catch {
      // Already expired/complete or unreachable: the payment webhook still
      // refunds a duplicate payment (activateFromPayment).
    }
  }

  private assertPositiveCharge(reservation: ReservationEntity): void {
    if (expectedChargeCents(reservation) <= 0) {
      throw new BadRequestException(
        `Reservation ${reservation.id} has invalid payment amount`,
      );
    }
  }

  /**
   * The ONE place a reservation Checkout Session is built: line items come
   * from the frozen price lines and sum exactly expectedChargeCents (F2).
   */
  private async createReservationCheckoutSession(
    reservation: ReservationEntity,
    site: Site,
    email: string,
    expiresAtUnix: number,
    idempotencyKey: string,
  ) {
    const amountCents = expectedChargeCents(reservation);
    const customer = await this.createOrGetCustomer(email, reservation.id);
    const webBase = envs.FRONTEND_URL.replace(/\/+$/, "");

    // F2: one Stripe line item per price line (Spanish names). The builder
    // guarantees SUM(items) === amountCents or falls back to a single item.
    const priceLines = await this.reservationService.getPriceLines(
      reservation.id,
    );
    const { line_items: lineItems } = buildStripeLineItems(
      priceLines,
      amountCents,
      envs.CURRENCY.toLowerCase(),
      site.name ?? "Pago de alojamiento",
    );

    return this.stripe.checkout.sessions.create(
      {
        line_items: lineItems,
        metadata: {
          reservation_id: reservation.id.toString(),
        },
        payment_intent_data: {
          // Charges/disputes inherit PI metadata -> reservation lookup without DB join.
          metadata: {
            reservation_id: reservation.id.toString(),
            total_cents: amountCents.toString(),
          },
          transfer_group: reservationTransferGroup(reservation.id),
        },
        customer: customer.id,
        expires_at: expiresAtUnix,
        success_url: `${webBase}/reserva-exito?session_id={CHECKOUT_SESSION_ID}&reservation_id=${reservation.id}`,
        cancel_url: `${webBase}/reserva-cancelada?site_id=${reservation.site_id}&reservation_id=${reservation.id}`,
        currency: envs.CURRENCY,
        mode: "payment",
      },
      { idempotencyKey },
    );
  }

  /**
   * Host ownership check for host-facing Stripe routes (called via the PHP
   * proxy with site_id/user_id taken from the PHP session).
   * Sites are linked to users by `sites1.user_id`; legacy sites have
   * user_id = 0 and are linked by email (same rule as uslogin_verification.php).
   */
  async assertUserOwnsSite(userId: number, siteId: number): Promise<void> {
    const site = await this.mysqlService.queryOne<
      Pick<Site, "id" | "email" | "email2"> & { user_id?: number | null }
    >(
      `SELECT id, user_id, email, email2 FROM ${envs.DB_PREFIX}sites1 WHERE id = ?`,
      [siteId],
    );
    if (!site) {
      throw new NotFoundException(`Site with id ${siteId} not found`);
    }
    const ownerId = Number(site.user_id ?? 0);
    if (ownerId > 0) {
      if (ownerId !== userId) {
        throw new ForbiddenException("Site access denied");
      }
      return;
    }

    const profile = await this.userProfilesService.findById(userId);
    const email = String(profile?.email ?? "")
      .trim()
      .toLowerCase();
    const siteEmails = [site.email, site.email2]
      .map(value =>
        String(value ?? "")
          .trim()
          .toLowerCase(),
      )
      .filter(value => value !== "");
    if (email === "" || !siteEmails.includes(email)) {
      throw new ForbiddenException("Site access denied");
    }
  }

  async getConnectStatus(
    userId: number,
    siteId?: number,
  ): Promise<StripeConnectStatusDto> {
    if (siteId !== undefined) {
      await this.assertUserOwnsSite(userId, siteId);
    }

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
    if (body.site_id !== undefined) {
      await this.assertUserOwnsSite(userId, body.site_id);
    }

    const profile = await this.userProfilesService.findById(userId);
    if (!profile) {
      throw new NotFoundException(`User profile with id ${userId} not found`);
    }

    let accountId = profile.stripe_account_id ?? undefined;

    if (!accountId) {
      const account = await this.stripe.accounts.create(
        {
          type: "express",
          metadata: {
            user_id: userId.toString(),
          },
        },
        { idempotencyKey: stripeIdempotencyKeys.expressAccount(userId) },
      );
      accountId = account.id;
      await this.userProfilesService.saveStripeAccountId(userId, accountId);
    }

    const webBase = (envs.BOOKING_WEB_URL ?? envs.FRONTEND_URL).replace(
      /\/+$/,
      "",
    );
    const returnPath =
      body.return_to === EXPRESS_ACCOUNT_RETURN_TO.WIZARD
        ? "registrar-alojamiento?"
        : "mi-perfil-textos?selTab=tab8&";
    const returnUrl = `${webBase}/${returnPath}stripe_connect=done`;
    const refreshUrl = `${webBase}/${returnPath}stripe_connect=refresh`;

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

  /**
   * Single-use login link to the host's Stripe Express Dashboard (balance,
   * transfers from V4P, payouts to the bank). Stripe only issues it once
   * onboarding details are submitted.
   */
  async createDashboardLoginLink(body: CreateDashboardLinkDto) {
    const userId = body.user_id;
    if (body.site_id !== undefined) {
      await this.assertUserOwnsSite(userId, body.site_id);
    }

    const profile = await this.userProfilesService.findById(userId);
    if (!profile) {
      throw new NotFoundException(`User profile with id ${userId} not found`);
    }

    const accountId = profile.stripe_account_id ?? null;
    if (!accountId) {
      throw new BadRequestException("stripe_account_missing");
    }

    const account = await this.stripe.accounts.retrieve(accountId);
    if (!account.details_submitted) {
      throw new BadRequestException("stripe_onboarding_incomplete");
    }

    const loginLink = await this.stripe.accounts.createLoginLink(accountId);
    return { url: loginLink.url, user_id: userId };
  }

  async createOrGetCustomer(email: string, reservationId: number) {
    const customer = await this.stripe.customers.list({
      email,
      limit: 1,
    });
    const existing = customer.data.at(0);
    if (existing) {
      return existing;
    }
    return await this.stripe.customers.create(
      { email },
      {
        idempotencyKey: stripeIdempotencyKeys.checkoutCustomer(reservationId),
      },
    );
  }

  /**
   * Transfer already sent for this reservation (looked up by transfer_group),
   * so a transfer that succeeded but was not persisted is never re-sent even
   * after the 24 h idempotency-key window.
   */
  async findExistingTransfer(
    reservationId: number,
  ): Promise<StripeTransfer | null> {
    const list = await this.stripe.transfers.list({
      transfer_group: reservationTransferGroup(reservationId),
      limit: 10,
    });
    const active = list.data.find(transfer => !transfer.reversed);
    return active ?? null;
  }

  async transferHostPayout(
    input: TransferHostPayoutInput,
  ): Promise<StripeTransfer | null> {
    const existing = await this.findExistingTransfer(input.reservationId);
    if (existing) {
      return existing;
    }

    const profile = await this.userProfilesService.findById(input.hostUserId);
    const destination = profile?.stripe_account_id;
    if (!destination) {
      throw new BadRequestException(
        `Host user ${input.hostUserId} has no Stripe account`,
      );
    }

    const platformFeeCents =
      input.platformFeeCents ??
      Math.round(input.totalPaidCents * envs.COMMISSION_PERCENTAGE);
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

    return this.stripe.transfers.create(
      {
        amount: hostAmountCents,
        currency: envs.CURRENCY.toLowerCase(),
        destination,
        source_transaction: chargeId,
        transfer_group: reservationTransferGroup(input.reservationId),
        metadata: {
          reservation_id: input.reservationId.toString(),
          platform_fee_cents: platformFeeCents.toString(),
        },
      },
      { idempotencyKey: stripeIdempotencyKeys.transfer(input.reservationId) },
    );
  }

  async refundPaymentIntent(
    input: RefundPaymentIntentInput,
  ): Promise<StripeRefund> {
    const params: StripeRefundCreateParams = {
      payment_intent: input.paymentIntentId,
      metadata: {
        reservation_id: input.reservationId.toString(),
        refund_seq: input.sequence.toString(),
        ...(input.reason ? { reason: input.reason } : {}),
      },
    };
    if (input.amountCents !== undefined && input.amountCents > 0) {
      params.amount = input.amountCents;
    }
    return this.stripe.refunds.create(params, {
      idempotencyKey: stripeIdempotencyKeys.refund(
        input.reservationId,
        input.sequence,
      ),
    });
  }
}
