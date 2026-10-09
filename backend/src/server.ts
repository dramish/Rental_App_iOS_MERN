import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { connectMongo, disconnectMongo } from './config/db';
import { createRedis } from './config/redis';
import { createGateway } from './realtime/gateway';
import { startWorkers } from './jobs/queues';

async function main() {
  await connectMongo();
  const redis = createRedis();

  const app = createApp({ extraReadiness: async () => (await redis.ping()) === 'PONG' });
  const server = http.createServer(app);
  createGateway(server, redis);
  const workers = startWorkers(redis);

  server.listen(env.PORT, () => logger.info({ port: env.PORT }, 'api listening'));

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close();
    await Promise.all(workers.map((w) => w.close()));
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
