import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { AppError } from '../../utils/errors';
import { point } from '../../utils/geo';
import { Shop } from './shop.model';

export const shopRouter = Router();

const upsertSchema = z.object({
  name: z.string().min(1).max(80),
  addressLine: z.string().min(1).max(200),
  city: z.string().min(1).max(60),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

shopRouter.put('/me', requireAuth, requireRole('shop'), validateBody(upsertSchema), async (req, res, next) => {
  try {
    const { lat, lng, ...rest } = req.body;
    const shop = await Shop.findOneAndUpdate(
      { userId: req.auth!.userId },
      { $set: { ...rest, location: point(lat, lng) } },
      { upsert: true, new: true },
    );
    res.json(shop);
  } catch (e) {
    next(e);
  }
});

shopRouter.get('/me', requireAuth, requireRole('shop'), async (req, res, next) => {
  try {
    const shop = await Shop.findOne({ userId: req.auth!.userId });
    if (!shop) throw new AppError(404, 'not_found', 'Shop profile not set up');
    res.json(shop);
  } catch (e) {
    next(e);
  }
});
