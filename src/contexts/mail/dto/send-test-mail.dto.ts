import { IsEmail, IsOptional, IsString } from "class-validator";

export class SendTestMailDto {
  @IsOptional()
  @IsEmail()
  to?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  html?: string;
}
