import type { Actor } from "@/contexts/payments/domain/audit-actor";
import type {
  SiteWizardState,
  WizardBookingSettingsPayload,
  WizardContentPayload,
  WizardDogPolicyPayload,
  WizardReviewPayload,
  WizardServicesPayload,
  WizardUnitsPayload,
} from "../types/site-wizard.types";

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";

import { InternalApiKeyGuard } from "@/shared/guards/internal-api-key.guard";

import { InvalidAdminActorError } from "@/contexts/reservations/utils/incident-admin.util";
import { SiteAuditService } from "@/contexts/site-history/services/site-audit.service";
import { orUndefined } from "@/contexts/site-history/utils/or-undefined.util";
import { siteActorFromHeaders } from "@/contexts/site-history/utils/site-audit-input.util";
import {
  SITE_AUDIT_ACTION,
  SITE_AUDIT_SOURCE,
  type SiteAuditAction,
} from "@/contexts/site-history/utils/site-change.util";

import { UpdateSitePropertyDto } from "../dto/update-site-property.dto";
import { SiteBookingSettingsWizardService } from "../services/site-booking-settings-wizard.service";
import { SiteContentWizardService } from "../services/site-content-wizard.service";
import { SiteDogPolicyWizardService } from "../services/site-dog-policy-wizard.service";
import { SiteReviewWizardService } from "../services/site-review-wizard.service";
import { SiteServicesWizardService } from "../services/site-services-wizard.service";
import { SiteUnitsWizardService } from "../services/site-units-wizard.service";
import { SiteWizardService } from "../services/site-wizard.service";
import {
  parseOptionalUserId,
  parsePublishInput,
} from "../utils/site-review.utils";
import {
  auditableBookingSettings,
  auditableContent,
  auditableMaxPets,
  auditableServices,
  auditableUnit,
  auditableUnitDogPolicy,
  findUnit,
  unitDogPolicyName,
} from "../utils/site-wizard-audit.utils";

type RequestHeaders = Record<string, unknown>;

@Controller({
  path: "wizard/sites",
  version: "1",
})
@UseGuards(InternalApiKeyGuard)
export class SiteWizardController {
  constructor(
    private readonly siteWizardService: SiteWizardService,
    private readonly siteUnitsWizardService: SiteUnitsWizardService,
    private readonly siteDogPolicyWizardService: SiteDogPolicyWizardService,
    private readonly siteServicesWizardService: SiteServicesWizardService,
    private readonly siteContentWizardService: SiteContentWizardService,
    private readonly siteBookingSettingsWizardService: SiteBookingSettingsWizardService,
    private readonly siteReviewWizardService: SiteReviewWizardService,
    private readonly siteAuditService: SiteAuditService,
  ) {}

