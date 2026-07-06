import { IsInt } from "class-validator";

export class FinalizeReservationDto {
  @IsInt()
  site_id!: number;
}
