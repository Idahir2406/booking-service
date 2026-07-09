import type { SendMailOptions } from "@/shared/services/mail.service";

import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";

import { envs } from "@/shared/configs/envs";
import { MailService } from "@/shared/services/mail.service";

import { MAIL_JOB_SEND } from "./mail.constants";

export interface EnqueueMailResult {
  queued: boolean;
  jobId?: string;
}

@Injectable()
export class MailQueueService {
  private readonly logger = new Logger(MailQueueService.name);

  constructor(
    @InjectQueue(envs.MAIL_QUEUE_NAME) private readonly mailQueue: Queue,
    private readonly mailService: MailService,
  ) {}

  async enqueue(options: SendMailOptions): Promise<EnqueueMailResult> {
    if (!this.mailService.isConfigured()) {
      this.logger.warn("SMTP not configured; skipping mail enqueue");
      return { queued: false };
    }

    try {
      const job = await this.mailQueue.add(MAIL_JOB_SEND, options, {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
      });

      return { queued: true, jobId: job.id };
    } catch (error) {
      this.logger.error(
        `Failed to enqueue email to ${options.to}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { queued: false };
    }
  }
}
