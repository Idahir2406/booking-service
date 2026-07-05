import { Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsUUID, Min } from "class-validator";

export const block_type_values = ["maintenance", "manual_block"] as const;

export type BlockTypeValue = (typeof block_type_values)[number];

export class CreateBlocksDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  site_id!: number;

  @IsUUID()
  room_id!: string;

  @IsDateString()
  start_date!: string;

  @IsDateString()
  end_date!: string;

  @IsIn(block_type_values)
  type!: BlockTypeValue;

  @IsUUID()
  reference_id!: string;
}
