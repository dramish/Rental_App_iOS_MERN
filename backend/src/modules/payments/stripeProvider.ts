import Stripe from 'stripe';
import type { AuthorizationResult, PaymentProvider, ProviderEvent } from './provider';

/** Stripe (test mode). NOT exercised against Stripe in CI: verify with the Stripe CLI (`stripe listen`). */
export class StripePaymentProvider implements PaymentProvider {
  private stripe: Stripe;
  constructor(secretKey: string, private webhookSecret: string) {
    this.stripe = new Stripe(secretKey);
  }

  async createAuthorization(input: { orderId: string; amountMinor: number; currency: string; idempotencyKey: string }): Promise<AuthorizationResult> {
    const pi = await this.stripe.paymentIntents.create(
      {
        amount: input.amountMinor,
        currency: input.currency.toLowerCase(),
        capture_method: 'manual',
        automatic_payment_methods: { enabled: true },
        metadata: { orderId: input.orderId },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    if (!pi.client_secret) throw new Error('stripe: missing client secret');
    return { intentId: pi.id, clientSecret: pi.client_secret };
  }

  async capture(intentId: string, amountMinor: number, key: string): Promise<void> {
    await this.stripe.paymentIntents.capture(intentId, { amount_to_capture: amountMinor }, { idempotencyKey: key });
  }

  async cancelAuthorization(intentId: string, key: string): Promise<void> {
    await this.stripe.paymentIntents.cancel(intentId, {}, { idempotencyKey: key });
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): ProviderEvent | null {
    if (!signature) throw new Error('missing stripe-signature');
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    const pi = event.data.object as Stripe.PaymentIntent;
    const orderId = pi.metadata?.['orderId'];
    if (!orderId) return null;
    // amount_capturable_updated fires when a manual-capture intent becomes authorized.
    if (event.type === 'payment_intent.amount_capturable_updated') {
      return { eventId: event.id, type: 'authorized', orderId, intentId: pi.id };
    }
    if (event.type === 'payment_intent.payment_failed') {
      return { eventId: event.id, type: 'failed', orderId, intentId: pi.id };
    }
    return null;
  }
}
