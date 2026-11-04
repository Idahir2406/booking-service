import { PartialType } from "@nestjs/mapped-types";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

import { DOG_WEIGHT_LIMITS } from "../../pet-policies/domain/dog-compatibility";
import {
  TRAVELER_DOG_NAME_MAX_LENGTH,
  TRAVELER_DOG_PHOTO_KEY_PATTERN,
} from "../domain/traveler-dog.constants";

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

/** F-PV5: saved dog. Same weight range as the checkout dog (ReservationDogDto). */
export class CreateTravelerDogDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(TRAVELER_DOG_NAME_MAX_LENGTH)
  name!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(DOG_WEIGHT_LIMITS.MIN_KG)
  @Max(DOG_WEIGHT_LIMITS.MAX_KG)
  weight_kg!: number;

  @IsBoolean()
  is_ppp!: boolean;

  /**
   * Storage key set only by the PHP proxy after a validated upload (D5);
   * null removes the photo. The proxy strips it from browser input.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(TRAVELER_DOG_PHOTO_KEY_PATTERN)
  photo_path?: string | null;
}

export class UpdateTravelerDogDto extends PartialType(CreateTravelerDogDto) {}

/** Size category derived from the weight (same rule as the F2 quote). */
export interface TravelerDogSizeDto {
  id: number;
  name: string;
  slug: string;
  rank: number;
}

export interface TravelerDogDto {
  id: number;
  name: string;
  weight_kg: number;
  is_ppp: boolean;
  /** Private storage key; PHP turns it into a proxy URL, never a public path. */
  photo_path: string | null;
  /** null only if dog_sizes is empty/misconfigured. */
  size: TravelerDogSizeDto | null;
  created_at: string;
  updated_at: string;
}

export interface TravelerDogListDto {
  items: TravelerDogDto[];
  max: number;
}
