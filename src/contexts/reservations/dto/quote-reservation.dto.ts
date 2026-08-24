import { IsDateString, IsInt, IsOptional, Min } from "class-validator";

export class QuoteReservationDto {
  @IsInt()
  site_id!: number;

  @IsInt()
  @Min(1)
  room_id!: number;

  @IsDateString()
  checkin!: string;

  @IsDateString()
  checkout!: string;

  @IsInt()
  @Min(1)
  guests!: number;

  @IsInt()
  @Min(0)
  pets!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  board_option_id?: number;
}
