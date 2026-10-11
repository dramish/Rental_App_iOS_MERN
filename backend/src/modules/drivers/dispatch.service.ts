import type { ClientSession } from 'mongoose';
import { Types } from 'mongoose';
import { logger } from '../../config/logger';
import { AppError } from '../../utils/errors';
import type { GeoPoint } from '../../utils/geo';
import { withSession } from '../../utils/tx';
import { services } from '../../services';
import { Order } from '../orders/order.model';
import { DeliveryTask, Driver } from './driver.model';

export const OFFER_TTL_MS = 30_000;
export const MAX_DISPATCH_ATTEMPTS = 10;
export const SEARCH_RADIUS_M = 15_000;
export const REDISPATCH_DELAY_MS = 20_000;
export const LOCATION_FRESH_MS = 5 * 60_000;

export async function createTask(
  input: { orderId: Types.ObjectId; leg: 'DELIVERY' | 'RETURN'; pickup: GeoPoint; dropoff: GeoPoint },
  session: ClientSession,
) {
  const [task] = await DeliveryTask.create([{ ...input, status: 'OPEN' }], { session });
  return task!;
}

export async function completeTask(orderId: Types.ObjectId, leg: 'DELIVERY' | 'RETURN', session: ClientSession) {
  await DeliveryTask.updateOne({ orderId, leg, status: 'ASSIGNED' }, { $set: { status: 'DONE' } }, { session });
}

export async function cancelTasks(orderId: Types.ObjectId, session: ClientSession) {
  await DeliveryTask.updateMany({ orderId, status: { $in: ['OPEN', 'OFFERED', 'ASSIGNED'] } }, { $set: { status: 'CANCELLED' } }, { session });
}

/**
 * Offer an OPEN task to the nearest free, online driver who hasn't declined it.
 * One driver at a time: the offer is a conditional OPEN -> OFFERED flip, so two concurrent
 * dispatches can never offer the same task to two drivers.
 */
export async function dispatchTask(taskId: string): Promise<'offered' | 'no_candidate' | 'skipped' | 'gave_up'> {
  const counted = await DeliveryTask.findOneAndUpdate({ _id: taskId, status: 'OPEN' }, { $inc: { attempts: 1 } }, { new: true });
  if (!counted) return 'skipped';
  if (counted.attempts > MAX_DISPATCH_ATTEMPTS) {
    logger.warn({ taskId }, 'dispatch gave up: no driver found');
    return 'gave_up';
  }

  const busyTasks = await DeliveryTask.find({ status: { $in: ['OFFERED', 'ASSIGNED'] } }).select('offeredTo driverId');
  const excluded = new Set<string>(counted.declinedBy.map(String));
  for (const t of busyTasks) {
    if (t.offeredTo) excluded.add(String(t.offeredTo));
    if (t.driverId) excluded.add(String(t.driverId));
  }

  const candidate = await Driver.findOne({
    online: true,
    userId: { $nin: [...excluded].map((id) => new Types.ObjectId(id)) },
    locationUpdatedAt: { $gte: new Date(Date.now() - LOCATION_FRESH_MS) },
    location: { $near: { $geometry: counted.pickup, $maxDistance: SEARCH_RADIUS_M } },
  });

  if (!candidate) {
    await services().jobs.dispatchTask(taskId, REDISPATCH_DELAY_MS);
    return 'no_candidate';
  }

  const expiresAt = new Date(Date.now() + OFFER_TTL_MS);
  const offered = await DeliveryTask.findOneAndUpdate(
    { _id: taskId, status: 'OPEN' },
    { $set: { status: 'OFFERED', offeredTo: candidate.userId, offerExpiresAt: expiresAt } },
    { new: true },
  );
  if (!offered) return 'skipped';

  const driverUserId = String(candidate.userId);
  services().realtime.publish(`user:${driverUserId}`, 'task.offer', {
    taskId,
    orderId: String(offered.orderId),
    leg: offered.leg,
    pickup: offered.pickup,
    dropoff: offered.dropoff,
    expiresAt: expiresAt.toISOString(),
  });
  await services()
    .notifier.notifyUser(driverUserId, { title: 'New delivery request', body: 'Tap to review and accept', data: { taskId } })
    .catch((err) => logger.warn({ err }, 'offer push failed'));
  await services().jobs.scheduleOfferTimeout(taskId, driverUserId, OFFER_TTL_MS + 1000);
  return 'offered';
}

/** Offer timed out: return the task to the pool, remember who skipped it, and offer to the next driver. */
export async function expireOffer(taskId: string, driverUserId: string): Promise<boolean> {
  const reopened = await DeliveryTask.findOneAndUpdate(
    { _id: taskId, status: 'OFFERED', offeredTo: driverUserId, offerExpiresAt: { $lte: new Date() } },
    { $set: { status: 'OPEN', offeredTo: null, offerExpiresAt: null }, $addToSet: { declinedBy: new Types.ObjectId(driverUserId) } },
  );
  if (!reopened) return false; // accepted, declined, or cancelled in the meantime
  await services().jobs.dispatchTask(taskId);
  return true;
}

export async function declineTask(taskId: string, driverUserId: string): Promise<void> {
  const reopened = await DeliveryTask.findOneAndUpdate(
    { _id: taskId, status: 'OFFERED', offeredTo: driverUserId },
    { $set: { status: 'OPEN', offeredTo: null, offerExpiresAt: null }, $addToSet: { declinedBy: new Types.ObjectId(driverUserId) } },
  );
  if (!reopened) throw new AppError(409, 'offer_unavailable', 'This offer is no longer available');
  await services().jobs.dispatchTask(taskId);
}

/**
 * Accept: a conditional update (still OFFERED to me, not expired) plus the order's driver
 * assignment, in one transaction. A late accept after expiry, or after cancellation, gets 409.
 */
export async function acceptTask(taskId: string, driverUserId: string) {
  const task = await withSession(undefined, async (session) => {
    const claimed = await DeliveryTask.findOneAndUpdate(
      { _id: taskId, status: 'OFFERED', offeredTo: driverUserId, offerExpiresAt: { $gt: new Date() } },
      { $set: { status: 'ASSIGNED', driverId: driverUserId, assignedAt: new Date() } },
      { new: true, session },
    );
    if (!claimed) throw new AppError(409, 'offer_unavailable', 'This offer is no longer available');

    const expectedStatus = claimed.leg === 'DELIVERY' ? 'CONFIRMED' : 'RETURN_SCHEDULED';
    const field = claimed.leg === 'DELIVERY' ? 'deliveryDriverId' : 'returnDriverId';
    const updated = await Order.updateOne({ _id: claimed.orderId, status: expectedStatus }, { $set: { [field]: driverUserId } }, { session });
    if (updated.modifiedCount !== 1) throw new AppError(409, 'order_not_assignable', 'Order is no longer waiting for a driver');
    return claimed;
  });

  const orderId = String(task.orderId);
  services().realtime.publish(`order:${orderId}`, 'order.driver_assigned', { orderId, leg: task.leg });
  return task;
}
