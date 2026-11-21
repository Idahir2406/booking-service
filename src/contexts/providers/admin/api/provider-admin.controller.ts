import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";

import {
  InvalidAdminActorError,
  parseAdminActorHeaders,
} from "../../../reservations/utils/incident-admin.util";
import { InternalApiKeyGuard } from "../../../shared/guards/internal-api-key.guard";
import {
  ImagesImportedDto,
  ImportProviderHotelDto,
  LinkProviderHotelDto,
  ListProviderSitesQueryDto,
  SearchProviderHotelsQueryDto,
  UnlinkProviderSiteDto,
  UpdateProviderPetsDto,
  UpdateProviderStatusDto,
} from "../dto/provider-admin.dto";
import {
  type AdminActorRef,
  ProviderAdminService,
} from "../services/provider-admin.service";

const HOTEL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function actorFrom(headers: Record<string, unknown>): AdminActorRef | null {
  try {
    const actor = parseAdminActorHeaders(headers);
    return actor ? { name: actor.name } : null;
  } catch (error) {
    if (error instanceof InvalidAdminActorError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}

/**
 * Admin import/link of provider hotels (plan phase 2, cases A and B).
 * Only caller: web/admino/php/admOps_api.php (X-Internal-Key + optional
 * x-actor-name on mutations), same pattern as admin/reservations.
 */
@Controller({
  path: "admin/providers/nuitee",
  version: "1",
})
@UseGuards(InternalApiKeyGuard)
export class ProviderAdminController {
  constructor(private readonly service: ProviderAdminService) {}

  @Get("hotels/search")
  search(@Query() query: SearchProviderHotelsQueryDto) {
    return this.service.searchHotels(query);
  }

  @Get("hotels/:hotelId")
  hotel(@Param("hotelId") hotelId: string) {
    if (!HOTEL_ID_PATTERN.test(hotelId)) {
      throw new BadRequestException("invalid hotel id");
    }
    return this.service.getHotel(hotelId);
  }

  @Post("import")
  @HttpCode(200)
  import(
    @Body() dto: ImportProviderHotelDto,
    @Headers() headers: Record<string, unknown>,
  ) {
    return this.service.importHotel(dto, actorFrom(headers));
  }

  @Post("link")
  @HttpCode(200)
  link(
    @Body() dto: LinkProviderHotelDto,
    @Headers() headers: Record<string, unknown>,
  ) {
    return this.service.linkHotel(dto, actorFrom(headers));
  }

  @Get("sites")
  sites(@Query() query: ListProviderSitesQueryDto) {
    return this.service.listSites(query.status);
  }

  @Get("sites/:siteId")
  site(@Param("siteId", ParseIntPipe) siteId: number) {
    return this.service.getSite(siteId);
  }

  @Post("sites/:siteId/status")
  @HttpCode(200)
  status(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Body() dto: UpdateProviderStatusDto,
    @Headers() headers: Record<string, unknown>,
  ) {
    return this.service.updateStatus(siteId, dto, actorFrom(headers));
  }

  @Put("sites/:siteId/pets")
  pets(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Body() dto: UpdateProviderPetsDto,
    @Headers() headers: Record<string, unknown>,
  ) {
    return this.service.updatePets(siteId, dto, actorFrom(headers));
  }

  @Post("sites/:siteId/unlink")
  @HttpCode(200)
  unlink(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Body() dto: UnlinkProviderSiteDto,
    @Headers() headers: Record<string, unknown>,
  ) {
    return this.service.unlink(siteId, dto, actorFrom(headers));
  }

  @Post("sites/:siteId/images-imported")
  @HttpCode(200)
  imagesImported(
    @Param("siteId", ParseIntPipe) siteId: number,
    @Body() dto: ImagesImportedDto,
  ) {
    return this.service.markImagesImported(siteId, dto);
  }
}
