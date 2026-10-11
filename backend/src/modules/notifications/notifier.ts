import { logger } from '../../config/logger';
import type { LiveActivityState, Notifier, PushMessage } from '../../services/types';
import { ApnsClient } from './apns';
import { DeviceToken, LiveActivityToken } from './notification.models';

const TERMINAL = new Set(['SETTLED', 'CANCELLED', 'PAYMENT_FAILED']);

/** Logs instead of sending. Default when APNs is not configured (local dev, CI). */
export class LogNotifier implements Notifier {
  async notifyUser(userId: string, msg: PushMessage) {
    logger.info({ userId, msg }, 'push (log only)');
  }
  async updateLiveActivity(orderId: string, state: LiveActivityState) {
    logger.info({ orderId, state }, 'live activity update (log only)');
  }
}

export class ApnsNotifier implements Notifier {
  constructor(private apns: ApnsClient) {}

  async notifyUser(userId: string, msg: PushMessage) {
    const tokens = await DeviceToken.find({ userId });
    await Promise.all(
      tokens.map(async (t) => {
        const res = await this.apns.send({
          deviceToken: t.token,
          bundleId: t.bundleId ?? undefined,
          pushType: 'alert',
          payload: { aps: { alert: { title: msg.title, body: msg.body }, sound: 'default' }, ...msg.data },
        });
        // 410 = token no longer valid (app uninstalled). Prune it.
        if (res.status === 410 || res.reason === 'BadDeviceToken') await DeviceToken.deleteOne({ _id: t._id });
        else if (res.status >= 400) logger.warn({ res }, 'apns alert rejected');
      }),
    );
  }

  async updateLiveActivity(orderId: string, state: LiveActivityState) {
    const tokens = await LiveActivityToken.find({ orderId });
    const ending = TERMINAL.has(state.status);
    await Promise.all(
      tokens.map(async (t) => {
        const res = await this.apns.send({
          deviceToken: t.pushToken,
          pushType: 'liveactivity',
          payload: {
            aps: {
              timestamp: Math.floor(Date.now() / 1000),
              event: ending ? 'end' : 'update',
              'content-state': { status: state.status, etaMinutes: state.etaMinutes ?? null, version: state.version },
              ...(ending ? { 'dismissal-date': Math.floor(Date.now() / 1000) + 3600 } : {}),
            },
          },
        });
        if (res.status === 410) await LiveActivityToken.deleteOne({ _id: t._id });
        else if (res.status >= 400) logger.warn({ res }, 'apns live activity rejected');
      }),
    );
  }
}
