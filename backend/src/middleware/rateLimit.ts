import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

/**
 * In-memory store: fine for one instance. For horizontal scale, swap in a Redis store
 * (a good ADR: per-instance limits vs shared limits).
 */
export const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
});
