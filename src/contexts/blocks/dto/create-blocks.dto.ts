import { Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, Min } from "class-validator";

export const block_type_values = ["maintenance", "manual_block"] as const;

export type BlockTypeValue = (typeof block_type_values)[number];

export class CreateBlocksDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  site_id!: number;

  @IsInt()
  @Min(1)
  room_id!: number;

  @IsDateString()
  start_date!: string;

  @IsDateString()
  end_date!: string;

  @IsIn(block_type_values)
  type!: BlockTypeValue;

  @IsInt()
  @Min(1)
  reference_id!: number;
}
