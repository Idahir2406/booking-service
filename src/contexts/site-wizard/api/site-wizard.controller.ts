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
  Body,
  Controller,
  Delete,
  Get,
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

import { UpdateSitePropertyDto } from "../dto/update-site-property.dto";
import { SiteBookingSettingsWizardService } from "../services/site-booking-settings-wizard.service";
import { SiteContentWizardService } from "../services/site-content-wizard.service";
import { SiteDogPolicyWizardService } from "../services/site-dog-policy-wizard.service";
import { SiteReviewWizardService } from "../services/site-review-wizard.service";
import { SiteServicesWizardService } from "../services/site-services-wizard.service";
import { SiteUnitsWizardService } from "../services/site-units-wizard.service";
import { SiteWizardService } from "../services/site-wizard.service";
import { parseOptionalUserId } from "../utils/site-review.utils";

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
  ) {}

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
  ): Promise<SiteWizardState> {
    return this.siteWizardService.updateProperty(siteId, dto);
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
  createUnits(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Body() body: unknown,
  ): Promise<WizardUnitsPayload> {
    return this.siteUnitsWizardService.create(siteId, body);
  }

  @Patch(":siteId/units/:roomId")
  updateUnit(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Param("roomId", ParseIntPipe) roomId: number,
    @Body() body: unknown,
  ): Promise<WizardUnitsPayload> {
    return this.siteUnitsWizardService.update(siteId, roomId, body);
  }

  @Delete(":siteId/units/:roomId")
  removeUnit(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Param("roomId", ParseIntPipe) roomId: number,
  ): Promise<WizardUnitsPayload> {
    return this.siteUnitsWizardService.remove(siteId, roomId);
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
  ): Promise<WizardDogPolicyPayload> {
    return this.siteDogPolicyWizardService.updateMaxPets(siteId, body);
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
  ): Promise<WizardDogPolicyPayload> {
    return this.siteDogPolicyWizardService.updateUnitPolicy(
      siteId,
      roomId,
      body,
    );
  }

  @Post(":siteId/units/:roomId/dog-policy/copy")
  @HttpCode(HttpStatus.OK)
  copyUnitDogPolicy(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Param("roomId", ParseIntPipe) roomId: number,
    @Body() body: unknown,
  ): Promise<WizardDogPolicyPayload> {
    return this.siteDogPolicyWizardService.copyUnitPolicy(siteId, roomId, body);
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
  ): Promise<WizardServicesPayload> {
    return this.siteServicesWizardService.update(siteId, body);
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
  ): Promise<WizardContentPayload> {
    return this.siteContentWizardService.update(siteId, body);
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
  ): Promise<WizardBookingSettingsPayload> {
    return this.siteBookingSettingsWizardService.update(siteId, body);
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
  publish(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Body() body: unknown,
  ): Promise<WizardReviewPayload> {
    return this.siteReviewWizardService.publish(siteId, body);
  }
}
