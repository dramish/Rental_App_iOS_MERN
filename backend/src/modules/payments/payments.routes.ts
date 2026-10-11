import type { RequestHandler } from 'express';
import { Router } from 'express';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { requireAuth } from '../../middleware/auth';
import { AppError } from '../../utils/errors';
import { services } from '../../services';
import { Order } from '../orders/order.model';
import { FakePaymentProvider } from './fakeProvider';
import { handleProviderEvent } from './payments.service';

/** Mounted in app.ts with express.raw() BEFORE express.json(): signature verification needs the exact bytes. */
export const webhookHandler: RequestHandler = async (req, res, next) => {
  try {
    let event;
    try {
      event = services().payments.parseWebhook(req.body as Buffer, req.header('stripe-signature'));
    } catch (err) {
      logger.warn({ err }, 'webhook signature/parse failure');
      throw new AppError(400, 'invalid_webhook', 'Invalid webhook');
    }
    if (!event) {
      res.status(200).json({ ignored: true });
      return;
    }
    res.status(200).json({ result: await handleProviderEvent(event) });
  } catch (e) {
    next(e);
  }
};

/** Dev only: pretend the customer completed payment (fake provider). */
export const devPaymentsRouter = Router();
if (env.NODE_ENV !== 'production') {
  devPaymentsRouter.post('/:orderId/authorize', requireAuth, async (req, res, next) => {
    try {
      const provider = services().payments;
      if (!(provider instanceof FakePaymentProvider)) throw new AppError(404, 'not_found', 'Not available');
      const order = await Order.findById(req.params['orderId']);
      if (!order || String(order.customerId) !== req.auth!.userId) throw new AppError(404, 'not_found', 'Order not found');
      if (!order.payment?.intentId) throw new AppError(409, 'no_intent', 'No payment intent yet');
      res.json({ result: await handleProviderEvent(provider.authorize(order.payment.intentId)) });
    } catch (e) {
      next(e);
    }
  });
}
