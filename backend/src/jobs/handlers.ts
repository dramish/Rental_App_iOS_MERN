import { logger } from '../config/logger';
import { dispatchTask, expireOffer } from '../modules/drivers/dispatch.service';
import { transitionFromJob } from '../modules/orders/order.service';
import { executePaymentAction } from '../modules/payments/payments.service';

const SYSTEM = { id: 'system', role: 'system' } as const;

/** One handler per job name. All are safe to run more than once (jobs are at-least-once). */
export async function processJob(name: string, data: Record<string, string>): Promise<void> {
  switch (name) {
    case 'hold-expiry':
      return transitionFromJob({ orderId: data['orderId']!, event: 'PAYMENT_EXPIRED', actor: SYSTEM, idempotencyKey: `expire-${data['orderId']}` });
    case 'rental-start':
      return transitionFromJob({ orderId: data['orderId']!, event: 'RENTAL_STARTED', actor: SYSTEM, idempotencyKey: `start-${data['orderId']}` });
    case 'overdue':
      return transitionFromJob({ orderId: data['orderId']!, event: 'MARK_OVERDUE', actor: SYSTEM, idempotencyKey: `overdue-${data['orderId']}` });
    case 'dispatch':
      await dispatchTask(data['taskId']!);
      return;
    case 'offer-timeout':
      await expireOffer(data['taskId']!, data['driverUserId']!);
      return;
    case 'payment-action':
      return executePaymentAction(data['orderId']!, data['action'] as 'capture' | 'cancel');
    default:
      logger.warn({ name }, 'unknown job');
  }
}
