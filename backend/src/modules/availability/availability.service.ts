import { notImplemented } from '../../utils/errors';

/**
 * TBI (piece #1). See the spec: per-day buckets, one Mongo transaction,
 * conditional $inc per day, all-or-nothing across items, exactly-once release.
 *
 * You also write the models: AvailabilityDay { skuId, date, reserved } (unique on skuId+date)
 * and Reservation { orderId, skuId, qty, startDate, endDate, status, holdExpiresAt }.
 */
export interface ReserveInput {
  orderId: string;
  items: { skuId: string; qty: number }[];
  rentalStart: Date;
  rentalEnd: Date;
  holdSeconds: number;
  idempotencyKey: string;
}

export interface ReservationDTO {
  id: string;
  orderId: string;
  skuId: string;
  qty: number;
  startDate: Date;
  endDate: Date;
  status: 'HELD' | 'CONFIRMED' | 'RELEASED';
  holdExpiresAt: Date | null;
}

export async function reserve(_input: ReserveInput): Promise<ReservationDTO[]> {
  throw notImplemented('reserve()');
}

/** Must decrement the same days exactly once, even if called twice or concurrently. */
export async function release(_orderId: string): Promise<void> {
  throw notImplemented('release()');
}

/** Hold -> confirmed after payment succeeds. Must not race with hold expiry. */
export async function confirm(_orderId: string): Promise<void> {
  throw notImplemented('confirm()');
}
