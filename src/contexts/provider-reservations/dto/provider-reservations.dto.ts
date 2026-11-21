import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

import { DOG_WEIGHT_LIMITS } from "../../pet-policies/domain/dog-compatibility";

/** GET /v1/provider-reservations/rates (query string). */
export class ProviderRatesQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  site_id!: number;

  @IsDateString()
  checkin!: string;

  @IsDateString()
  checkout!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  adults!: number;

  /** Comma separated ages ("5,8"); empty = no children. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Matches(/^[\d,\s]*$/)
  children_ages?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  pets?: number;

  /** "1": admin preview of a draft property (PHP sets it only for admins). */
  @IsOptional()
  @IsIn(["0", "1"])
  admin_preview?: string;
}

export class ProviderDogDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(DOG_WEIGHT_LIMITS.MIN_KG)
  @Max(DOG_WEIGHT_LIMITS.MAX_KG)
  weight_kg!: number;

  @IsBoolean()
  is_ppp!: boolean;
}

/** POST /v1/provider-reservations/quote */
export class ProviderQuoteDto {
  @IsInt()
  @Min(1)
  site_id!: number;

  /** offerId from GET rates. */
  @IsString()
  @MaxLength(4000)
  offer_id!: string;

  @IsDateString()
  checkin!: string;

  @IsDateString()
  checkout!: string;

  @IsInt()
  @Min(1)
  @Max(12)
  adults!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(17, { each: true })
  children_ages?: number[];

  /** Dog count (ignored when `dogs` is present: dogs.length wins). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  pets?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ProviderDogDto)
  dogs?: ProviderDogDto[];

  @IsString()
  @MaxLength(80)
  guest_first_name!: string;

  @IsString()
  @MaxLength(80)
  guest_last_name!: string;

  @IsEmail()
  guest_email!: string;

  @IsString()
  @MaxLength(40)
  guest_phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  guest_notes?: string;

  /** Signed traveler id issued by PHP (same as /reservations/checkout). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  traveler_token?: string;

  /** sell_cents the traveler accepted after requires_reconfirmation. */
  @IsOptional()
  @IsInt()
  @Min(1)
  accepted_price_cents?: number;
}

/** POST /v1/provider-reservations/checkout */
export class ProviderCheckoutDto {
  @IsInt()
  @Min(1)
  reservation_id!: number;
}

/**
 * POST /v1/provider-reservations/:id/cancel (backoffice). The provider
 * cancels first; waive_penalty refunds everything even if it charges us.
 */
export class ProviderAdminCancelDto {
  @IsOptional()
  @IsBoolean()
  waive_penalty?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /** admino user id (audit). */
  @IsOptional()
  @IsInt()
  @Min(1)
  admin_id?: number;
}
