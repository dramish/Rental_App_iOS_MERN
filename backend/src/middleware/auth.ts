import jwt from 'jsonwebtoken';
import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { AppError } from '../utils/errors';
import type { Role } from '../types/express';
import '../types/express';

export function signAccessToken(userId: string, role: Role): string {
  return jwt.sign({ role }, env.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string): { userId: string; role: Role } {
  try {
    const p = jwt.verify(token, env.JWT_ACCESS_SECRET);
    if (typeof p === 'string' || !p.sub) throw new Error('bad payload');
    return { userId: p.sub, role: p['role'] as Role };
  } catch {
    throw new AppError(401, 'invalid_token', 'Invalid or expired access token');
  }
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) return next(new AppError(401, 'missing_token', 'Missing bearer token'));
  try {
    req.auth = verifyAccessToken(header.slice(7));
    next();
  } catch (e) {
    next(e);
  }
};

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return next(new AppError(403, 'forbidden', 'Insufficient role'));
    }
    next();
  };
