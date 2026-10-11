import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { getOrderForUser } from '../orders/order.service';
import { DeviceToken, LiveActivityToken } from './notification.models';

export const deviceRouter = Router();
export const liveActivityRouter = Router({ mergeParams: true });

deviceRouter.post('/', requireAuth, validateBody(z.object({ token: z.string().min(32).max(200), bundleId: z.string().max(100).optional() })), async (req, res, next) => {
  try {
    // A device token belongs to whoever logged in last on that device.
    await DeviceToken.findOneAndUpdate({ token: req.body.token }, { $set: { userId: req.auth!.userId, bundleId: req.body.bundleId } }, { upsert: true });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

liveActivityRouter.post('/', requireAuth, validateBody(z.object({ pushToken: z.string().min(32).max(400) })), async (req, res, next) => {
  try {
    const order = await getOrderForUser(req.params['id'] ?? '', req.auth!.userId);
    await LiveActivityToken.findOneAndUpdate(
      { orderId: order._id, userId: req.auth!.userId },
      { $set: { pushToken: req.body.pushToken } },
      { upsert: true },
    );
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
