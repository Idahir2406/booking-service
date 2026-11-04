import { IsIn, IsInt, IsOptional, IsString, MaxLength } from "class-validator";

import {
  NO_SHOW_DECISION,
  type NoShowDecision,
} from "../services/reservation-no-show.service";

export class ReportNoShowDto {
  @IsInt()
  site_id!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ResolveNoShowDto {
  @IsIn(Object.values(NO_SHOW_DECISION))
  decision!: NoShowDecision;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
