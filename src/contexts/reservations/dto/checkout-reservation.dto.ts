import { IsEmail, IsInt, IsOptional, IsString, Min } from "class-validator";

import { QuoteReservationDto } from "./quote-reservation.dto";

export class CheckoutReservationDto extends QuoteReservationDto {
  @IsString()
  guest_name!: string;

  @IsEmail()
  guest_email!: string;

  @IsString()
  guest_phone!: string;

  @IsOptional()
  @IsString()
  guest_notes?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  user_id?: number;
}
