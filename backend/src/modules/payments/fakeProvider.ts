import { randomUUID } from 'crypto';
import type { AuthorizationResult, PaymentProvider, ProviderEvent } from './provider';

/** Dev/test provider. No network. Records calls so tests can assert on them. */
export class FakePaymentProvider implements PaymentProvider {
  intents = new Map<string, { orderId: string; amountMinor: number; status: 'requires_payment' | 'authorized' | 'captured' | 'cancelled'; capturedMinor?: number }>();
  calls: { type: string; intentId: string; amountMinor?: number; key: string }[] = [];
  failNextAuthorization = false;

  async createAuthorization(input: { orderId: string; amountMinor: number; idempotencyKey: string }): Promise<AuthorizationResult> {
    if (this.failNextAuthorization) {
      this.failNextAuthorization = false;
      throw new Error('fake provider: authorization failed');
    }
    const intentId = `fake_pi_${randomUUID()}`;
    this.intents.set(intentId, { orderId: input.orderId, amountMinor: input.amountMinor, status: 'requires_payment' });
    this.calls.push({ type: 'create', intentId, amountMinor: input.amountMinor, key: input.idempotencyKey });
    return { intentId, clientSecret: `${intentId}_secret` };
  }

  async capture(intentId: string, amountMinor: number, key: string): Promise<void> {
    const i = this.intents.get(intentId);
    if (!i) throw new Error('unknown intent');
    if (amountMinor > i.amountMinor) throw new Error('capture exceeds authorization');
    i.status = 'captured';
    i.capturedMinor = amountMinor;
    this.calls.push({ type: 'capture', intentId, amountMinor, key });
  }

  async cancelAuthorization(intentId: string, key: string): Promise<void> {
    const i = this.intents.get(intentId);
    if (i) i.status = 'cancelled';
    this.calls.push({ type: 'cancel', intentId, key });
  }

  /** Webhook body for the fake provider is plain JSON: { eventId, type, orderId, intentId }. */
  parseWebhook(rawBody: Buffer): ProviderEvent | null {
    const e = JSON.parse(rawBody.toString()) as ProviderEvent;
    return e.type === 'authorized' || e.type === 'failed' ? e : null;
  }

  /** Test/dev helper: mark an intent authorized and return the webhook event the provider would send. */
  authorize(intentId: string, eventId: string = randomUUID()): ProviderEvent {
    const i = this.intents.get(intentId);
    if (!i) throw new Error('unknown intent');
    i.status = 'authorized';
    return { eventId, type: 'authorized', orderId: i.orderId, intentId };
  }
}
