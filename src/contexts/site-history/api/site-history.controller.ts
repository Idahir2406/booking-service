import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { InternalApiKeyGuard } from "@/shared/guards/internal-api-key.guard";

import { InvalidAdminActorError } from "@/contexts/reservations/utils/incident-admin.util";

import { SiteAuditService } from "../services/site-audit.service";
import { SiteHistoryService } from "../services/site-history.service";
import {
  parsePhpSiteAudit,
  phpAuditActorMatches,
  siteActorFromHeaders,
} from "../utils/site-audit-input.util";

function optionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new BadRequestException("limit must be an integer");
  }
  return parsed;
}

/**
 * Accommodation change history. Host routes: the PHP proxy takes the site
 * from the session. POST audit: PHP writers (legacy profile, photos, admino).
 */
@Controller({ path: "sites", version: "1" })
@UseGuards(InternalApiKeyGuard)
export class SiteHistoryController {
  constructor(
    private readonly historyService: SiteHistoryService,
    private readonly auditService: SiteAuditService,
  ) {}

  @Get(":siteId/history")
  history(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Query("limit") limit?: string,
    @Query("before") before?: string,
  ) {
    return this.historyService.get(siteId, "host", {
      limit: optionalInt(limit),
      before,
    });
  }

  @Post(":siteId/audit")
  @HttpCode(HttpStatus.OK)
  async audit(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Body() body: unknown,
    @Headers() headers: Record<string, unknown>,
  ): Promise<{ recorded: boolean }> {
    const parsed = parsePhpSiteAudit(body);
    if (!parsed.ok) {
      throw new BadRequestException(parsed.error);
    }
    let actor;
    try {
      actor = siteActorFromHeaders(headers, siteId);
    } catch (error) {
      if (error instanceof InvalidAdminActorError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    if (!phpAuditActorMatches(parsed.value, actor)) {
      throw new BadRequestException("source does not match the actor");
    }
    const recorded = await this.auditService.record({
      siteId,
      action: parsed.value.action,
      actor,
      source: parsed.value.source,
      before: parsed.value.before,
      after: parsed.value.after,
      metadata: parsed.value.subject ? { subject: parsed.value.subject } : {},
    });
    return { recorded };
  }
}

/** V4P read route (admino proxy, X-Internal-Key). */
@Controller({ path: "admin/sites", version: "1" })
@UseGuards(InternalApiKeyGuard)
export class SiteHistoryAdminController {
  constructor(private readonly historyService: SiteHistoryService) {}

  @Get(":siteId/history")
  history(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Query("limit") limit?: string,
    @Query("before") before?: string,
  ) {
    return this.historyService.get(siteId, "admin", {
      limit: optionalInt(limit),
      before,
    });
  }
}
