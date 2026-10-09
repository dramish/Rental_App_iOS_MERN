import IORedis from 'ioredis';
import { env } from './env';

/** maxRetriesPerRequest must be null for BullMQ blocking connections. */
export function createRedis(): IORedis {
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
