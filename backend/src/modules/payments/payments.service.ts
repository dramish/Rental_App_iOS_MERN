import { Types } from 'mongoose';
import { logger } from '../../config/logger';
import { AppError } from '../../utils/errors';
import { isDuplicateKey } from '../../utils/tx';
import { services } from '../../services';
import { Order } from '../orders/order.model';
import { transition } from '../orders/order.service';
import type { ProviderEvent } from './provider';
import { WebhookEvent } from './webhookEvent.model';

const SYSTEM = { id: 'system', role: 'system' } as const;

/**
 * Idempotent webhook handling:
 *  - the eventId row dedupes redeliveries ('done' => ack and skip)
 *  - the order transition itself is idempotent on `webhook-<eventId>`, so a crash between
 *    "transition applied" and "marked done" is safe to re-run
 * Late success (payment authorized after the hold expired or the order was cancelled):
 * the transition is illegal / the reservation is gone, so we release the authorization instead of charging.
 */
export async function handleProviderEvent(evt: ProviderEvent): Promise<'processed' | 'duplicate'> {
  const existing = await WebhookEvent.findOne({ eventId: evt.eventId });
  if (existing?.status === 'done') return 'duplicate';
  if (!existing) {
    try {
      await WebhookEvent.create({ eventId: evt.eventId, status: 'processing' });
    } catch (e) {
      if (!isDuplicateKey(e)) throw e; // concurrent delivery: both proceed, the transition is idempotent
    }
  }

  const orderId = evt.orderId;
  if (!Types.ObjectId.isValid(orderId)) throw new AppError(400, 'bad_event', 'Invalid order id in event');
  // Remember the intent even if the order already moved on, so a cancel can find it.
  await Order.updateOne({ _id: orderId, 'payment.intentId': { $exists: false } }, { $set: { 'payment.intentId': evt.intentId } });

  if (evt.type === 'authorized') {
    try {
      await transition({ orderId, event: 'PAYMENT_AUTHORIZED', actor: SYSTEM, idempotencyKey: `webhook-${evt.eventId}` });
    } catch (e) {
      if (e instanceof AppError && (e.code === 'illegal_transition' || e.code === 'reservation_expired')) {
        logger.warn({ orderId, code: e.code }, 'late payment authorization: releasing it');
        if (e.code === 'reservation_expired') {
          await transition({ orderId, event: 'PAYMENT_EXPIRED', actor: SYSTEM, idempotencyKey: `expire-after-${evt.eventId}` }).catch(() => undefined);
        }
        await services().jobs.paymentAction(orderId, 'cancel');
      } else {
        throw e;
      }
    }
  } else {
    await transition({ orderId, event: 'PAYMENT_FAILED', actor: SYSTEM, idempotencyKey: `webhook-${evt.eventId}` }).catch((e) => {
      if (!(e instanceof AppError && e.code === 'illegal_transition')) throw e;
    });
  }

  await WebhookEvent.updateOne({ eventId: evt.eventId }, { $set: { status: 'done' } });
  return 'processed';
}

/** Executed by the payment-action job (retried with backoff). Provider calls carry idempotency keys, so retries are safe. */
export async function executePaymentAction(orderId: string, action: 'capture' | 'cancel'): Promise<void> {
  const order = await Order.findById(orderId);
  const intentId = order?.payment?.intentId;
  if (!order || !intentId) return;

  if (action === 'capture') {
    if (order.payment?.status === 'captured') return;
    const amount = order.settlement?.capturedMinor;
    if (amount == null) throw new Error(`order ${orderId} has no settlement amount`);
    await services().payments.capture(intentId, amount, `capture-${orderId}`);
    await Order.updateOne({ _id: orderId }, { $set: { 'payment.status': 'captured' } });
  } else {
    if (order.payment?.status === 'cancelled' || order.payment?.status === 'captured') return;
    await services().payments.cancelAuthorization(intentId, `cancel-${orderId}`);
    await Order.updateOne({ _id: orderId }, { $set: { 'payment.status': 'cancelled' } });
  }
}
