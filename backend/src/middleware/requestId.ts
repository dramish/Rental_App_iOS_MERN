import { randomUUID } from 'crypto';
import type { RequestHandler } from 'express';
import '../types/express';

export const requestId: RequestHandler = (req, res, next) => {
  req.requestId = req.header('x-request-id') ?? randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
};
