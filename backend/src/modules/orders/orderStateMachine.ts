import type { Role } from '../../types/express';
import type { OrderStatus } from './order.model';

export type OrderEventName =
  | 'PAYMENT_AUTHORIZED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_EXPIRED'
  | 'CUSTOMER_CANCEL'
  | 'SHOP_CANCEL'
  | 'DRIVER_PICKED_UP_FROM_SHOP'
  | 'DRIVER_DELIVERED'
  | 'RENTAL_STARTED'
  | 'MARK_OVERDUE'
  | 'REQUEST_RETURN'
  | 'DRIVER_PICKED_UP_RETURN'
  | 'SHOP_INSPECTED'
  | 'SETTLE';

export type Actor = Role | 'system';

export interface TransitionRule {
  from: OrderStatus[];
  to: OrderStatus;
  actors: Actor[];
  /** Payload fields that must be present (validated in the service). */
  requires?: ('proofPhotoUrl' | 'damageMinor')[];
}

/** The whole lifecycle as data. Anything not listed here is illegal. */
export const TRANSITIONS: Record<OrderEventName, TransitionRule> = {
  PAYMENT_AUTHORIZED: { from: ['PENDING_PAYMENT'], to: 'CONFIRMED', actors: ['system'] },
  PAYMENT_FAILED: { from: ['PENDING_PAYMENT'], to: 'PAYMENT_FAILED', actors: ['system'] },
  PAYMENT_EXPIRED: { from: ['PENDING_PAYMENT'], to: 'PAYMENT_FAILED', actors: ['system'] },
  CUSTOMER_CANCEL: { from: ['PENDING_PAYMENT', 'CONFIRMED'], to: 'CANCELLED', actors: ['customer'] },
  SHOP_CANCEL: { from: ['CONFIRMED'], to: 'CANCELLED', actors: ['shop'] },
  DRIVER_PICKED_UP_FROM_SHOP: { from: ['CONFIRMED'], to: 'OUT_FOR_DELIVERY', actors: ['driver'] },
  DRIVER_DELIVERED: { from: ['OUT_FOR_DELIVERY'], to: 'DELIVERED', actors: ['driver'], requires: ['proofPhotoUrl'] },
  RENTAL_STARTED: { from: ['DELIVERED'], to: 'IN_USE', actors: ['system', 'customer'] },
  MARK_OVERDUE: { from: ['IN_USE'], to: 'OVERDUE', actors: ['system'] },
  REQUEST_RETURN: { from: ['IN_USE', 'OVERDUE'], to: 'RETURN_SCHEDULED', actors: ['customer', 'system'] },
  DRIVER_PICKED_UP_RETURN: { from: ['RETURN_SCHEDULED'], to: 'PICKED_UP', actors: ['driver'], requires: ['proofPhotoUrl'] },
  SHOP_INSPECTED: { from: ['PICKED_UP'], to: 'INSPECTED', actors: ['shop'], requires: ['damageMinor'] },
  SETTLE: { from: ['INSPECTED'], to: 'SETTLED', actors: ['shop', 'system'] },
};

export const TERMINAL_STATUSES: OrderStatus[] = ['SETTLED', 'CANCELLED', 'PAYMENT_FAILED'];

export const isOrderEvent = (e: string): e is OrderEventName => Object.prototype.hasOwnProperty.call(TRANSITIONS, e);
