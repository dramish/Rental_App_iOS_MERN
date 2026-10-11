import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { batchSchema, ingest } from './location.service';

export const trackingRouter = Router();

/** Drivers POST batches (live, or a replay after reconnect). Response says which points were dropped and why. */
trackingRouter.post('/location', requireAuth, requireRole('driver'), validateBody(batchSchema), async (req, res, next) => {
  try {
    res.json(await ingest(req.auth!.userId, req.body.points));
  } catch (e) {
    next(e);
  }
});
