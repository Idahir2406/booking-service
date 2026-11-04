import type { SiteFormCatalog } from "../types/site-form-catalog.types";

import { Controller, Get, Query, UseGuards } from "@nestjs/common";

import { LangQueryDto } from "@/shared/dto/lang-query.dto";
import { InternalApiKeyGuard } from "@/shared/guards/internal-api-key.guard";

import { CatalogsService } from "../services/catalogs.service";

@Controller({
  path: "catalogs",
  version: "1",
})
@UseGuards(InternalApiKeyGuard)
export class CatalogsController {
  constructor(private readonly catalogsService: CatalogsService) {}

  @Get("site-form")
  getSiteForm(@Query() query: LangQueryDto): Promise<SiteFormCatalog> {
    return this.catalogsService.getSiteFormCatalog(query.lang);
  }
}
