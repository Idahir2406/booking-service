import { IsIn, IsOptional, IsString } from "class-validator";

export class ReviewRefundDto {
  @IsIn(["approve", "reject"])
  decision!: "approve" | "reject";

  @IsOptional()
  @IsString()
  admin_notes?: string;
}
