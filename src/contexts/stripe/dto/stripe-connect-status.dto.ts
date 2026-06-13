export interface StripeConnectStatusDto {
  user_id: number;
  stripe_account_id: string | null;
  has_account: boolean;
  onboarding_complete: boolean;
  can_use_reservations: boolean;
}
