import { Types } from 'mongoose';
import { z } from 'zod';
import { AppError } from '../../utils/errors';
import { etaMinutes, haversineMeters, point } from '../../utils/geo';
import { services } from '../../services';
import type { CachedLocation } from '../../services/types';
import { DeliveryTask, Driver } from '../drivers/driver.model';
import { Order } from '../orders/order.model';
import { getOrderForUser } from '../orders/order.service';
import { LocationPoint } from './locationPoint.model';

export const MIN_INTERVAL_MS = 2_000; // at most one point per 2s (by recordedAt)
export const MIN_DISTANCE_M = 10; // ignore jitter smaller than this...
export const STATIONARY_HEARTBEAT_MS = 15_000; // ...unless this long has passed (proof of life)
export const MAX_ACCURACY_M = 100; // drop low-quality fixes
export const MAX_FUTURE_SKEW_MS = 60_000;
export const COARSE_LOCATION_INTERVAL_MS = 30_000;
const LIVE_ACTIVITY_INTERVAL_MS = 60_000;

export const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(10_000),
  speed: z.number().min(0).max(100).optional(),
  recordedAt: z.string().datetime(),
  seq: z.number().int().min(0),
});
export const batchSchema = z.object({ points: z.array(pointSchema).min(1).max(200) });
export type IncomingPoint = z.infer<typeof pointSchema>;

export type DropReason = 'stale' | 'inaccurate' | 'future' | 'throttled' | 'duplicate';

/**
 * Pure filter. `prev` is the last ACCEPTED point.
 * Spacing uses the device's recordedAt (not arrival time) so an offline batch replayed later is
 * thinned the same way live points are, instead of being dropped wholesale.
 */
export function shouldAccept(prev: CachedLocation | null, p: IncomingPoint, nowMs: number): { accept: true } | { accept: false; reason: DropReason } {
  const t = Date.parse(p.recordedAt);
  if (p.accuracy > MAX_ACCURACY_M) return { accept: false, reason: 'inaccurate' };
  if (t > nowMs + MAX_FUTURE_SKEW_MS) return { accept: false, reason: 'future' };
  if (!prev) return { accept: true };
  if (p.seq <= prev.seq) return { accept: false, reason: 'stale' };
  const elapsed = t - Date.parse(prev.recordedAt);
  if (elapsed < MIN_INTERVAL_MS) return { accept: false, reason: 'throttled' };
  const moved = haversineMeters(prev, p);
  if (moved < MIN_DISTANCE_M && elapsed < STATIONARY_HEARTBEAT_MS) return { accept: false, reason: 'duplicate' };
  return { accept: true };
}

const lastActivityPush = new Map<string, number>();

/**
 * Ingest a batch from one driver (live points, or a replay after being offline).
 *  - ordered by seq, filtered by shouldAccept
 *  - accepted points -> history (Mongo, TTL) ; the latest -> cache (fast reads) ; coarse position -> Driver (for $near dispatch)
 *  - only the LATEST accepted point is fanned out in realtime (clients want "now", not a replay)
 */
export async function ingest(driverUserId: string, points: IncomingPoint[]) {
  const sorted = [...points].sort((a, b) => a.seq - b.seq);
  const cache = services().locationCache;
  let prev = await cache.get(driverUserId);
  const nowMs = Date.now();

  const accepted: IncomingPoint[] = [];
  const dropped: { seq: number; reason: DropReason }[] = [];
  for (const p of sorted) {
    const verdict = shouldAccept(prev, p, nowMs);
    if (verdict.accept) {
      accepted.push(p);
      prev = { lat: p.lat, lng: p.lng, accuracy: p.accuracy, speed: p.speed, recordedAt: p.recordedAt, seq: p.seq };
    } else {
      dropped.push({ seq: p.seq, reason: verdict.reason });
    }
  }
  if (accepted.length === 0) return { accepted: 0, dropped };

  const latest = accepted[accepted.length - 1]!;
  const driverId = new Types.ObjectId(driverUserId);
  const task = await DeliveryTask.findOne({ driverId, status: 'ASSIGNED' });

  await LocationPoint.insertMany(
    accepted.map((p) => ({ driverId, orderId: task?.orderId, lat: p.lat, lng: p.lng, accuracy: p.accuracy, speed: p.speed, seq: p.seq, recordedAt: new Date(p.recordedAt) })),
    { ordered: false },
  );
  await cache.set(driverUserId, { lat: latest.lat, lng: latest.lng, accuracy: latest.accuracy, speed: latest.speed, recordedAt: latest.recordedAt, seq: latest.seq });

  await Driver.updateOne(
    { userId: driverId, $or: [{ locationUpdatedAt: null }, { locationUpdatedAt: { $lt: new Date(nowMs - COARSE_LOCATION_INTERVAL_MS) } }] },
    { $set: { location: point(latest.lat, latest.lng), locationUpdatedAt: new Date(nowMs) } },
  );

  if (task) await fanOut(task, latest);
  return { accepted: accepted.length, dropped };
}

async function fanOut(task: InstanceType<typeof DeliveryTask>, latest: IncomingPoint) {
  const order = await Order.findById(task.orderId).select('status version');
  if (!order) return;
  // Heading to the pickup point first (shop for delivery, customer for return), then to the dropoff.
  const headingToPickup = order.status === 'CONFIRMED' || order.status === 'RETURN_SCHEDULED';
  const [tLng, tLat] = (headingToPickup ? task.pickup : task.dropoff)!.coordinates as unknown as [number, number];
  const eta = etaMinutes(haversineMeters(latest, { lat: tLat, lng: tLng }));
  const orderId = String(task.orderId);

  services().realtime.publish(`order:${orderId}`, 'driver.location', {
    orderId,
    lat: latest.lat,
    lng: latest.lng,
    recordedAt: latest.recordedAt,
    seq: latest.seq,
    etaMinutes: eta,
  });

  const last = lastActivityPush.get(orderId) ?? 0;
  if (Date.now() - last >= LIVE_ACTIVITY_INTERVAL_MS) {
    lastActivityPush.set(orderId, Date.now());
    await services().notifier.updateLiveActivity(orderId, { status: order.status, etaMinutes: eta, version: order.version }).catch(() => undefined);
  }
}

/** REST resync for the tracking screen (initial load, reconnect, or a seq gap). */
export async function getTracking(orderId: string, userId: string) {
  const order = await getOrderForUser(orderId, userId);
  const driverId = order.status === 'RETURN_SCHEDULED' || order.status === 'PICKED_UP' ? order.returnDriverId : order.deliveryDriverId;
  let driverLocation: (CachedLocation & { etaMinutes?: number }) | null = null;
  if (driverId) {
    const loc = await services().locationCache.get(String(driverId));
    if (loc) driverLocation = loc;
  }
  if (!order.address) throw new AppError(500, 'corrupt_order', 'Order has no address');
  return { orderId: String(order._id), status: order.status, version: order.version, driverLocation };
}
