import { Injectable } from "@nestjs/common";
import Stripe from "stripe";

@Injectable()
export class ExpressAccountsService {
  // constructor() {}

  // async handleAccountUpdated(body: Stripe.Stripe["account.updated"]) {
  //   const account = body.data.object as Stripe.Stripe["accounts"];
  //   console.log(body);
  //   console.log(`account: ${JSON.stringify(account)}`);
  // }
}