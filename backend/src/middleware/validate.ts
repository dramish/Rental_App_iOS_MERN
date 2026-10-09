import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';

/** Parses req.body with the schema (ZodError -> 400). Unknown keys are stripped. */
export const validateBody =
  (schema: ZodTypeAny): RequestHandler =>
  (req, _res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (e) {
      next(e);
    }
  };
