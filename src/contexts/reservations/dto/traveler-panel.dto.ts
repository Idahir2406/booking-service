import type { PriceLinesSummary } from "../../payments/domain/price-lines";
import type {
  SnapshotBoard,
  SnapshotCompatibility,
  SnapshotDeposit,
  SnapshotDog,
  SnapshotDogPolicy,
  SnapshotRoom,
  SnapshotSelectedExtra,
  SnapshotSelectedService,
  SnapshotStay,
} from "../../payments/domain/reservation-snapshot";
import type { PriceLineType } from "../../payments/entities/reservation-price-line.entity";
import type { TravelerDogDto } from "../../traveler-dogs/dto/traveler-dog.dto";
import type { FeedbackTypeValue } from "../entities/reservation-guest-feedback.entity";
import type {
  TravelerCancellationQuote,
  TravelerCancellationReason,
} from "../utils/refund-policy.util";
import type { ChangeRequestType } from "../utils/reservation-change.util";
import type { IncidentType } from "../utils/reservation-incident.util";
import type { TravelerAlertDto } from "../utils/traveler-alerts.util";
import type {
  TravelerPaymentLabelKey,
  TravelerRefundLabelKey,
  TravelerStatus,
  TravelerTab,
} from "../utils/traveler-panel-status.util";
import type {
  TravelerAlternativeDto,
  TravelerChangeRequestDto,
} from "./reservation-change.dto";
import type { TravelerIncidentDto } from "./reservation-incident.dto";

/**
 * Traveler panel read DTOs (F-PV1). Stable contract for the PHP proxy:
 * no stripe_* ids and no raw payment/refund enums.
 */
export interface TravelerReservationCardDto {
  id: number;
  code: string;
  site_id: number;
  site_name: string | null;
  site_alias: string | null;
  site_town: string | null;
  site_province: string | null;
  /** jsites2.image1 file name; PHP builds the URL with $pathImage. */
  site_image_file: string | null;
  room_name: string | null;
  checkin: string;
  checkout: string;
  nights: number;
  guests: number;
  dogs_count: number;
  status: TravelerStatus;
  tab: TravelerTab;
  total_cents: number;
  currency: string;
  /** pay-pending: unfinished checkout still payable ("Pagar reserva"). */
  can_pay: boolean;
  /** ISO instant the payment window closes (null when can_pay is false). */
  pay_expires_at: string | null;
}

