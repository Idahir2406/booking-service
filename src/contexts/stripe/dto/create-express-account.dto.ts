import { IsInt, IsPositive } from "class-validator";

export class CreateExpressAccountDto {
  @IsInt()
  @IsPositive()
  user_id!: number;
}
