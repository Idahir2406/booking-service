import type { TravelerCancelPreviewResponseDto } from "../dto/traveler-panel.dto";
import type { ReservationEntity } from "../entities/reservation.entity";
import type { TravelerCancellationReason } from "../utils/refund-policy.util";

import { Injectable } from "@nestjs/common";

export interface ProviderTravelerCancelInput {
  userId: number;
  reason: TravelerCancellationReason;
  notes: string | null;
}

export interface ProviderTravelerCancelOutcome {
  reservation: ReservationEntity;
  refundInitiated: boolean;
  /** Provider has not confirmed the cancellation yet (nothing refunded). */
  pending: boolean;
  penaltyCents: number;
  refundCents: number;
}

/**
 * Cancellation of external provider reservations (source = nuitee), served by
 * the provider-reservations context. That context imports ReservationModule,
 * so ReservationRefundService cannot inject it directly (module cycle): the
 * provider side registers itself here on init.
 */
export interface ProviderCancellationHandler {
  previewTravelerCancellation(
    reservation: ReservationEntity,
    reason: TravelerCancellationReason,
    now: Date,
  ): Promise<TravelerCancelPreviewResponseDto>;
  cancelByTraveler(
    reservationId: number,
    input: ProviderTravelerCancelInput,
  ): Promise<ProviderTravelerCancelOutcome>;
}

@Injectable()
export class ProviderCancellationBridge {
  private handler: ProviderCancellationHandler | null = null;

  register(handler: ProviderCancellationHandler): void {
    this.handler = handler;
  }

  get(): ProviderCancellationHandler | null {
    return this.handler;
  }
}
