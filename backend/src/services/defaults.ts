import { FakePaymentProvider } from '../modules/payments/fakeProvider';
import type { CachedLocation, Jobs, LiveActivityState, LocationCache, Notifier, PushMessage, RealtimePublisher } from './types';

/** In-memory implementations: used by tests and as the default before server.ts wires real ones. */
export class RecordingRealtime implements RealtimePublisher {
  events: { room: string; event: string; data: unknown }[] = [];
  publish(room: string, event: string, data: unknown): void {
    this.events.push({ room, event, data });
  }
}

export class RecordingJobs implements Jobs {
  scheduled: { name: string; args: unknown[] }[] = [];
  private rec(name: string, ...args: unknown[]) {
    this.scheduled.push({ name, args });
    return Promise.resolve();
  }
  scheduleHoldExpiry = (orderId: string, delayMs: number) => this.rec('holdExpiry', orderId, delayMs);
  cancelHoldExpiry = (orderId: string) => this.rec('cancelHoldExpiry', orderId);
  scheduleRentalStart = (orderId: string, delayMs: number) => this.rec('rentalStart', orderId, delayMs);
  scheduleOverdue = (orderId: string, delayMs: number) => this.rec('overdue', orderId, delayMs);
  dispatchTask = (taskId: string, delayMs?: number) => this.rec('dispatch', taskId, delayMs ?? 0);
  scheduleOfferTimeout = (taskId: string, driverUserId: string, delayMs: number) => this.rec('offerTimeout', taskId, driverUserId, delayMs);
  paymentAction = (orderId: string, action: 'capture' | 'cancel') => this.rec('paymentAction', orderId, action);
  names = () => this.scheduled.map((s) => s.name);
}

export class RecordingNotifier implements Notifier {
  sent: { userId: string; msg: PushMessage }[] = [];
  activity: { orderId: string; state: LiveActivityState }[] = [];
  async notifyUser(userId: string, msg: PushMessage) {
    this.sent.push({ userId, msg });
  }
  async updateLiveActivity(orderId: string, state: LiveActivityState) {
    this.activity.push({ orderId, state });
  }
}

export class InMemoryLocationCache implements LocationCache {
  private m = new Map<string, CachedLocation>();
  async get(id: string) {
    return this.m.get(id) ?? null;
  }
  async set(id: string, loc: CachedLocation) {
    this.m.set(id, loc);
  }
}

export const makeTestServices = () => ({
  realtime: new RecordingRealtime(),
  jobs: new RecordingJobs(),
  payments: new FakePaymentProvider(),
  notifier: new RecordingNotifier(),
  locationCache: new InMemoryLocationCache(),
});
