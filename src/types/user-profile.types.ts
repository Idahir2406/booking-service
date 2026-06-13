export interface UserProfile {
  id: number;
  email: string;
  name?: string | null;
  role: string;
  stripe_account_id?: string | null;
}
