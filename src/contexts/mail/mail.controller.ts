import { Body, Controller, ForbiddenException, Post } from "@nestjs/common";

import { envs } from "../shared/configs/envs";
import { SendTestMailDto } from "./dto/send-test-mail.dto";
import { MailQueueService } from "./mail-queue.service";

@Controller({
  path: "mail",
  version: "1",
})
export class MailController {
  constructor(private readonly mailQueueService: MailQueueService) {}

  @Post("test")
  async sendTest(@Body() dto: SendTestMailDto) {
    // if (envs.NODE_ENV === "production") {
    //   throw new ForbiddenException(
    //     "Mail test endpoint is disabled in production",
    //   );
    // }
    console.log("envs", envs);

    const to = dto.to ?? envs.BOOKING_DEV_EMAIL;
    const subject = dto.subject ?? "Test email booking API";
    const html =
      dto.html ??
      `<p>Test email from booking API at ${new Date().toISOString()}</p>`;

    const result = await this.mailQueueService.enqueue({
      to,
      subject,
      html,
    });

    return {
      ok: result.queued,
      queued: result.queued,
      jobId: result.jobId ?? null,
      to,
    };
  }
}
