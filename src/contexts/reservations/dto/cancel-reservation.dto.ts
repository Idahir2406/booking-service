import { IsBoolean, IsInt, IsOptional, IsString } from "class-validator";

export class CancelReservationDto {
  @IsBoolean()
  refund!: boolean;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsInt()
  site_id!: number;
}
