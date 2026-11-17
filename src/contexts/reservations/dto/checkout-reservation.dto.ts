import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

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

  /** Estimated arrival "HH:MM" (30-min steps), inside the site check-in window. */
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):(00|30)$/)
  arrival_time?: string;

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
