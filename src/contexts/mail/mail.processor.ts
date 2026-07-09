import type { SendMailOptions } from "@/shared/services/mail.service";

import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Job } from "bullmq";

import { envs } from "@/shared/configs/envs";
import { MailService } from "@/shared/services/mail.service";

@Injectable()
@Processor(envs.MAIL_QUEUE_NAME)
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly mailService: MailService) {
    super();
  }

  async process(job: Job<SendMailOptions>): Promise<void> {
    const { to } = job.data;

    try {
      const sent = await this.mailService.sendMail(job.data);

      if (!sent) {
        throw new Error(`Mail not sent to ${to}`);
      }

      this.logger.log(`Email sent to ${to} (job ${job.id})`);
    } catch (error) {
      this.logger.error(
        `Failed to process mail job ${job.id} for ${to}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
