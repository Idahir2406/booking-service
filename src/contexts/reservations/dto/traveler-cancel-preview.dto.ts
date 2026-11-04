import { IsIn } from "class-validator";

import {
  TRAVELER_CANCELLATION_REASONS,
  type TravelerCancellationReason,
} from "../utils/refund-policy.util";

/** Body of `POST /v1/traveler/:user_id/reservations/:id/cancel-preview`. */
export class TravelerCancelPreviewDto {
  @IsIn([...TRAVELER_CANCELLATION_REASONS])
  cancellation_reason!: TravelerCancellationReason;
}
