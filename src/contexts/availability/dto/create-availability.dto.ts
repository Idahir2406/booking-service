import { Type } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
} from "class-validator";

export const availability_day_values = [
  1, 2, 3, 4, 5, 6, 7, 10, 14, 21, 30, 60, 90, 180, 365,
];
export class CreateAvailabilityDto {
  @IsInt()
  @IsIn(availability_day_values)
  day!: number;

  @IsNumber()
  site_id!: number;

  @IsUUID()
  room_id!: string;

  @IsOptional()
  @IsBoolean()
  is_available?: boolean;

  /** Primer día a generar (inclusive). Sin enviar → primer día = mañana (comportamiento legacy). */
  @IsOptional()
  @IsDateString()
  anchor_date?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  min_nights!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  max_nights!: number;
}
