import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import Stripe from "stripe";

import { Site } from "@/src/types/site.types";

import { envs } from "../../shared/configs/envs";
import { MysqlService } from "../../shared/services/mysql.service";
import { textToNumberFormatter } from "../../shared/text-to-number.formatter";
import { CreateSitePaymentIntentDto } from "../dto/create-site-payment-intent.dto";

@Injectable()
export class StripeService {
  private readonly stripe: Stripe.Stripe;
  private readonly logger = new Logger(StripeService.name);

  constructor(private readonly mysqlService: MysqlService) {
    this.stripe = new Stripe(envs.STRIPE_API_KEY, {
      apiVersion: "2026-04-22.dahlia", // Use latest API version, or "null" for your default
    });
  }

  async createSitePaymentLink(body: CreateSitePaymentIntentDto) {
    const customer = await this.createOrGetCustomer(body.email);
    const site = await this.mysqlService.queryOne<Site>(
      `SELECT * FROM ${envs.DB_PREFIX}sites1 WHERE id = ?`,
      [body.site_id],
    );
    if (!site) {
      throw new NotFoundException(`Site with id ${body.site_id} not found`);
    }
    if (!site.precio) {
      throw new BadRequestException("Site price is not set");
    }

    //price in euro
    const price = textToNumberFormatter(site.precio);

    const checkoutSession = await this.stripe.checkout.sessions.create({
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: envs.CURRENCY,
            product_data: {
              name: site.name ?? "Pago de alojamiento",
            },
            unit_amount: price * 100,
          },
        },
      ],
      customer: customer.id,
      success_url: `${envs.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${envs.FRONTEND_URL}/cancel`,
      currency: envs.CURRENCY,
      mode: "payment",
    });

    return checkoutSession;
  }

  async expressAccount() {
    const account = await this.stripe.accounts.create({
      type: "express",
    });

    const accountLink = await this.stripe.accountLinks.create({
      account: account.id,
      type: "account_onboarding",
      refresh_url: `${envs.FRONTEND_URL}/refresh-account`,
      return_url: `${envs.FRONTEND_URL}/return-account`,
    });
    return {
      account_id: account.id,
      onboarding_url: accountLink.url,
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
