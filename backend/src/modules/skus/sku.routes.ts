import { Router } from 'express';
import { z } from 'zod';
import { Types, type QueryFilter } from 'mongoose';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { AppError } from '../../utils/errors';
import { decodeCursor, encodeCursor } from '../../utils/pagination';
import { Sku, type SkuDoc } from './sku.model';

export const skuRouter = Router();

const createSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(2000).default(''),
  category: z.string().min(1).max(40),
  images: z.array(z.string().url()).max(8).default([]),
  totalQty: z.number().int().min(1).max(10_000),
  bufferDays: z.number().int().min(0).max(14).default(0),
  dailyPriceMinor: z.number().int().min(0),
  depositMinor: z.number().int().min(0),
  currency: z.string().length(3).default('INR'),
});

const listQuerySchema = z.object({
  q: z.string().max(80).optional(),
  category: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(100).optional(),
});

skuRouter.post('/', requireAuth, requireRole('shop'), validateBody(createSchema), async (req, res, next) => {
  try {
    const sku = await Sku.create({ ...req.body, shopId: req.auth!.userId });
    res.status(201).json(sku);
  } catch (e) {
    next(e);
  }
});

// Cursor pagination on _id (newest first). Stable under inserts, unlike offset/skip.
skuRouter.get('/', async (req, res, next) => {
  try {
    const { q, category, limit, cursor } = listQuerySchema.parse(req.query);
    const filter: QueryFilter<SkuDoc> = { active: true };
    if (category) filter.category = category;
    if (q) filter.$text = { $search: q };
    const after = decodeCursor(cursor);
    if (after) filter._id = { $lt: after };

    const rows = await Sku.find(filter)
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

skuRouter.get('/:id', async (req, res, next) => {
  try {
    const id = req.params['id'] ?? '';
    if (!Types.ObjectId.isValid(id)) throw new AppError(400, 'invalid_id', 'Invalid id');
    const sku = await Sku.findById(id);
    if (!sku) throw new AppError(404, 'not_found', 'SKU not found');
    res.json(sku);
  } catch (e) {
    next(e);
  }
});
