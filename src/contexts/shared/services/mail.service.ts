import { Injectable, Logger } from "@nestjs/common";
import nodemailer, { Transporter } from "nodemailer";

import { envs } from "../configs/envs";

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;

  constructor() {
    if (!envs.SMTP_PASS) {
      this.logger.warn("SMTP_PASS not set; mail sending disabled");
      this.transporter = null;
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: envs.SMTP_HOST,
      port: envs.SMTP_PORT,
      secure: envs.SMTP_SECURE,
      auth: {
        user: envs.SMTP_USER,
        pass: envs.SMTP_PASS,
      },
    });
  }

  isConfigured(): boolean {
    return this.transporter !== null;
  }

  async sendMail(options: SendMailOptions): Promise<boolean> {
    const to = options.to.trim();
    if (!to) {
      this.logger.warn("Missing recipient; skipping email");
      return false;
    }

    if (!this.transporter) {
      return false;
    }

    try {
      await this.transporter.sendMail({
        from: `"${envs.SMTP_FROM_NAME}" <${envs.SMTP_FROM}>`,
        replyTo: envs.SMTP_REPLY_TO,
        to,
        subject: options.subject,
        html: options.html,
        encoding: "utf8",
      });
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${to}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
