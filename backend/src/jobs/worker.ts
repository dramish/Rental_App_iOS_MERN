import { Worker } from 'bullmq';
import type IORedis from 'ioredis';
import { logger } from '../config/logger';
import { processJob, } from './handlers';
import { QUEUE_NAME } from './jobs';

export function startWorker(connection: IORedis): Worker {
  const worker = new Worker(QUEUE_NAME, (job) => processJob(job.name, job.data), { connection, concurrency: 10 });
  worker.on('failed', (job, err) => logger.error({ job: job?.name, id: job?.id, err }, 'job failed'));
  return worker;
}
