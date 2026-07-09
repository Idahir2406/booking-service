import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { envs } from "../shared/configs/envs";
import { MailService } from "../shared/services/mail.service";
import { MailController } from "./mail.controller";
import { MailProcessor } from "./mail.processor";
import { MailQueueService } from "./mail-queue.service";

@Module({
  imports: [
    BullModule.registerQueue({
      name: envs.MAIL_QUEUE_NAME,
    }),
  ],
  controllers: [MailController],
  providers: [MailService, MailQueueService, MailProcessor],
  exports: [MailQueueService],
})
export class MailModule {}
