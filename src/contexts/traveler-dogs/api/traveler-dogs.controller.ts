import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";

import { InternalApiKeyGuard } from "../../shared/guards/internal-api-key.guard";
import {
  CreateTravelerDogDto,
  UpdateTravelerDogDto,
} from "../dto/traveler-dog.dto";
import { TravelerDogsService } from "../services/traveler-dogs.service";

/**
 * F-PV5 "Mis perros". Same `traveler` prefix as TravelerPanelController (other
 * module, paths do not collide). Internal only: user_id comes from the PHP
 * session proxy (web/php/booking_traveler_api.php), never from the browser.
 */
@Controller({
  path: "traveler",
  version: "1",
})
@UseGuards(InternalApiKeyGuard)
export class TravelerDogsController {
  constructor(private readonly dogsService: TravelerDogsService) {}

  @Get(":user_id/dogs")
  list(@Param("user_id", ParseIntPipe) userId: number) {
    return this.dogsService.list(userId);
  }

  @Post(":user_id/dogs")
  create(
    @Param("user_id", ParseIntPipe) userId: number,
    @Body() dto: CreateTravelerDogDto,
  ) {
    return this.dogsService.create(userId, dto);
  }

  @Patch(":user_id/dogs/:dog_id")
  update(
    @Param("user_id", ParseIntPipe) userId: number,
    @Param("dog_id", ParseIntPipe) dogId: number,
    @Body() dto: UpdateTravelerDogDto,
  ) {
    return this.dogsService.update(userId, dogId, dto);
  }

  @Delete(":user_id/dogs/:dog_id")
  remove(
    @Param("user_id", ParseIntPipe) userId: number,
    @Param("dog_id", ParseIntPipe) dogId: number,
  ) {
    return this.dogsService.remove(userId, dogId);
  }
}
