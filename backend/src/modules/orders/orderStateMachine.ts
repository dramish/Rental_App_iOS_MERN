import type { Role } from '../../types/express';
import { notImplemented } from '../../utils/errors';

/**
 * TBI (piece #2). Types are given so the table can be data, not nested ifs.
 */
export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAYMENT_FAILED'
  | 'CONFIRMED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'IN_USE'
  | 'RETURN_SCHEDULED'
  | 'PICKED_UP'
  | 'INSPECTED'
  | 'SETTLED'
  | 'OVERDUE'
  | 'CANCELLED';

export type OrderEvent = string; // TBI: make this a union, e.g. 'PAYMENT_SUCCEEDED' | 'DRIVER_PICKUP' | ...

export interface TransitionRule {
  from: OrderStatus[];
  to: OrderStatus;
  actors: (Role | 'system')[];
  // guard?: (order, payload) => boolean
}

// TBI: the transition table, as data.
export const TRANSITIONS: Record<string, TransitionRule> = {};

export interface TransitionInput {
  orderId: string;
  event: OrderEvent;
  actor: { id: string; role: Role | 'system' };
  idempotencyKey: string;
  payload?: Record<string, unknown>;
}

export async function transition(_input: TransitionInput): Promise<unknown> {
  throw notImplemented('transition()');
}
