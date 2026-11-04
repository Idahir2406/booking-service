export interface StripeWebhookEventData {
  object: unknown;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: StripeWebhookEventData;
  /** Connect events only: the connected (host) account the event belongs to. */
  account?: string;
}

/** Side effect (emails) that must only run after the webhook transaction commits. */
export type AfterCommitTask = () => Promise<void>;

export interface WebhookHandlerResult {
  reservationId?: number;
}
