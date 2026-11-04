import { IsInt, IsOptional, IsPositive } from "class-validator";

export class CreateDashboardLinkDto {
  @IsInt()
  @IsPositive()
  user_id!: number;

  /** Site from the PHP session; when present the backend checks ownership. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  site_id?: number;
}
