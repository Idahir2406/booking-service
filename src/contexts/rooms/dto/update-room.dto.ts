import { OmitType, PartialType } from "@nestjs/mapped-types";
import { Type } from "class-transformer";
import { IsArray, IsOptional, IsString, ValidateNested } from "class-validator";

import { CreateRoomDto } from "./create-room.dto";
import { UpdateRoomBoardOptionDto } from "./update-room-board-option.dto";
import { UpdateRoomExtraDto } from "./update-room-extra.dto";

export class UpdateRoomDto extends PartialType(
  OmitType(CreateRoomDto, ["board_options", "extras"] as const),
) {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateRoomBoardOptionDto)
  board_options?: UpdateRoomBoardOptionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateRoomExtraDto)
  extras?: UpdateRoomExtraDto[];

  @IsOptional()
  @IsString()
  image1?: string;

  @IsOptional()
  @IsString()
  image2?: string;

  @IsOptional()
  @IsString()
  image3?: string;

  @IsOptional()
  @IsString()
  image4?: string;

  @IsOptional()
  @IsString()
  image5?: string;
}
