import type {
  Paginated,
  ProvinceOption,
  TownOption,
} from "../types/geography.types";

import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from "@nestjs/common";

import { InternalApiKeyGuard } from "@/shared/guards/internal-api-key.guard";

import { GeoSearchQueryDto } from "../dto/geo-search-query.dto";
import { GeographyService } from "../services/geography.service";

@Controller({
  path: "geo",
  version: "1",
})
@UseGuards(InternalApiKeyGuard)
export class GeographyController {
  constructor(private readonly geographyService: GeographyService) {}

  @Get("provinces")
  listProvinces(
    @Query() query: GeoSearchQueryDto,
  ): Promise<Paginated<ProvinceOption>> {
    return this.geographyService.listProvinces(query);
  }

  @Get("provinces/:id/towns")
  listTowns(
    @Param("id", ParseIntPipe) provinceId: number,
    @Query() query: GeoSearchQueryDto,
  ): Promise<Paginated<TownOption>> {
    return this.geographyService.listTowns(provinceId, query);
  }
}
