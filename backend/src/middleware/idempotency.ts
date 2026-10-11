import { createHash } from 'crypto';
import type { RequestHandler } from 'express';
import { Schema, model } from 'mongoose';
import { AppError } from '../utils/errors';
import { isDuplicateKey } from '../utils/tx';
import '../types/express';

const recordSchema = new Schema({
  userId: { type: String, required: true },
  key: { type: String, required: true },
  requestHash: { type: String, required: true },
  state: { type: String, enum: ['in_progress', 'done'], required: true },
  responseStatus: { type: Number },
  responseBody: { type: Schema.Types.Mixed },
  startedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});
recordSchema.index({ userId: 1, key: 1 }, { unique: true });
recordSchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 3600 }); // keys live 24h

export const IdempotencyRecord = model('IdempotencyRecord', recordSchema);

const STALE_IN_PROGRESS_MS = 60_000;

/**
 * Idempotency-Key semantics (Stripe-style):
 *  - same key + same request  -> replay the stored response, never re-execute
 *  - same key + different body -> 422
 *  - same key while the first request is still running -> 409 (client retries later)
 *  - 5xx responses are not stored, so a retry may execute again
 * Records are scoped per user. A crashed in-flight request is taken over after 60s.
 */
export const idempotency: RequestHandler = async (req, res, next) => {
  try {
    const key = req.header('idempotency-key');
    if (!key || key.length > 100) throw new AppError(400, 'idempotency_key_required', 'Idempotency-Key header is required (max 100 chars)');
    const userId = req.auth!.userId;
    const requestHash = createHash('sha256').update(`${req.method} ${req.baseUrl}${req.path}\n${JSON.stringify(req.body ?? {})}`).digest('hex');

    let owned = false;
    try {
      await IdempotencyRecord.create({ userId, key, requestHash, state: 'in_progress' });
      owned = true;
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
    }

    if (!owned) {
      const rec = await IdempotencyRecord.findOne({ userId, key });
      if (!rec) return next(new AppError(409, 'request_in_progress', 'Retry shortly')); // expired between create and read
      if (rec.requestHash !== requestHash) throw new AppError(422, 'idempotency_key_reuse', 'Key was used with a different request');
      if (rec.state === 'done') {
        res.setHeader('Idempotent-Replayed', 'true');
        res.status(rec.responseStatus ?? 200).json(rec.responseBody);
        return;
      }
      const taken = await IdempotencyRecord.findOneAndUpdate(
        { _id: rec._id, state: 'in_progress', startedAt: { $lt: new Date(Date.now() - STALE_IN_PROGRESS_MS) } },
        { $set: { startedAt: new Date() } },
      );
      if (!taken) throw new AppError(409, 'request_in_progress', 'A request with this key is still being processed');
    }

    const send = res.json.bind(res);
    res.json = (body?: unknown) => {
      const status = res.statusCode;
      // Store plain JSON (mongoose documents inside the body would not round-trip through Mixed).
      const plain = body === undefined ? null : (JSON.parse(JSON.stringify(body)) as unknown);
      const persist =
        status >= 500
          ? IdempotencyRecord.deleteOne({ userId, key })
          : IdempotencyRecord.updateOne({ userId, key }, { $set: { state: 'done', responseStatus: status, responseBody: plain } });
      void persist.catch(() => undefined).finally(() => send(body));
      return res;
    };
    next();
  } catch (e) {
    next(e);
  }
};
