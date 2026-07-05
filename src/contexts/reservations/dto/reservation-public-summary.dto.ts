import type {
  PaymentStatusValue,
  StatusValue,
} from "../entities/reservation.entity";

export class ReservationPublicSummaryDto {
  id!: number;
  code!: string;
  site_id!: number;
  status!: StatusValue;
  payment_status!: PaymentStatusValue;
  checkin!: string;
  checkout!: string;
  guests!: number;
  pets!: number;
  subtotal!: number | null;
  commission!: number | null;
  total!: number | null;
  guest_name!: string | null;
}
