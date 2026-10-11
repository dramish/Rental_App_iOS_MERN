export interface AuthorizationResult {
  intentId: string;
  /** Handed to the client SDK (Stripe PaymentSheet) to confirm the payment. */
  clientSecret: string;
}

export type ProviderEvent =
  | { eventId: string; type: 'authorized'; orderId: string; intentId: string }
  | { eventId: string; type: 'failed'; orderId: string; intentId: string };

/**
 * Deposit model: ONE authorization (manual capture) for rent + deposit.
 * At settlement we capture rent + late fee + damage (never more than authorized);
 * the rest of the hold is released automatically. Cancelling releases the whole hold.
 * Limitation: card authorizations expire (~7 days), so long rentals need re-authorization.
 */
export interface PaymentProvider {
  createAuthorization(input: { orderId: string; amountMinor: number; currency: string; idempotencyKey: string }): Promise<AuthorizationResult>;
  capture(intentId: string, amountMinor: number, idempotencyKey: string): Promise<void>;
  cancelAuthorization(intentId: string, idempotencyKey: string): Promise<void>;
  /** Verify signature and normalize. Returns null for event types we ignore. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): ProviderEvent | null;
}
