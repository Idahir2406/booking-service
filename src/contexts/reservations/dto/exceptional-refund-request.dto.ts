import { IsInt, IsOptional, IsString, Min } from "class-validator";

export class ExceptionalRefundRequestDto {
  @IsInt()
  site_id!: number;

  @IsInt()
  @Min(1)
  amount_cents!: number;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
