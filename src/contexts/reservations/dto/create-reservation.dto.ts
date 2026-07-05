import { IsDateString, IsIn, IsInt, IsNumber, IsUUID } from "class-validator";

import { source_values, SourceValue } from "../entities/reservation.entity";

export class CreateReservationDto {
  @IsInt()
  site_id!: number;

  @IsUUID()
  room_id!: string;

  @IsIn(source_values)
  source!: SourceValue;

  @IsInt()
  user_id!: number;

  @IsDateString()
  checkin!: string;

  @IsDateString()
  checkout!: string;

  @IsInt()
  guests!: number;

  @IsInt()
  pets!: number;

  @IsNumber()
  subtotal!: number;

  @IsNumber()
  commission!: number;
}
