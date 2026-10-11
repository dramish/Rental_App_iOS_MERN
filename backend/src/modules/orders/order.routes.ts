import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { requireAuth, requireRole } from '../../middleware/auth';
import { idempotency } from '../../middleware/idempotency';
import { validateBody } from '../../middleware/validate';
import { AppError } from '../../utils/errors';
import { decodeCursor, encodeCursor } from '../../utils/pagination';
import { liveActivityRouter } from '../notifications/notification.routes';
import { getTracking } from '../tracking/location.service';
import { Order, OrderEvent } from './order.model';
import { getOrderForUser, placeOrder, placeOrderSchema, transition } from './order.service';

export const orderRouter = Router();
orderRouter.use(requireAuth);

orderRouter.post('/', requireRole('customer'), validateBody(placeOrderSchema), idempotency, async (req, res, next) => {
  try {
    const key = req.header('idempotency-key')!;
    const { order, clientSecret } = await placeOrder(req.auth!.userId, req.body, key);
    res.status(201).json({ order, clientSecret });
  } catch (e) {
    next(e);
  }
});

const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), cursor: z.string().max(100).optional() });

orderRouter.get('/', async (req, res, next) => {
  try {
    const { limit, cursor } = listSchema.parse(req.query);
    const me = new Types.ObjectId(req.auth!.userId);
    const role = req.auth!.role;
    const mine =
      role === 'customer' ? { customerId: me } : role === 'shop' ? { shopId: me } : { $or: [{ deliveryDriverId: me }, { returnDriverId: me }] };
    const after = decodeCursor(cursor);
    const rows = await Order.find({ ...mine, ...(after ? { _id: { $lt: after } } : {}) })
      .sort({ _id: -1 })
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    res.json({ items, nextCursor: hasMore && last ? encodeCursor(last._id) : null });
  } catch (e) {
    next(e);
  }
});

orderRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await getOrderForUser(req.params['id'] ?? '', req.auth!.userId));
  } catch (e) {
    next(e);
  }
});

orderRouter.get('/:id/events', async (req, res, next) => {
  try {
    const order = await getOrderForUser(req.params['id'] ?? '', req.auth!.userId);
    res.json({ items: await OrderEvent.find({ orderId: order._id }).sort({ version: 1 }) });
  } catch (e) {
    next(e);
  }
});

/** Resync endpoint for the live tracking screen: order status/version + the driver's latest position. */
orderRouter.get('/:id/tracking', async (req, res, next) => {
  try {
    res.json(await getTracking(req.params['id'] ?? '', req.auth!.userId));
  } catch (e) {
    next(e);
  }
});

const eventSchema = z.object({
  event: z.string().min(1).max(50),
  payload: z.record(z.string(), z.unknown()).optional(),
});

/** Every user-driven state change goes through here. */
orderRouter.post('/:id/events', validateBody(eventSchema), idempotency, async (req, res, next) => {
  try {
    const role = req.auth!.role;
    if (role === 'admin') throw new AppError(403, 'forbidden', 'Not allowed');
    const { order, replayed } = await transition({
      orderId: req.params['id'] ?? '',
      event: req.body.event,
      actor: { id: req.auth!.userId, role },
      idempotencyKey: req.header('idempotency-key')!,
      payload: req.body.payload,
    });
    res.status(replayed ? 200 : 201).json(order);
  } catch (e) {
    next(e);
  }
});

orderRouter.use('/:id/live-activity', liveActivityRouter);
