import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";

import { CreateRoomBoardOptionDto } from "./create-room-board-option.dto";
import { CreateRoomExtraDto } from "./create-room-extra.dto";

export class CreateRoomDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  site_id!: number;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price_per_night!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_guests!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  max_pets?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort_order?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRoomBoardOptionDto)
  board_options?: CreateRoomBoardOptionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRoomExtraDto)
  extras?: CreateRoomExtraDto[];
}
