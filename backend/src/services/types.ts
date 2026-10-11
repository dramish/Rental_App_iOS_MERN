import type { PaymentProvider } from '../modules/payments/provider';

export interface RealtimePublisher {
  publish(room: string, event: string, data: unknown): void;
}

export interface Jobs {
  scheduleHoldExpiry(orderId: string, delayMs: number): Promise<void>;
  cancelHoldExpiry(orderId: string): Promise<void>;
  scheduleRentalStart(orderId: string, delayMs: number): Promise<void>;
  scheduleOverdue(orderId: string, delayMs: number): Promise<void>;
  dispatchTask(taskId: string, delayMs?: number): Promise<void>;
  scheduleOfferTimeout(taskId: string, driverUserId: string, delayMs: number): Promise<void>;
  paymentAction(orderId: string, action: 'capture' | 'cancel'): Promise<void>;
}

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface LiveActivityState {
  status: string;
  etaMinutes?: number;
  version: number;
}

export interface Notifier {
  notifyUser(userId: string, msg: PushMessage): Promise<void>;
  updateLiveActivity(orderId: string, state: LiveActivityState): Promise<void>;
}

export interface CachedLocation {
  lat: number;
  lng: number;
  accuracy: number;
  speed?: number;
  recordedAt: string;
  seq: number;
}

export interface LocationCache {
  get(driverUserId: string): Promise<CachedLocation | null>;
  set(driverUserId: string, loc: CachedLocation): Promise<void>;
}

export interface Services {
  realtime: RealtimePublisher;
  jobs: Jobs;
  payments: PaymentProvider;
  notifier: Notifier;
  locationCache: LocationCache;
}
