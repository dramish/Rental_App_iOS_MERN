import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type IORedis from 'ioredis';
import { verifyAccessToken } from '../middleware/auth';
import { logger } from '../config/logger';
import type { ClientToServerEvents, ServerToClientEvents } from './events';

/**
 * TBI: authorize room membership. Until implemented, nobody can subscribe,
 * so a user can never watch someone else's order.
 * Rule: customer of the order, assigned driver, or owning shop.
 */
export type CanSubscribe = (userId: string, role: string, orderId: string) => Promise<boolean>;
const denyAll: CanSubscribe = async () => false;

export function createGateway(httpServer: HttpServer, redis: IORedis, canSubscribe: CanSubscribe = denyAll) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: '*' },
  });
  io.adapter(createAdapter(redis.duplicate(), redis.duplicate()));

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.['token'];
      if (typeof token !== 'string') throw new Error('missing token');
      socket.data['auth'] = verifyAccessToken(token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, role } = socket.data['auth'] as { userId: string; role: string };
    void socket.join(`user:${userId}`);
    logger.debug({ userId }, 'socket connected');

    socket.on('subscribe.order', async (orderId, ack) => {
      const ok = await canSubscribe(userId, role, orderId);
      if (ok) await socket.join(`order:${orderId}`);
      ack(ok);
    });
    socket.on('unsubscribe.order', (orderId) => void socket.leave(`order:${orderId}`));
  });

  return io;
}
