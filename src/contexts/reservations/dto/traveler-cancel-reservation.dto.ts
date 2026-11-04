import {
  IsIn,
  IsInt,
  IsString,
  MaxLength,
  Validate,
  ValidateIf,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from "class-validator";

import {
  CANCELLATION_NOTES_MAX_LENGTH,
  CANCELLATION_NOTES_MIN_LENGTH,
  reasonRequiresNotes,
  TRAVELER_CANCELLATION_REASONS,
  type TravelerCancellationReason,
} from "../utils/refund-policy.util";

/** `other` / `force_majeure` need a description of at least 10 chars. */
@ValidatorConstraint({ name: "cancellationNotesRequired", async: false })
export class CancellationNotesRequiredConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as Partial<TravelerCancelReservationDto>;
    if (!reasonRequiresNotes(String(dto.cancellation_reason ?? ""))) {
      return true;
    }
    return (
      typeof value === "string" &&
      value.trim().length >= CANCELLATION_NOTES_MIN_LENGTH
    );
  }

  defaultMessage(): string {
    return `notes must have at least ${CANCELLATION_NOTES_MIN_LENGTH} characters for this cancellation_reason`;
  }
}

export class TravelerCancelReservationDto {
  @IsInt()
  user_id!: number;

  @IsIn([...TRAVELER_CANCELLATION_REASONS])
  cancellation_reason!: TravelerCancellationReason;

  /** Optional, except for `other` and `force_majeure` (10-1000 chars). */
  @ValidateIf(
    // JSON may send `notes: null`: treat it like an absent optional field.
    (dto: { cancellation_reason: string; notes?: string | null }) =>
      reasonRequiresNotes(dto.cancellation_reason) ||
      (dto.notes !== undefined && dto.notes !== null),
  )
  @IsString()
  @MaxLength(CANCELLATION_NOTES_MAX_LENGTH)
  @Validate(CancellationNotesRequiredConstraint)
  notes?: string;
}
