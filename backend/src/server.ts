import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { connectMongo, disconnectMongo } from './config/db';
import { createRedis } from './config/redis';
import { BullJobs } from './jobs/jobs';
import { startWorker } from './jobs/worker';
import { ApnsClient } from './modules/notifications/apns';
import { ApnsNotifier, LogNotifier } from './modules/notifications/notifier';
import { FakePaymentProvider } from './modules/payments/fakeProvider';
import { StripePaymentProvider } from './modules/payments/stripeProvider';
import { canViewOrderRoom } from './modules/orders/order.service';
import { RedisBus } from './realtime/bus';
import { RealtimeHub } from './realtime/hub';
import { setServices } from './services';
import type { CachedLocation, LocationCache, Notifier } from './services/types';
import type { PaymentProvider } from './modules/payments/provider';
import type IORedis from 'ioredis';

class RedisLocationCache implements LocationCache {
  constructor(private redis: IORedis) {}
  async get(id: string): Promise<CachedLocation | null> {
    const raw = await this.redis.get(`driver-loc:${id}`);
    return raw ? (JSON.parse(raw) as CachedLocation) : null;
  }
  async set(id: string, loc: CachedLocation): Promise<void> {
    await this.redis.set(`driver-loc:${id}`, JSON.stringify(loc), 'EX', 120); // stale after 2 minutes
  }
}

function buildPayments(): PaymentProvider {
  if (env.PAYMENT_PROVIDER === 'stripe') {
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required');
    return new StripePaymentProvider(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);
  }
  return new FakePaymentProvider();
}

function buildNotifier(): { notifier: Notifier; close: () => void } {
  if (env.APNS_KEY_P8 && env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_BUNDLE_ID) {
    const apns = new ApnsClient({ keyP8: env.APNS_KEY_P8, keyId: env.APNS_KEY_ID, teamId: env.APNS_TEAM_ID, bundleId: env.APNS_BUNDLE_ID, production: env.APNS_PRODUCTION });
    return { notifier: new ApnsNotifier(apns), close: () => apns.close() };
  }
  logger.warn('APNs not configured: pushes are logged only');
  return { notifier: new LogNotifier(), close: () => undefined };
}

async function main() {
  await connectMongo();
  const redis = createRedis();

  const hub = new RealtimeHub(new RedisBus(redis.duplicate(), redis.duplicate()), canViewOrderRoom);
  const jobs = new BullJobs(redis);
  const { notifier, close: closeApns } = buildNotifier();
  setServices({ realtime: hub, jobs, payments: buildPayments(), notifier, locationCache: new RedisLocationCache(redis) });

  const app = createApp({ extraReadiness: async () => (await redis.ping()) === 'PONG' });
  const server = http.createServer(app);
  hub.attach(server);
  const worker = startWorker(redis.duplicate());

  server.listen(env.PORT, () => logger.info({ port: env.PORT, payments: env.PAYMENT_PROVIDER }, 'api listening'));

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close();
    await worker.close();
    await hub.close();
    await jobs.queue.close();
    closeApns();
    await redis.quit();
    await disconnectMongo();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal');
  process.exit(1);
});
