import { Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import { logger } from '../config/logger';
import { release } from '../modules/availability/availability.service';

export const QUEUES = {
  holdExpiry: 'reservation-hold-expiry',
  overdue: 'order-overdue',
} as const;

export function createQueues(connection: IORedis) {
  return {
    holdExpiry: new Queue<{ orderId: string }>(QUEUES.holdExpiry, { connection }),
    overdue: new Queue<{ orderId: string }>(QUEUES.overdue, { connection }),
  };
}

/**
 * Enqueue with a deterministic jobId (e.g. `hold:${orderId}`) so scheduling twice is a no-op,
 * and remove/reschedule it when the order is paid or cancelled.
 */
export function startWorkers(connection: IORedis) {
  const holdExpiry = new Worker<{ orderId: string }>(
    QUEUES.holdExpiry,
    async (job) => {
      await release(job.data.orderId); // must be a no-op if already confirmed/released
    },
    { connection },
  );
  holdExpiry.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'hold expiry failed'));
  return [holdExpiry];
}
