import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

import { feedback_type_values } from "../entities/reservation-guest-feedback.entity";

export class SubmitFeedbackDto {
  @IsIn(feedback_type_values)
  type!: (typeof feedback_type_values)[number];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  report_reason?: string;
}
