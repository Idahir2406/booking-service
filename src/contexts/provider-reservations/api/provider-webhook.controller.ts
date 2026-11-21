import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import type { ProviderWebhookResponse } from "../services/provider-webhook.service";

import {
  BadRequestException,
  Controller,
  HttpCode,
  Post,
  Req,
} from "@nestjs/common";

import { ProviderWebhookService } from "../services/provider-webhook.service";

/** Fallback when the raw parser did not run (should not happen). */
function bodyAsBuffer(body: unknown): Buffer | null {
  if (Buffer.isBuffer(body)) {
    return body;
  }
  return body === undefined ? null : Buffer.from(JSON.stringify(body));
}

/**
 * Public Nuitee/LiteAPI webhook (no internal key: the provider calls it).
 * main.ts mounts express.raw on this path so the signature is computed on
 * the exact bytes received.
 */
@Controller({
  path: "providers/nuitee",
  version: "1",
})
export class ProviderWebhookController {
  constructor(private readonly webhookService: ProviderWebhookService) {}

  @Post("webhook")
  @HttpCode(200)
  handle(
    @Req() req: RawBodyRequest<Request>,
  ): Promise<ProviderWebhookResponse> {
    const rawBody = req.rawBody ?? bodyAsBuffer(req.body);
    if (!rawBody || rawBody.length === 0) {
      throw new BadRequestException("Empty webhook body");
    }
    return this.webhookService.handle({ rawBody, headers: req.headers });
  }
}
