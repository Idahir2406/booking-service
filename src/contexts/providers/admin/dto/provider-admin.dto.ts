import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

import { PROVIDER_PROPERTY_STATUS } from "../../entities/provider-property.entity";

const HOTEL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** GET /v1/admin/providers/nuitee/hotels/search */
export class SearchProviderHotelsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  /** ISO 3166-1 alpha-2 (required by Nuitee unless lat/lng are sent). */
  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/)
  country?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  /** Meters (coordinates search). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(50_000)
  radius?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  offset?: number;
}

/** POST /v1/admin/providers/nuitee/import (case A). */
export class ImportProviderHotelDto {
  @Matches(HOTEL_ID_PATTERN)
  hotel_id!: string;

  @IsInt()
  @Min(1)
  id_poblacion!: number;

  /** Optional: checked against the poblacion's province. */
  @IsOptional()
  @IsInt()
  @Min(1)
  id_provincia?: number;

  /** alias_l1 wanted (slugified; made unique). Default: hotel name. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  alias?: string;

  /** jsites1.tipsite CSV of v4p_jtipsite ids ("3" or "3,7"). */
  @IsOptional()
  @Matches(/^\d{1,6}(,\d{1,6}){0,9}$/)
  tipsite?: string;

  /** Import although pets are unknown / the policy is unreadable. */
  @IsOptional()
  @IsBoolean()
  force_pets_review?: boolean;

  /** Import although nearby sites look like the same hotel (case B). */
  @IsOptional()
  @IsBoolean()
  ignore_duplicates?: boolean;
}

/** POST /v1/admin/providers/nuitee/link (case B). */
export class LinkProviderHotelDto {
  @Matches(HOTEL_ID_PATTERN)
  hotel_id!: string;

  @IsInt()
  @Min(1)
  site_id!: number;

  /** Required when the site has future internal reservations. */
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;

  @IsOptional()
  @IsBoolean()
  force_pets_review?: boolean;
}

export const ADMIN_TARGET_STATUS = [
  PROVIDER_PROPERTY_STATUS.ACTIVE,
  PROVIDER_PROPERTY_STATUS.PAUSED,
  PROVIDER_PROPERTY_STATUS.DELISTED,
] as const;

/** POST /v1/admin/providers/nuitee/sites/:siteId/status */
export class UpdateProviderStatusDto {
  @IsIn(ADMIN_TARGET_STATUS)
  status!: (typeof ADMIN_TARGET_STATUS)[number];
}

/** PUT /v1/admin/providers/nuitee/sites/:siteId/pets */
export class UpdateProviderPetsDto {
  @IsBoolean()
  allowed!: boolean;

  @IsOptional()
  @IsBoolean()
  fee?: boolean | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  fee_amount_cents?: number | null;

  @IsOptional()
  @Matches(/^[A-Za-z]{3}$/)
  fee_currency?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  fee_basis?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  weight_limit?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  terms?: string | null;

  /** Text shown to travelers (plain text). */
  @IsString()
  @Length(0, 2000)
  text!: string;

  @IsBoolean()
  reviewed!: boolean;
}

/** POST /v1/admin/providers/nuitee/sites/:siteId/unlink */
export class UnlinkProviderSiteDto {
  /** Required when the site has future provider reservations. */
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

/** POST /v1/admin/providers/nuitee/sites/:siteId/images-imported */
export class ImagesImportedDto {
  @IsInt()
  @Min(0)
  @Max(35)
  count!: number;
}

/** GET /v1/admin/providers/nuitee/sites */
export class ListProviderSitesQueryDto {
  @IsOptional()
  @IsIn(Object.values(PROVIDER_PROPERTY_STATUS))
  status?: string;
}
