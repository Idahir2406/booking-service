import { IsIn, IsInt, IsOptional, IsPositive } from "class-validator";

export const EXPRESS_ACCOUNT_RETURN_TO = {
  PROFILE: "profile",
  WIZARD: "wizard",
} as const;

export type ExpressAccountReturnTo =
  (typeof EXPRESS_ACCOUNT_RETURN_TO)[keyof typeof EXPRESS_ACCOUNT_RETURN_TO];

export class CreateExpressAccountDto {
  @IsInt()
  @IsPositive()
  user_id!: number;

  /** Site from the PHP session; when present the backend checks ownership. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  site_id?: number;

  /** Where Stripe onboarding returns (fixed paths, never a client URL). */
  @IsOptional()
  @IsIn(Object.values(EXPRESS_ACCOUNT_RETURN_TO))
  return_to?: ExpressAccountReturnTo;
}
