import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

import {
  TRAVELER_TAB,
  TRAVELER_TABS,
  type TravelerTab,
} from "../utils/traveler-panel-status.util";

export const TRAVELER_LIST_MAX_LIMIT = 50;

export class TravelerReservationListQueryDto {
  @IsOptional()
  @IsIn(TRAVELER_TABS)
  tab: TravelerTab = TRAVELER_TAB.UPCOMING;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TRAVELER_LIST_MAX_LIMIT)
  limit = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}
