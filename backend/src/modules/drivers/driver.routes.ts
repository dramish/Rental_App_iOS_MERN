import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { AppError } from '../../utils/errors';
import { point } from '../../utils/geo';
import { acceptTask, declineTask } from './dispatch.service';
import { DeliveryTask, Driver } from './driver.model';

export const driverRouter = Router();
export const taskRouter = Router();

driverRouter.use(requireAuth, requireRole('driver'));
taskRouter.use(requireAuth, requireRole('driver'));

const statusSchema = z.object({
  online: z.boolean(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

driverRouter.put('/me', validateBody(statusSchema), async (req, res, next) => {
  try {
    const { online, lat, lng } = req.body;
    const set: Record<string, unknown> = { online };
    if (lat !== undefined && lng !== undefined) {
      set['location'] = point(lat, lng);
      set['locationUpdatedAt'] = new Date();
    }
    res.json(await Driver.findOneAndUpdate({ userId: req.auth!.userId }, { $set: set }, { upsert: true, new: true }));
  } catch (e) {
    next(e);
  }
});

driverRouter.get('/me', async (req, res, next) => {
  try {
    const d = await Driver.findOne({ userId: req.auth!.userId });
    if (!d) throw new AppError(404, 'not_found', 'Driver profile not set up');
    res.json(d);
  } catch (e) {
    next(e);
  }
});

/** My current work: live offers (unexpired) and assigned tasks. Also the REST resync for the task.offer socket hint. */
driverRouter.get('/tasks', async (req, res, next) => {
  try {
    const me = new Types.ObjectId(req.auth!.userId);
    const tasks = await DeliveryTask.find({
      $or: [{ status: 'OFFERED', offeredTo: me, offerExpiresAt: { $gt: new Date() } }, { status: 'ASSIGNED', driverId: me }],
    }).sort({ _id: -1 });
    res.json({ items: tasks });
  } catch (e) {
    next(e);
  }
});

taskRouter.post('/:id/accept', async (req, res, next) => {
  try {
    res.json(await acceptTask(req.params['id'] ?? '', req.auth!.userId));
  } catch (e) {
    next(e);
  }
});

taskRouter.post('/:id/decline', async (req, res, next) => {
  try {
    await declineTask(req.params['id'] ?? '', req.auth!.userId);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
