import type IORedis from 'ioredis';

export interface BusMessage {
  room: string;
  event: string;
  data: unknown;
}

/** Cross-instance fan-out. Every API instance subscribes and delivers to its own local sockets. */
export interface Bus {
  publish(msg: BusMessage): void;
  subscribe(handler: (msg: BusMessage) => void): void;
  close(): Promise<void>;
}

export class InMemoryBus implements Bus {
  private handlers: ((m: BusMessage) => void)[] = [];
  publish(msg: BusMessage): void {
    // Round-trip through JSON so tests see what the wire would carry.
    const copy = JSON.parse(JSON.stringify(msg)) as BusMessage;
    queueMicrotask(() => this.handlers.forEach((h) => h(copy)));
  }
  subscribe(handler: (msg: BusMessage) => void): void {
    this.handlers.push(handler);
  }
  async close(): Promise<void> {
    this.handlers = [];
  }
}

export class RedisBus implements Bus {
  constructor(
    private pub: IORedis,
    private sub: IORedis,
    private channel = 'lend:rt',
  ) {}
  publish(msg: BusMessage): void {
    void this.pub.publish(this.channel, JSON.stringify(msg));
  }
  subscribe(handler: (msg: BusMessage) => void): void {
    void this.sub.subscribe(this.channel);
    this.sub.on('message', (_ch, raw) => {
      try {
        handler(JSON.parse(raw) as BusMessage);
      } catch {
        /* ignore malformed */
      }
    });
  }
  async close(): Promise<void> {
    await this.sub.quit();
    await this.pub.quit();
  }
}
