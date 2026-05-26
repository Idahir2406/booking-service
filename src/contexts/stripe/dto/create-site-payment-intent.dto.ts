import { IsEmail, IsInt, IsPositive } from "class-validator";

export class CreateSitePaymentIntentDto {
  @IsInt()
  @IsPositive()
  site_id!: number;

  @IsEmail()
  email!: string;
}
