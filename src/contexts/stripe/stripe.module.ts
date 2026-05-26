import { DynamicModule, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { MysqlService } from "../shared/services/mysql.service";
import { StripeController } from "./api/stripe.controller";
import { StripeService } from "./services/stripe.service";

@Module({
  controllers: [StripeController],
  providers: [StripeService, MysqlService],
  exports: [StripeService],
})
export class StripeModule {}