export interface TravelerReservationListDto {
  items: TravelerReservationCardDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface TravelerPriceLineDto {
  type: PriceLineType;
  description: string;
  quantity: number;
  unit_amount_cents: number;
  amount_cents: number;
  is_optional: boolean;
}

export interface TravelerPolicyDto {
  rule: string;
  refund_deadline_iso: string;
  timezone: string | null;
  generated_text: string | null;
  /** true only when the snapshot carries refund_policy.cancellation. */
  is_structured: boolean;
}

export interface TravelerPaymentDto {
  id: number;
  status_label_key: TravelerPaymentLabelKey;
  amount_cents: number;
  paid_at: string | null;
}

export interface TravelerRefundDto {
  id: number;
  status_label_key: TravelerRefundLabelKey;
  amount_cents: number;
  created_at: string;
  completed_at: string | null;
}

export interface TravelerCapabilitiesDto {
  can_cancel: boolean;
  can_review: boolean;
  /**
   * F-PV7b: upcoming confirmed + paid stay (check-in after today) without an
   * open change request (one open per reservation).
   */
  can_request_change: boolean;
  /** F-PV7a: reportable_incident_types is not empty. */
  can_report_incident: boolean;
  /**
   * F-PV7a: types the traveler can open now (confirmed/finalized: all; cancelled
   * with money: refund_issue; minus types already open; 30 days after checkout).
   */
  reportable_incident_types: IncidentType[];
  /** §13: a reservation_guest_feedback row exists (review or report). */
  has_feedback: boolean;
  /**
   * §13: finalized, no feedback and feedback_deadline_at already passed
   * ("plazo vencido"). false when there is no deadline.
   */
  review_deadline_passed: boolean;
  /** pay-pending: same values as card.can_pay / card.pay_expires_at. */
  can_pay: boolean;
  pay_expires_at: string | null;
}

/**
 * §13: the traveler's own submitted feedback, read-only. No report_reason
 * (internal moderation text); `comment` is what the traveler wrote.
 */
export interface TravelerFeedbackSummaryDto {
  type: FeedbackTypeValue;
  rating: number | null;
  comment: string | null;
  submitted_at: string | null;
}

/**
 * Frozen snapshot dog + link to the saved dog it was picked from
 * (spec 2.2/2.3). `saved_dog_id` is null for typed-in dogs and older
 * snapshots. Never carries the photo storage key: the PHP proxy resolves
 * the avatar through the owner's dogs list.
 */
export interface TravelerReservationDogDto extends Omit<
  SnapshotDog,
  "saved_dog_id"
> {
  saved_dog_id: number | null;
}

export interface TravelerReservationDetailDto {
  card: TravelerReservationCardDto;
  stay: SnapshotStay;
  room: SnapshotRoom | null;
  board: SnapshotBoard | null;
  dogs: TravelerReservationDogDto[];
  dog_policy: SnapshotDogPolicy | null;
  compatibility: SnapshotCompatibility | null;
  deposit: SnapshotDeposit | null;
  services: SnapshotSelectedService[];
  extras: SnapshotSelectedExtra[];
  price_lines: TravelerPriceLineDto[];
  totals: PriceLinesSummary;
  policy: TravelerPolicyDto;
  payments: TravelerPaymentDto[];
  refunds: TravelerRefundDto[];
  capabilities: TravelerCapabilitiesDto;
  snapshot_version: number | null;
  /** F-PV7a: traveler incidents, newest first (no dispute ids / admin notes). */
  incidents: TravelerIncidentDto[];
  /**
   * §5.1: accommodation address composed from legacy jsites1 (null when the
   * site lookup fails or has no data). Legacy has no street/postcode column.
   */
  site_address: string | null;
  /**
   * §5.2: snapshot.compatibility.compatible when the snapshot carries it and
   * dogs were declared; null for older snapshots. Never recomputed live.
   */
  dogs_compatible: boolean | null;
  /** §13: submitted feedback (null when none). */
  my_feedback: TravelerFeedbackSummaryDto | null;
  /** F-PV7b: change requests (newest first) with their V4P proposals. */
  change_requests: TravelerChangeRequestDto[];
  /** F-PV7b: accommodation alternatives presented by V4P (PDF §10). */
  alternatives: TravelerAlternativeDto[];
  /** F-PV7b: request types the form offers. */
  change_types: ChangeRequestType[];
}

/**
 * pay-pending: Stripe Checkout URL for the SAME reservation (reused open
 * session or a new one with the same frozen amounts). No session id.
 */
export interface TravelerPayResponseDto {
  reservation_id: number;
  checkout_url: string;
  expires_at: string;
  reused: boolean;
}

export interface TravelerFeedbackTokenDto {
  token: string;
  expires_at: string;
}

/**
 * Cancellation preview (F-PV4). Same numbers cancel-traveler executes: both
 * come from resolveTravelerCancellationQuote. No Stripe ids, no raw states.
 */
export interface TravelerCancelPreviewResponseDto extends TravelerCancellationQuote {
  reservation_id: number;
  cancellation_reason: TravelerCancellationReason;
  currency: string;
  /** Snapshot timezone used to show the deadline (fallback Europe/Madrid). */
  timezone: string;
}

/**
 * Saved dog on the home (F-PV6): same data as the dogs list. photo_path is
 * the private storage key; the PHP proxy turns it into photo_url and drops it.
 */
export type TravelerDogSummaryDto = Pick<
  TravelerDogDto,
  "id" | "name" | "photo_path" | "size"
>;

/**
 * Home dashboard (F-PV6): one round-trip for greeting data, next trip and
 * alerts. `next_trip` = first card of the upcoming tab (checkin ASC).
 * `dogs_available = false` when the dogs table could not be read (migration
 * pending): the UI hides the block instead of showing an empty state.
 */
export interface TravelerDashboardDto {
  next_trip: TravelerReservationCardDto | null;
  upcoming_count: number;
  dogs: TravelerDogSummaryDto[];
  dogs_available: boolean;
  alerts: TravelerAlertDto[];
}
