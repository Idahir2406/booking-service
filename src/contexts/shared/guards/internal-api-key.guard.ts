import { createHash, timingSafeEqual } from "node:crypto";

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";

import { envs } from "../configs/envs";

export const INTERNAL_API_KEY_HEADER = "x-internal-key";

// Hash both sides to a fixed length so timingSafeEqual never throws on
// length mismatch and the comparison does not leak the key length.
function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function isValidInternalKey(
  provided: unknown,
  expected: string,
): boolean {
  if (typeof provided !== "string" || provided.length === 0) {
    return false;
  }
  return timingSafeEqual(digest(provided), digest(expected));
}

/**
 * Server-to-server guard (PHP web -> booking). Apply per controller or per
 * route with @UseGuards(InternalApiKeyGuard). Since F0 every route is guarded
 * except the explicit public list asserted in
 * tests/unit/contexts/shared/guard-coverage.test.ts (traveler checkout,
 * feedback by token, Stripe webhook, health).
 */
@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers[INTERNAL_API_KEY_HEADER];

    if (!isValidInternalKey(provided, envs.INTERNAL_API_KEY)) {
      throw new UnauthorizedException("invalid internal api key");
    }
    return true;
  }
}
