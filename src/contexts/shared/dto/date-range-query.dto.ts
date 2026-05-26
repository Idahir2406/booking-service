import { IsDateString } from "class-validator";

/** Query `from` / `to` para calendarios (YYYY-MM-DD, inclusive). */
export class DateRangeQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}
