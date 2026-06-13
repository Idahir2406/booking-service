export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: unknown;
  };
}
