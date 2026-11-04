import { IsEmail, IsOptional, IsString, MaxLength } from "class-validator";

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

  /**
   * F2 security fix: signed traveler id issued by the PHP page from the PHP
   * session (see utils/traveler-token.util.ts). The former `user_id` field is
   * no longer accepted: the global ValidationPipe (whitelist) strips it, so an
   * id typed in the browser is ignored. Invalid/expired token -> guest (0).
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  traveler_token?: string;
}
