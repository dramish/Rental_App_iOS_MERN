import mongoose, { Types, type ClientSession } from 'mongoose';
import { z } from 'zod';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import type { Role } from '../../types/express';
import { AppError } from '../../utils/errors';
import { addDays, parseDay, todayUTC } from '../../utils/dates';
import { point } from '../../utils/geo';
import { isDuplicateKey } from '../../utils/tx';
import { services } from '../../services';
import { confirmReservations, prepareReservation, releaseReservations, reserve, validateWindow } from '../availability/availability.service';
import { cancelTasks, completeTask, createTask } from '../drivers/dispatch.service';
import { Shop } from '../shops/shop.model';
import { Sku } from '../skus/sku.model';
import { Order, OrderEvent } from './order.model';
import { isOrderEvent, TRANSITIONS } from './orderStateMachine';
import { computePricing, computeSettlement } from './pricing';

type OrderDoc = InstanceType<typeof Order>;
type AfterCommit = () => Promise<void>;

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

export const placeOrderSchema = z.object({
  items: z.array(z.object({ skuId: z.string(), qty: z.number().int().min(1).max(1000) })).min(1).max(20),
  rentalStart: z.string(),
  rentalEnd: z.string(),
  address: z.object({
    line1: z.string().min(1).max(200),
    city: z.string().min(1).max(60),
    postalCode: z.string().min(3).max(12),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
});
export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

/**
 * 1. validate + make sure day buckets exist (outside the transaction)
 * 2. ONE transaction: create the order, its first audit event, and reserve every item (all or nothing)
 * 3. after commit: schedule hold expiry, then ask the payment provider for an authorization
 * If step 3 fails the order is failed via the normal state machine, which releases the hold.
 */
export async function placeOrder(customerId: string, input: PlaceOrderInput, idempotencyKey: string) {
  const { days } = validateWindow(input.rentalStart, input.rentalEnd);
  const prepared = await prepareReservation(input.items, input.rentalStart, input.rentalEnd);

  const skus = await Sku.find({ _id: { $in: input.items.map((i) => i.skuId) } });
  const shopIds = new Set(skus.map((s) => String(s.shopId)));
  if (shopIds.size !== 1) throw new AppError(422, 'mixed_shops', 'An order can only contain items from one shop');
  const shopId = [...shopIds][0]!;
  const shop = await Shop.findOne({ userId: shopId });
  if (!shop) throw new AppError(422, 'shop_not_ready', 'This shop has not set up its pickup location');
  const currency = skus[0]!.currency;
  if (skus.some((s) => s.currency !== currency)) throw new AppError(422, 'mixed_currency', 'Items must share a currency');

  const bySku = new Map(skus.map((s) => [String(s._id), s]));
  const lines = input.items.map((i) => {
    const s = bySku.get(i.skuId)!;
    return { skuId: s._id, title: s.title, qty: i.qty, dailyPriceMinor: s.dailyPriceMinor, depositMinor: s.depositMinor };
  });
  const pricing = computePricing(lines, days);
  const orderId = new Types.ObjectId();

  await mongoose.connection.transaction(async (session) => {
    await Order.create(
      [
        {
          _id: orderId,
          customerId,
          shopId,
          items: lines,
          rentalStart: input.rentalStart,
          rentalEnd: input.rentalEnd,
          days,
          address: { line1: input.address.line1, city: input.address.city, postalCode: input.address.postalCode, location: point(input.address.lat, input.address.lng) },
          pickupLocation: shop.location,
          currency,
          ...pricing,
          status: 'PENDING_PAYMENT',
          version: 1,
        },
      ],
      { session },
    );
    await OrderEvent.create(
      [{ orderId, version: 1, event: 'ORDER_PLACED', toStatus: 'PENDING_PAYMENT', actorId: customerId, actorRole: 'customer', idempotencyKey: `place-${idempotencyKey}` }],
      { session },
    );
    await reserve(
      { orderId: String(orderId), items: input.items, rentalStart: input.rentalStart, rentalEnd: input.rentalEnd, holdSeconds: env.HOLD_SECONDS },
      { session, prepared },
    );
  });

  await services().jobs.scheduleHoldExpiry(String(orderId), env.HOLD_SECONDS * 1000 + 2000);

  try {
    const auth = await services().payments.createAuthorization({
      orderId: String(orderId),
      amountMinor: pricing.totalMinor,
      currency,
      idempotencyKey: `auth-${orderId}`,
    });
    await Order.updateOne({ _id: orderId }, { $set: { 'payment.intentId': auth.intentId } });
    const fresh = (await Order.findById(orderId))!;
    return { order: fresh, clientSecret: auth.clientSecret };
  } catch (err) {
    logger.error({ err, orderId: String(orderId) }, 'payment authorization failed');
    await transition({ orderId: String(orderId), event: 'PAYMENT_FAILED', actor: { id: 'system', role: 'system' }, idempotencyKey: `auth-failed-${orderId}` }).catch(() => undefined);
    throw new AppError(502, 'payment_unavailable', 'Could not start payment. Please try again.');
  }
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export interface TransitionInput {
  orderId: string;
  event: string;
  actor: { id: string; role: Role | 'system' };
  idempotencyKey: string;
  payload?: Record<string, unknown>;
}

const payloadSchemas = {
  proofPhotoUrl: z.string().url().max(500),
  damageMinor: z.number().int().min(0).max(10_000_000),
};

function assertActorMayAct(order: OrderDoc, actor: { id: string; role: Role | 'system' }, event: string): void {
  if (actor.role === 'system') return;
  const id = actor.id;
  const forbidden = () => new AppError(403, 'forbidden', 'You cannot perform this action on this order');
  if (actor.role === 'customer' && String(order.customerId) !== id) throw forbidden();
  if (actor.role === 'shop' && String(order.shopId) !== id) throw forbidden();
  if (actor.role === 'driver') {
    const assigned = event === 'DRIVER_PICKED_UP_RETURN' ? order.returnDriverId : order.deliveryDriverId;
    if (!assigned || String(assigned) !== id) throw forbidden();
  }
}

/**
 * The single place order state changes. In one transaction it:
 *  - replays if this idempotencyKey was already applied (no double effects)
 *  - checks the transition table, actor role, and ownership
 *  - applies the status change with a conditional update (status AND version must still match)
 *  - appends the audit event, and runs in-transaction effects (reservations, driver tasks)
 * Realtime, push, and job scheduling happen only AFTER commit. If the process dies between commit
 * and those side effects, clients still converge: they resync from REST using `version`.
 */
export async function transition(input: TransitionInput): Promise<{ order: OrderDoc; replayed: boolean }> {
  if (!isOrderEvent(input.event)) throw new AppError(422, 'unknown_event', `Unknown event ${input.event}`);
  const event = input.event;
  const rule = TRANSITIONS[event];
  if (!rule.actors.includes(input.actor.role)) throw new AppError(403, 'forbidden', `${input.actor.role} cannot perform ${event}`);
  if (!Types.ObjectId.isValid(input.orderId)) throw new AppError(404, 'not_found', 'Order not found');
  const orderId = new Types.ObjectId(input.orderId);

  const payload = input.payload ?? {};
  for (const field of rule.requires ?? []) {
    const parsed = payloadSchemas[field].safeParse(payload[field]);
    if (!parsed.success) throw new AppError(422, 'invalid_payload', `${field} is required`, parsed.error.flatten());
  }

  const replay = async () => {
    const prior = await OrderEvent.findOne({ orderId, idempotencyKey: input.idempotencyKey });
    if (!prior) return null;
    if (prior.event !== event) throw new AppError(422, 'idempotency_key_reuse', 'Key was already used for a different event');
    return { order: (await Order.findById(orderId))!, replayed: true };
  };

  let outcome: { order: OrderDoc; after: AfterCommit[]; from: string };
  try {
    outcome = await mongoose.connection.transaction(async (session) => {
      const after: AfterCommit[] = [];
      const prior = await OrderEvent.findOne({ orderId, idempotencyKey: input.idempotencyKey }).session(session);
      if (prior) {
        if (prior.event !== event) throw new AppError(422, 'idempotency_key_reuse', 'Key was already used for a different event');
        return { order: (await Order.findById(orderId).session(session))!, after, from: 'REPLAY' };
      }

      const order = await Order.findById(orderId).session(session);
      if (!order) throw new AppError(404, 'not_found', 'Order not found');
      if (!rule.from.includes(order.status)) {
        throw new AppError(409, 'illegal_transition', `Cannot ${event} an order that is ${order.status}`, { status: order.status, event });
      }
      assertActorMayAct(order, input.actor, event);

      const set: Record<string, unknown> = { status: rule.to };
      await applyEffects({ order, event, payload, set, after, session });

      const updated = await Order.findOneAndUpdate(
        { _id: order._id, status: order.status, version: order.version },
        { $set: set, $inc: { version: 1 } },
        { new: true, session },
      );
      if (!updated) throw new AppError(409, 'conflict', 'Order changed concurrently, retry');

      await OrderEvent.create(
        [
          {
            orderId,
            version: updated.version,
            event,
            fromStatus: order.status,
            toStatus: rule.to,
            actorId: input.actor.id,
            actorRole: input.actor.role,
            idempotencyKey: input.idempotencyKey,
            payload,
          },
        ],
        { session },
      );
      after.push(() => publishOrderUpdate(updated, event));
      return { order: updated, after, from: order.status };
    });
  } catch (e) {
    if (isDuplicateKey(e)) {
      const r = await replay(); // concurrent request with the same key won the race
      if (r) return r;
    }
    throw e;
  }

  if (outcome.from === 'REPLAY') return { order: outcome.order, replayed: true };
  for (const fn of outcome.after) {
    await fn().catch((err) => logger.error({ err, orderId: input.orderId, event }, 'post-commit side effect failed'));
  }
  return { order: outcome.order, replayed: false };
}

async function applyEffects(ctx: {
  order: OrderDoc;
  event: keyof typeof TRANSITIONS;
  payload: Record<string, unknown>;
  set: Record<string, unknown>;
  after: AfterCommit[];
  session: ClientSession;
}): Promise<void> {
  const { order, event, payload, set, after, session } = ctx;
  const id = String(order._id);
  const jobs = () => services().jobs;
  const cancelPayment = () => {
    if (order.payment?.intentId) after.push(() => jobs().paymentAction(id, 'cancel'));
  };

  switch (event) {
    case 'PAYMENT_AUTHORIZED': {
      await confirmReservations(id, session); // throws 409 reservation_expired if the hold lapsed
      const task = await createTask({ orderId: order._id, leg: 'DELIVERY', pickup: order.pickupLocation as never, dropoff: order.address!.location as never }, session);
      set['payment.status'] = 'authorized';
      const startMs = parseDay(order.rentalStart).getTime() - Date.now();
      const overdueMs = addDays(parseDay(order.rentalEnd), 1).getTime() - Date.now();
      after.push(
        () => jobs().cancelHoldExpiry(id),
        () => jobs().scheduleRentalStart(id, Math.max(0, startMs)),
        () => jobs().scheduleOverdue(id, Math.max(0, overdueMs)),
        () => jobs().dispatchTask(String(task._id)),
      );
      break;
    }
    case 'PAYMENT_FAILED':
    case 'PAYMENT_EXPIRED':
      await releaseReservations(id, { session });
      cancelPayment();
      break;
    case 'CUSTOMER_CANCEL':
    case 'SHOP_CANCEL':
      await releaseReservations(id, { session });
      await cancelTasks(order._id, session);
      cancelPayment();
      after.push(() => jobs().cancelHoldExpiry(id));
      break;
    case 'DRIVER_DELIVERED':
      await completeTask(order._id, 'DELIVERY', session);
      set['deliveredAt'] = new Date();
      set['deliveryProofUrl'] = payload['proofPhotoUrl'];
      break;
    case 'REQUEST_RETURN': {
      const task = await createTask({ orderId: order._id, leg: 'RETURN', pickup: order.address!.location as never, dropoff: order.pickupLocation as never }, session);
      after.push(() => jobs().dispatchTask(String(task._id)));
      break;
    }
    case 'DRIVER_PICKED_UP_RETURN':
      await completeTask(order._id, 'RETURN', session);
      set['pickedUpAt'] = new Date();
      break;
    case 'SHOP_INSPECTED':
      set['settlement.damageMinor'] = payload['damageMinor'];
      break;
    case 'SETTLE': {
      const returnedOn = todayUTC(order.pickedUpAt ?? new Date());
      const s = computeSettlement({
        rentMinor: order.rentMinor,
        depositMinor: order.depositMinor,
        days: order.days,
        rentalEnd: order.rentalEnd,
        returnedOn,
        damageMinor: order.settlement?.damageMinor ?? 0,
      });
      for (const [k, v] of Object.entries(s)) set[`settlement.${k}`] = v;
      after.push(() => jobs().paymentAction(id, 'capture'));
      break;
    }
    default:
      break;
  }
}

const NOTIFY: Partial<Record<string, { to: 'customer' | 'shop'; title: string; body: string }[]>> = {
  CONFIRMED: [
    { to: 'customer', title: 'Order confirmed', body: 'We are finding a driver for your delivery.' },
    { to: 'shop', title: 'New order', body: 'A new rental order is waiting.' },
  ],
  OUT_FOR_DELIVERY: [{ to: 'customer', title: 'On the way', body: 'Your rental is out for delivery.' }],
  DELIVERED: [{ to: 'customer', title: 'Delivered', body: 'Your rental has arrived. Enjoy!' }],
  OVERDUE: [{ to: 'customer', title: 'Rental overdue', body: 'Please schedule a return to avoid late fees.' }],
  PICKED_UP: [{ to: 'shop', title: 'Return picked up', body: 'A returned item is on its way back.' }],
  SETTLED: [{ to: 'customer', title: 'Order settled', body: 'Your payment has been finalized.' }],
  CANCELLED: [{ to: 'customer', title: 'Order cancelled', body: 'Your order was cancelled.' }],
};

async function publishOrderUpdate(order: OrderDoc, event: string): Promise<void> {
  const id = String(order._id);
  const data = { orderId: id, status: order.status, version: order.version, event };
  const rt = services().realtime;
  rt.publish(`order:${id}`, 'order.updated', data);
  rt.publish(`user:${order.customerId}`, 'order.updated', data);
  rt.publish(`user:${order.shopId}`, 'order.updated', data);

  for (const n of NOTIFY[order.status] ?? []) {
    const userId = String(n.to === 'customer' ? order.customerId : order.shopId);
    await services().notifier.notifyUser(userId, { title: n.title, body: n.body, data: { orderId: id } }).catch(() => undefined);
  }
  await services().notifier.updateLiveActivity(id, { status: order.status, version: order.version }).catch(() => undefined);
}

/** Swallow expected races from background jobs (the order already moved on). */
export async function transitionFromJob(input: TransitionInput): Promise<void> {
  try {
    await transition(input);
  } catch (e) {
    if (e instanceof AppError && ['illegal_transition', 'conflict', 'reservation_expired'].includes(e.code)) {
      logger.debug({ code: e.code, event: input.event, orderId: input.orderId }, 'job transition skipped');
      return;
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getOrderForUser(orderId: string, userId: string) {
  if (!Types.ObjectId.isValid(orderId)) throw new AppError(404, 'not_found', 'Order not found');
  const order = await Order.findById(orderId);
  if (!order) throw new AppError(404, 'not_found', 'Order not found');
  const me = userId;
  const participant = [order.customerId, order.shopId, order.deliveryDriverId, order.returnDriverId].some((x) => x && String(x) === me);
  if (!participant) throw new AppError(404, 'not_found', 'Order not found'); // 404, not 403: don't leak existence
  return order;
}

export async function canViewOrderRoom(userId: string, _role: string, room: string): Promise<boolean> {
  if (!room.startsWith('order:')) return false;
  try {
    await getOrderForUser(room.slice('order:'.length), userId);
    return true;
  } catch {
    return false;
  }
}

