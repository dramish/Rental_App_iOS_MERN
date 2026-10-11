import type { ClientSession } from 'mongoose';
import { Types } from 'mongoose';
import { AppError } from '../../utils/errors';
import { addDays, eachDay, parseDay, todayUTC, diffDays, formatDay } from '../../utils/dates';
import { isDuplicateKey, withSession } from '../../utils/tx';
import { Sku } from '../skus/sku.model';
import { AvailabilityDay, Reservation } from './availability.model';

export const MAX_RENTAL_DAYS = 30;

export interface ReserveItem {
  skuId: string;
  qty: number;
}

export interface ReserveInput {
  orderId: string;
  items: ReserveItem[];
  rentalStart: string; // 'YYYY-MM-DD' (UTC day, inclusive)
  rentalEnd: string; // inclusive
  holdSeconds: number;
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

export interface Prepared {
  start: Date;
  end: Date;
  items: { skuId: string; qty: number; totalQty: number; bufferDays: number }[];
}

const toDTO = (r: InstanceType<typeof Reservation>): ReservationDTO => ({
  id: String(r._id),
  orderId: String(r.orderId),
  skuId: String(r.skuId),
  qty: r.qty,
  startDate: r.startDate,
  endDate: r.endDate,
  status: r.status as ReservationDTO['status'],
  holdExpiresAt: r.holdExpiresAt ?? null,
});

/** Pure validation of a rental window. Returns parsed UTC days. */
export function validateWindow(rentalStart: string, rentalEnd: string, now: Date = new Date()) {
  const start = parseDay(rentalStart);
  const end = parseDay(rentalEnd);
  if (end.getTime() < start.getTime()) throw new AppError(422, 'invalid_window', 'rentalEnd must not be before rentalStart');
  if (start.getTime() < todayUTC(now).getTime()) throw new AppError(422, 'invalid_window', 'rentalStart is in the past');
  const days = diffDays(start, end) + 1;
  if (days > MAX_RENTAL_DAYS) throw new AppError(422, 'invalid_window', `Rentals are limited to ${MAX_RENTAL_DAYS} days`);
  return { start, end, days };
}

/**
 * Step 1 (OUTSIDE any transaction): validate, load SKUs, and make sure every day bucket exists.
 * Why outside: a transaction reads from a snapshot taken at its first operation. Buckets created
 * after that snapshot would be invisible to the conditional update and look falsely "sold out".
 */
export async function prepareReservation(items: ReserveItem[], rentalStart: string, rentalEnd: string): Promise<Prepared> {
  const { start, end } = validateWindow(rentalStart, rentalEnd);
  if (items.length === 0) throw new AppError(422, 'invalid_items', 'No items');
  const ids = new Set(items.map((i) => i.skuId));
  if (ids.size !== items.length) throw new AppError(422, 'invalid_items', 'Duplicate SKU in items');
  for (const i of items) {
    if (!Types.ObjectId.isValid(i.skuId) || !Number.isInteger(i.qty) || i.qty < 1) {
      throw new AppError(422, 'invalid_items', 'Invalid item');
    }
  }

  const skus = await Sku.find({ _id: { $in: [...ids] }, active: true });
  if (skus.length !== ids.size) throw new AppError(404, 'sku_not_found', 'One or more items are unavailable');
  const bySku = new Map(skus.map((s) => [String(s._id), s]));

  const prepared: Prepared['items'] = [];
  for (const i of [...items].sort((a, b) => a.skuId.localeCompare(b.skuId))) {
    const sku = bySku.get(i.skuId)!;
    if (i.qty > sku.totalQty) throw new AppError(409, 'sold_out', 'Requested quantity exceeds stock', { skuId: i.skuId });
    prepared.push({ skuId: i.skuId, qty: i.qty, totalQty: sku.totalQty, bufferDays: sku.bufferDays });
  }

  for (const p of prepared) {
    const days = eachDay(addDays(start, -p.bufferDays), addDays(end, p.bufferDays));
    try {
      await AvailabilityDay.bulkWrite(
        days.map((date) => ({
          updateOne: { filter: { skuId: new Types.ObjectId(p.skuId), date }, update: { $setOnInsert: { reserved: 0 } }, upsert: true },
        })),
        { ordered: false },
      );
    } catch (e) {
      // A concurrent request created the same bucket first. That's fine: it exists now.
      if (!isDuplicateKey(e) && !String((e as Error).message).includes('E11000')) throw e;
    }
  }
  return { start, end, items: prepared };
}

/**
 * Step 2: reserve every item atomically (all or nothing) in ONE transaction.
 * Per day: conditional $inc guarded by `reserved <= total - qty`. If any day on any SKU
 * does not match, we throw and the transaction rolls everything back.
 * Safe to retry: a second call for the same order returns the existing reservations.
 */
export async function reserve(input: ReserveInput, opts: { session?: ClientSession; prepared?: Prepared } = {}): Promise<ReservationDTO[]> {
  const prepared = opts.prepared ?? (await prepareReservation(input.items, input.rentalStart, input.rentalEnd));
  const orderId = new Types.ObjectId(input.orderId);

  const existing = await Reservation.find({ orderId, status: { $ne: 'RELEASED' } }).session(opts.session ?? null);
  if (existing.length > 0) return existing.map(toDTO);

  try {
    const created = await withSession(opts.session, async (session) => {
      const holdExpiresAt = new Date(Date.now() + input.holdSeconds * 1000);
      const docs = [];
      for (const item of prepared.items) {
        const skuId = new Types.ObjectId(item.skuId);
        const blockedStart = addDays(prepared.start, -item.bufferDays);
        const blockedEnd = addDays(prepared.end, item.bufferDays);
        const days = eachDay(blockedStart, blockedEnd);

        const res = await AvailabilityDay.bulkWrite(
          days.map((date) => ({
            updateOne: {
              filter: { skuId, date, reserved: { $lte: item.totalQty - item.qty } },
              update: { $inc: { reserved: item.qty } },
            },
          })),
          { session, ordered: true },
        );
        if (res.modifiedCount !== days.length) {
          throw new AppError(409, 'sold_out', 'Not available for the selected dates', { skuId: item.skuId });
        }
        docs.push({
          orderId,
          skuId,
          qty: item.qty,
          startDate: prepared.start,
          endDate: prepared.end,
          blockedStart,
          blockedEnd,
          status: 'HELD' as const,
          holdExpiresAt,
        });
      }
      return Reservation.create(docs, { session, ordered: true });
    });
    return created.map(toDTO);
  } catch (e) {
    if (!opts.session && isDuplicateKey(e)) {
      // Lost a race with a concurrent reserve() for the same order: return the winner's result.
      const winner = await Reservation.find({ orderId, status: { $ne: 'RELEASED' } });
      if (winner.length > 0) return winner.map(toDTO);
    }
    throw e;
  }
}

/** HELD -> CONFIRMED for the whole order, atomically. Throws 409 reservation_expired if any hold was already released. */
export async function confirmReservations(orderId: string, session?: ClientSession): Promise<void> {
  await withSession(session, async (s) => {
    const docs = await Reservation.find({ orderId: new Types.ObjectId(orderId), status: { $in: ['HELD', 'CONFIRMED'] } }).session(s);
    if (docs.length === 0) throw new AppError(409, 'reservation_expired', 'Reservation expired');
    for (const d of docs) {
      if (d.status === 'CONFIRMED') continue;
      const flipped = await Reservation.findOneAndUpdate(
        { _id: d._id, status: 'HELD' },
        { $set: { status: 'CONFIRMED', holdExpiresAt: null } },
        { session: s },
      );
      if (!flipped) throw new AppError(409, 'reservation_expired', 'Reservation expired');
    }
  });
}

/**
 * Release capacity exactly once. Each reservation is flipped with a conditional update;
 * only the caller that wins the flip decrements the day buckets, so double calls and
 * concurrent calls cannot double-decrement.
 */
export async function releaseReservations(orderId: string, opts: { session?: ClientSession; onlyHeld?: boolean } = {}): Promise<number> {
  const statuses: ('HELD' | 'CONFIRMED')[] = opts.onlyHeld ? ['HELD'] : ['HELD', 'CONFIRMED'];
  return withSession(opts.session, async (s) => {
    const docs = await Reservation.find({ orderId: new Types.ObjectId(orderId), status: { $in: statuses } }).session(s);
    let released = 0;
    for (const d of docs) {
      const flipped = await Reservation.findOneAndUpdate(
        { _id: d._id, status: { $in: statuses } },
        { $set: { status: 'RELEASED', releasedAt: new Date() } },
        { session: s },
      );
      if (!flipped) continue;
      await AvailabilityDay.updateMany(
        { skuId: d.skuId, date: { $gte: d.blockedStart, $lte: d.blockedEnd } },
        { $inc: { reserved: -d.qty } },
        { session: s },
      );
      released++;
    }
    return released;
  });
}

/** Remaining units per day for the calendar UI. Days without a bucket have full availability. */
export async function getAvailability(skuId: string, from: string, to: string) {
  const start = parseDay(from);
  const end = parseDay(to);
  if (end.getTime() < start.getTime() || diffDays(start, end) > 92) throw new AppError(422, 'invalid_window', 'Invalid range (max 93 days)');
  if (!Types.ObjectId.isValid(skuId)) throw new AppError(404, 'not_found', 'SKU not found');
  const sku = await Sku.findById(skuId);
  if (!sku) throw new AppError(404, 'not_found', 'SKU not found');
  const rows = await AvailabilityDay.find({ skuId: sku._id, date: { $gte: start, $lte: end } });
  const reserved = new Map(rows.map((r) => [formatDay(r.date), r.reserved]));
  return eachDay(start, end).map((d) => ({
    date: formatDay(d),
    available: Math.max(0, sku.totalQty - (reserved.get(formatDay(d)) ?? 0)),
  }));
}
