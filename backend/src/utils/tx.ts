import mongoose, { type ClientSession } from 'mongoose';

/**
 * Run fn inside a transaction, or join the caller's session.
 * mongoose's connection.transaction() retries the callback on TransientTransactionError
 * (e.g. write conflicts), so callbacks must be safe to re-run: no side effects inside.
 */
export async function withSession<T>(session: ClientSession | undefined, fn: (s: ClientSession) => Promise<T>): Promise<T> {
  if (session) return fn(session);
  return mongoose.connection.transaction(fn);
}

export const isDuplicateKey = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;
