import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

import {
  MAX_SERVICE_QUANTITY,
  SERVICE_SELECTION_TYPE,
  type ServiceSelectionType,
} from "../../payments/domain/reservation-pricing";
import { DOG_WEIGHT_LIMITS } from "../../pet-policies/domain/dog-compatibility";

/** Max dogs accepted in one request (validation guard, not a business rule). */
export const MAX_DECLARED_DOGS = 20;

/** F2 (B2): one traveler dog. Size is derived server-side from the weight. */
export class ReservationDogDto {
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

  /** Unit the dog stays in (B2.1). Optional: single-unit bookings auto-assign. */
  @IsOptional()
  @IsInt()
  @Min(1)
  room_id?: number;

  /**
   * Saved traveler dog (traveler_dogs.id) this row came from. Link only:
   * the quote ignores it and the checkout keeps it in the snapshot only if
   * the dog belongs to the authenticated traveler; otherwise it is dropped.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  saved_dog_id?: number;
}

/** F2: paid dog supply / additional service selected by the traveler. */
export class ReservationServiceSelectionDto {
  @IsIn(Object.values(SERVICE_SELECTION_TYPE))
  type!: ServiceSelectionType;

  /** Catalog id (dog_supplies.id / additional_services.id). */
  @IsInt()
  @Min(1)
  id!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SERVICE_QUANTITY)
  quantity?: number;
}

/** F2: room extra (room_extras.id) selected by the traveler. */
export class ReservationExtraSelectionDto {
  @IsInt()
  @Min(1)
  id!: number;
}

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

  /**
   * Legacy dog count. When `dogs` is present it is ignored and derived as
   * dogs.length; without `dogs` only the count is validated (no size/PPP).
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  pets?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  board_option_id?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DECLARED_DOGS)
  @ValidateNested({ each: true })
  @Type(() => ReservationDogDto)
  dogs?: ReservationDogDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ReservationServiceSelectionDto)
  services?: ReservationServiceSelectionDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ReservationExtraSelectionDto)
  extras?: ReservationExtraSelectionDto[];
}