  /** Host of the site, or the admin when admino sends x-actor-* headers. */
  private actor(headers: RequestHeaders, siteId: number): Actor {
    try {
      return siteActorFromHeaders(headers, siteId);
    } catch (error) {
      if (error instanceof InvalidAdminActorError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /** Runs a save and writes the changed fields to the site history. */
  private track<T>(
    siteId: number,
    headers: RequestHeaders,
    action: SiteAuditAction,
    read: () => Promise<unknown>,
    mutate: () => Promise<T>,
    metadata?: Record<string, unknown>,
  ): Promise<T> {
    return this.siteAuditService.track(
      {
        siteId,
        action,
        actor: this.actor(headers, siteId),
        source: SITE_AUDIT_SOURCE.WIZARD,
        metadata,
      },
      read,
      mutate,
    );
  }

  @Get(":siteId")
  getState(
    @Param("siteId", ParseIntPipe) siteId: number,
  ): Promise<SiteWizardState> {
    return this.siteWizardService.getState(siteId);
  }

  @Put(":siteId/property")
  updateProperty(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Body() dto: UpdateSitePropertyDto,
    @Headers() headers: RequestHeaders,
  ): Promise<SiteWizardState> {
    return this.track(
      siteId,
      headers,
      SITE_AUDIT_ACTION.PROPERTY_UPDATED,
      async () => {
        const state = await this.siteWizardService.getState(siteId);
        return state.property;
      },
      () => this.siteWizardService.updateProperty(siteId, dto),
    );
  }

  // Step 2 "Unidades". Bodies are `unknown` on purpose: the global
  // ValidationPipe skips them and parseUnitInput() returns "field: reason"
  // errors (including nested "board_options.1.price: ...").

  @Get(":siteId/units")
  listUnits(
    @Param("siteId", ParseIntPipe) siteId: number,
  ): Promise<WizardUnitsPayload> {
    return this.siteUnitsWizardService.list(siteId);
  }

  @Post(":siteId/units/confirm")
  @HttpCode(HttpStatus.OK)
  confirmUnits(
    @Param("siteId", ParseIntPipe) siteId: number,
  ): Promise<SiteWizardState> {
    return this.siteUnitsWizardService.confirm(siteId);
  }

  @Post(":siteId/units")
  async createUnits(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Body() body: unknown,
    @Headers() headers: RequestHeaders,
  ): Promise<WizardUnitsPayload> {
    const actor = this.actor(headers, siteId);
    const before = await this.siteUnitsWizardService
      .list(siteId)
      .then(payload => new Set(payload.units.map(unit => unit.id)))
      .catch(() => new Set<number>());
    const result = await this.siteUnitsWizardService.create(siteId, body);
    // One entry per created unit (the wizard may create several copies).
    for (const unit of result.units.filter(item => !before.has(item.id))) {
      await this.siteAuditService.record({
        siteId,
        action: SITE_AUDIT_ACTION.UNIT_CREATED,
        actor,
        source: SITE_AUDIT_SOURCE.WIZARD,
        before: {},
        after: auditableUnit(unit),
        metadata: { room_id: unit.id, room_name: unit.name },
      });
    }
    return result;
  }

  @Patch(":siteId/units/:roomId")
  async updateUnit(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Param("roomId", ParseIntPipe) roomId: number,
    @Body() body: unknown,
    @Headers() headers: RequestHeaders,
  ): Promise<WizardUnitsPayload> {
    const before = await orUndefined(
      this.siteUnitsWizardService
        .list(siteId)
        .then(payload => findUnit(payload, roomId)),
    );
    const result = await this.siteUnitsWizardService.update(
      siteId,
      roomId,
      body,
    );
    const after = findUnit(result, roomId);
    await this.siteAuditService.record({
      siteId,
      action: SITE_AUDIT_ACTION.UNIT_UPDATED,
      actor: this.actor(headers, siteId),
      source: SITE_AUDIT_SOURCE.WIZARD,
      before: auditableUnit(before),
      after: auditableUnit(after),
      metadata: { room_id: roomId, room_name: after?.name ?? before?.name },
    });
    return result;
  }

  @Delete(":siteId/units/:roomId")
  async removeUnit(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Param("roomId", ParseIntPipe) roomId: number,
    @Headers() headers: RequestHeaders,
  ): Promise<WizardUnitsPayload> {
    const actor = this.actor(headers, siteId);
    const before = await orUndefined(
      this.siteUnitsWizardService
        .list(siteId)
        .then(payload => findUnit(payload, roomId)),
    );
    const result = await this.siteUnitsWizardService.remove(siteId, roomId);
    // Units with future reservations stay as inactive instead of deleted.
    const remaining = findUnit(result, roomId);
    await this.siteAuditService.record({
      siteId,
      action: SITE_AUDIT_ACTION.UNIT_DELETED,
      actor,
      source: SITE_AUDIT_SOURCE.WIZARD,
      before: auditableUnit(before),
      after: remaining
        ? { ...auditableUnit(remaining), soft_deleted: true }
        : {},
      metadata: { room_id: roomId, room_name: before?.name ?? null },
      always: true,
    });
    return result;
  }

  // Step 3 "Perros". Bodies are `unknown` for the same reason as step 2:
  // dog-policy.utils returns "field: reason" errors (drafts allowed).

  @Get(":siteId/dog-policy")
  getDogPolicy(
    @Param("siteId", ParseIntPipe) siteId: number,
  ): Promise<WizardDogPolicyPayload> {
    return this.siteDogPolicyWizardService.get(siteId);
  }

  @Put(":siteId/dog-policy/max-pets")
  updateMaxPets(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Body() body: unknown,
    @Headers() headers: RequestHeaders,
  ): Promise<WizardDogPolicyPayload> {
    return this.track(
      siteId,
      headers,
      SITE_AUDIT_ACTION.DOG_MAX_PETS_UPDATED,
      async () =>
        auditableMaxPets(await this.siteDogPolicyWizardService.get(siteId)),
      () => this.siteDogPolicyWizardService.updateMaxPets(siteId, body),
    );
  }

  @Post(":siteId/dog-policy/confirm")
  @HttpCode(HttpStatus.OK)
  confirmDogPolicy(
    @Param("siteId", ParseIntPipe) siteId: number,
  ): Promise<SiteWizardState> {
    return this.siteDogPolicyWizardService.confirm(siteId);
  }

  @Put(":siteId/units/:roomId/dog-policy")
  updateUnitDogPolicy(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Param("roomId", ParseIntPipe) roomId: number,
    @Body() body: unknown,
    @Headers() headers: RequestHeaders,
  ): Promise<WizardDogPolicyPayload> {
    return this.trackUnitDogPolicy(
      siteId,
      roomId,
      headers,
      SITE_AUDIT_ACTION.UNIT_DOG_POLICY_UPDATED,
      () =>
        this.siteDogPolicyWizardService.updateUnitPolicy(siteId, roomId, body),
    );
  }

  @Post(":siteId/units/:roomId/dog-policy/copy")
  @HttpCode(HttpStatus.OK)
  copyUnitDogPolicy(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Param("roomId", ParseIntPipe) roomId: number,
    @Body() body: unknown,
    @Headers() headers: RequestHeaders,
  ): Promise<WizardDogPolicyPayload> {
    const fromRoomId =
      typeof body === "object" && body !== null && "from_room_id" in body
        ? Number((body as { from_room_id: unknown }).from_room_id)
        : null;
    return this.trackUnitDogPolicy(
      siteId,
      roomId,
      headers,
      SITE_AUDIT_ACTION.UNIT_DOG_POLICY_COPIED,
      () =>
        this.siteDogPolicyWizardService.copyUnitPolicy(siteId, roomId, body),
      { from_room_id: fromRoomId },
    );
  }

  private async trackUnitDogPolicy(
    siteId: number,
    roomId: number,
    headers: RequestHeaders,
    action: SiteAuditAction,
    mutate: () => Promise<WizardDogPolicyPayload>,
    metadata: Record<string, unknown> = {},
  ): Promise<WizardDogPolicyPayload> {
    const actor = this.actor(headers, siteId);
    const before = await orUndefined(
      this.siteDogPolicyWizardService.get(siteId),
    );
    const result = await mutate();
    await this.siteAuditService.record({
      siteId,
      action,
      actor,
      source: SITE_AUDIT_SOURCE.WIZARD,
      before: before ? auditableUnitDogPolicy(before, roomId) : undefined,
      after: auditableUnitDogPolicy(result, roomId),
      metadata: {
        room_id: roomId,
        room_name: unitDogPolicyName(result, roomId),
        ...metadata,
      },
    });
    return result;
  }

  // Step 4 "Servicios" (optional). Body `unknown` for the same reason as
  // steps 2-3: site-services.utils returns "field: reason" errors.

  @Get(":siteId/services")
  getServices(
    @Param("siteId", ParseIntPipe) siteId: number,
  ): Promise<WizardServicesPayload> {
    return this.siteServicesWizardService.get(siteId);
  }

  @Put(":siteId/services")
  updateServices(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Body() body: unknown,
    @Headers() headers: RequestHeaders,
  ): Promise<WizardServicesPayload> {
    return this.track(
      siteId,
      headers,
      SITE_AUDIT_ACTION.SERVICES_UPDATED,
      async () =>
        auditableServices(await this.siteServicesWizardService.get(siteId)),
      () => this.siteServicesWizardService.update(siteId, body),
    );
  }

  @Post(":siteId/services/confirm")
  @HttpCode(HttpStatus.OK)
  confirmServices(
    @Param("siteId", ParseIntPipe) siteId: number,
  ): Promise<SiteWizardState> {
    return this.siteServicesWizardService.confirm(siteId);
  }

  // Step 5 "Contenido": descriptions (photos are uploaded by PHP).

  @Get(":siteId/content")
  getContent(
    @Param("siteId", ParseIntPipe) siteId: number,
  ): Promise<WizardContentPayload> {
    return this.siteContentWizardService.get(siteId);
  }

  @Put(":siteId/content")
  updateContent(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Body() body: unknown,
    @Headers() headers: RequestHeaders,
  ): Promise<WizardContentPayload> {
    return this.track(
      siteId,
      headers,
      SITE_AUDIT_ACTION.CONTENT_UPDATED,
      async () =>
        auditableContent(await this.siteContentWizardService.get(siteId)),
      () => this.siteContentWizardService.update(siteId, body),
    );
  }

  @Post(":siteId/content/confirm")
  @HttpCode(HttpStatus.OK)
  confirmContent(
    @Param("siteId", ParseIntPipe) siteId: number,
  ): Promise<SiteWizardState> {
    return this.siteContentWizardService.confirm(siteId);
  }

  // Step 6 "Reservas": availability rule (Stripe via existing endpoints).

  @Get(":siteId/booking-settings")
  getBookingSettings(
    @Param("siteId", ParseIntPipe) siteId: number,
  ): Promise<WizardBookingSettingsPayload> {
    return this.siteBookingSettingsWizardService.get(siteId);
  }

  @Put(":siteId/booking-settings")
  updateBookingSettings(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Body() body: unknown,
    @Headers() headers: RequestHeaders,
  ): Promise<WizardBookingSettingsPayload> {
    return this.track(
      siteId,
      headers,
      SITE_AUDIT_ACTION.BOOKING_SETTINGS_UPDATED,
      async () =>
        auditableBookingSettings(
          await this.siteBookingSettingsWizardService.get(siteId),
        ),
      () => this.siteBookingSettingsWizardService.update(siteId, body),
    );
  }

  @Post(":siteId/booking-settings/confirm")
  @HttpCode(HttpStatus.OK)
  confirmBookingSettings(
    @Param("siteId", ParseIntPipe) siteId: number,
  ): Promise<SiteWizardState> {
    return this.siteBookingSettingsWizardService.confirm(siteId);
  }

  // Step 7 "Revisión": checklist, Dog Friendly Score, submission.

  @Get(":siteId/review")
  getReview(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Query("user_id") userId?: string,
  ): Promise<WizardReviewPayload> {
    return this.siteReviewWizardService.get(
      siteId,
      parseOptionalUserId(userId),
    );
  }

  @Post(":siteId/publish")
  @HttpCode(HttpStatus.OK)
  async publish(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Body() body: unknown,
    @Headers() headers: RequestHeaders,
  ): Promise<WizardReviewPayload> {
    const actor = this.actor(headers, siteId);
    const result = await this.siteReviewWizardService.publish(siteId, body);
    const input = parsePublishInput(body);
    await this.siteAuditService.record({
      siteId,
      action: SITE_AUDIT_ACTION.PUBLISHED,
      actor,
      source: SITE_AUDIT_SOURCE.WIZARD,
      after: input.ok
        ? {
            terms_version: input.value.terms_version,
            terms_accepted_by: input.value.user_id,
          }
        : {},
      always: true,
    });
    return result;
  }
}
