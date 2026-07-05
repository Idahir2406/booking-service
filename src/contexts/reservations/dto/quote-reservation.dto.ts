import { IsDateString, IsInt, IsOptional, IsUUID, Min } from "class-validator";

export class QuoteReservationDto {
  @IsInt()
  site_id!: number;

  @IsUUID()
  room_id!: string;

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
  @IsUUID()
  board_option_id?: string;
}
