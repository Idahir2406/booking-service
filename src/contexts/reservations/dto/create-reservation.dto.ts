import { IsDateString, IsIn, IsInt, IsNumber, Min } from "class-validator";

import { source_values, SourceValue } from "../entities/reservation.entity";

export class CreateReservationDto {
  @IsInt()
  site_id!: number;

  @IsInt()
  @Min(1)
  room_id!: number;

  // Provider reservations (nuitee) are created only by the providers flow.
  @IsIn(source_values.filter(value => value !== "nuitee"))
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
