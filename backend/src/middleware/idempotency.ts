import type { RequestHandler } from 'express';
import { notImplemented } from '../utils/errors';

/**
 * TBI. Contract:
 *  - Reads the `Idempotency-Key` header (required on mutating order/payment routes).
 *  - Same key + same request body hash  -> replay the stored response, never re-execute.
 *  - Same key + different body          -> 422 (key reuse with a different payload).
 *  - Same key while first is in flight  -> 409 (or wait), never run twice concurrently.
 *  - Keys are scoped per user and expire (e.g. 24h, TTL index).
 * Decide: where the key record lives (Mongo unique index vs Redis SET NX) and say why in an ADR.
 */
export const idempotency: RequestHandler = (_req, _res, next) => next(notImplemented('idempotency middleware'));
