import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from "class-validator";

import {
  HOST_CANNOT_HOST_DECISION,
  HOST_CANNOT_HOST_REASON,
  HOST_CANNOT_HOST_REASONS,
  type HostCannotHostDecision,
  type HostCannotHostReason,
} from "../utils/host-cannot-host.util";

export class ReportHostCannotHostDto {
  @IsInt()
  site_id!: number;

  @IsIn(HOST_CANNOT_HOST_REASONS)
  reason!: HostCannotHostReason;

  /** Required for reason `other`. */
  @ValidateIf(
    (dto: ReportHostCannotHostDto) =>
      dto.reason === HOST_CANNOT_HOST_REASON.OTHER ||
      dto.description !== undefined,
  )
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class ResolveHostCannotHostDto {
  @IsIn(Object.values(HOST_CANNOT_HOST_DECISION))
  decision!: HostCannotHostDecision;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
