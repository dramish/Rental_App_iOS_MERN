import type { IncomingMessage, Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { verifyAccessToken } from '../middleware/auth';
import { logger } from '../config/logger';
import type { RealtimePublisher } from '../services/types';
import type { Bus, BusMessage } from './bus';

/**
 * Wire protocol (JSON text frames).
 *   client -> server: { type:'subscribe', room, id }   | { type:'unsubscribe', room }
 *   server -> client: { type:'hello' } | { type:'ack', id, ok } | { type:'event', room, event, data }
 * Events carry a `version` (orders) or `seq` (locations) so clients can detect gaps and resync over REST.
 * The socket is a HINT. The REST API is the source of truth.
 */
export type CanSubscribe = (userId: string, role: string, room: string) => Promise<boolean>;

interface Client {
  ws: WebSocket;
  userId: string;
  role: string;
  rooms: Set<string>;
  alive: boolean;
}

export class RealtimeHub implements RealtimePublisher {
  private clients = new Set<Client>();
  private wss = new WebSocketServer({ noServer: true });
  private heartbeat?: NodeJS.Timeout;

  constructor(
    private bus: Bus,
    private canSubscribe: CanSubscribe,
    private heartbeatMs = 30_000,
  ) {
    this.bus.subscribe((m) => this.deliver(m));
  }

  publish(room: string, event: string, data: unknown): void {
    this.bus.publish({ room, event, data });
  }

  attach(server: HttpServer, path = '/ws'): void {
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== path) return; // not ours
      try {
        const auth = this.authenticate(req, url);
        this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, auth));
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
      }
    });
    this.heartbeat = setInterval(() => this.sweep(), this.heartbeatMs);
    this.heartbeat.unref();
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.clients.forEach((c) => c.ws.terminate());
    this.wss.close();
    await this.bus.close();
  }

  private authenticate(req: IncomingMessage, url: URL) {
    const header = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token');
    if (!token) throw new Error('missing token');
    return verifyAccessToken(token);
  }

  private onConnection(ws: WebSocket, auth: { userId: string; role: string }): void {
    const client: Client = { ws, userId: auth.userId, role: auth.role, rooms: new Set([`user:${auth.userId}`]), alive: true };
    this.clients.add(client);
    ws.on('pong', () => (client.alive = true));
    ws.on('close', () => this.clients.delete(client));
    ws.on('error', (err) => logger.debug({ err }, 'ws error'));
    ws.on('message', (raw) => void this.onMessage(client, raw.toString()));
    ws.send(JSON.stringify({ type: 'hello' }));
  }

  private async onMessage(client: Client, raw: string): Promise<void> {
    let msg: { type?: string; room?: string; id?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg.room !== 'string') return;
    if (msg.type === 'subscribe') {
      let ok = false;
      // Users may only join their own user room implicitly; everything else is authorized.
      if (!msg.room.startsWith('user:')) {
        ok = await this.canSubscribe(client.userId, client.role, msg.room).catch(() => false);
      }
      if (ok) client.rooms.add(msg.room);
      client.ws.send(JSON.stringify({ type: 'ack', id: msg.id, ok }));
    } else if (msg.type === 'unsubscribe' && !msg.room.startsWith('user:')) {
      client.rooms.delete(msg.room);
    }
  }

  private deliver(m: BusMessage): void {
    const frame = JSON.stringify({ type: 'event', room: m.room, event: m.event, data: m.data });
    for (const c of this.clients) {
      if (c.rooms.has(m.room) && c.ws.readyState === WebSocket.OPEN) c.ws.send(frame);
    }
  }

  /** Drop connections that missed a heartbeat (half-open TCP, phone went into a tunnel). */
  private sweep(): void {
    for (const c of this.clients) {
      if (!c.alive) {
        c.ws.terminate();
        this.clients.delete(c);
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }
}
