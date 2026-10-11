import { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import type { Jobs } from '../services/types';

export const QUEUE_NAME = 'lend-jobs';

/**
 * BullMQ-backed delayed jobs. Deterministic jobIds make scheduling idempotent
 * (adding the same job twice is a no-op), and let us cancel a pending job by id.
 * Note: BullMQ custom ids cannot contain ':'.
 */
export class BullJobs implements Jobs {
  readonly queue: Queue;
  constructor(connection: IORedis) {
    this.queue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 },
    });
  }

  private async add(name: string, data: Record<string, unknown>, jobId: string, delay = 0) {
    await this.queue.add(name, data, { jobId, delay });
  }

  scheduleHoldExpiry = (orderId: string, delayMs: number) => this.add('hold-expiry', { orderId }, `hold-${orderId}`, delayMs);
  cancelHoldExpiry = async (orderId: string) => {
    await this.queue.remove(`hold-${orderId}`).catch(() => undefined);
  };
  scheduleRentalStart = (orderId: string, delayMs: number) => this.add('rental-start', { orderId }, `start-${orderId}`, delayMs);
  scheduleOverdue = (orderId: string, delayMs: number) => this.add('overdue', { orderId }, `overdue-${orderId}`, delayMs);
  /** Each dispatch attempt gets its own id so a re-dispatch isn't swallowed by a completed job with the same id. */
  dispatchTask = (taskId: string, delayMs = 0) => this.add('dispatch', { taskId }, `dispatch-${taskId}-${Date.now()}`, delayMs);
  scheduleOfferTimeout = (taskId: string, driverUserId: string, delayMs: number) =>
    this.add('offer-timeout', { taskId, driverUserId }, `offer-${taskId}-${driverUserId}-${Date.now()}`, delayMs);
  paymentAction = (orderId: string, action: 'capture' | 'cancel') => this.add('payment-action', { orderId, action }, `pay-${action}-${orderId}`);
}
