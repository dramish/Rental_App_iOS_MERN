import http from 'http';
import { AddressInfo } from 'net';
import WebSocket from 'ws';
import { InMemoryBus } from '../src/realtime/bus';
import { RealtimeHub } from '../src/realtime/hub';
import { signAccessToken } from '../src/middleware/auth';

function open(port: number, token?: string): Promise<{ ws: WebSocket; msgs: any[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const msgs: any[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    ws.on('open', () => resolve({ ws, msgs }));
    ws.on('unexpected-response', () => reject(new Error('unauthorized')));
    ws.on('error', reject);
  });
}
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe('RealtimeHub', () => {
  let server: http.Server;
  let hub: RealtimeHub;
  let port: number;

  beforeAll(async () => {
    server = http.createServer();
    hub = new RealtimeHub(new InMemoryBus(), async (userId, _role, room) => userId === 'alice' && room === 'order:1');
    hub.attach(server);
    await new Promise<void>((r) => server.listen(0, r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await hub.close();
    server.close();
  });

  it('rejects unauthenticated upgrades', async () => {
    await expect(open(port)).rejects.toThrow();
  });

  it('delivers events only to authorized subscribers', async () => {
    const alice = await open(port, signAccessToken('alice', 'customer'));
    const bob = await open(port, signAccessToken('bob', 'customer'));

    alice.ws.send(JSON.stringify({ type: 'subscribe', room: 'order:1', id: 'a1' }));
    bob.ws.send(JSON.stringify({ type: 'subscribe', room: 'order:1', id: 'b1' }));
    await tick();
    expect(alice.msgs.find((m) => m.type === 'ack')).toMatchObject({ id: 'a1', ok: true });
    expect(bob.msgs.find((m) => m.type === 'ack')).toMatchObject({ id: 'b1', ok: false });

    hub.publish('order:1', 'order.updated', { status: 'CONFIRMED', version: 2 });
    hub.publish('user:bob', 'task.offer', { taskId: 't1' });
    await tick();

    expect(alice.msgs.filter((m) => m.type === 'event')).toEqual([
      { type: 'event', room: 'order:1', event: 'order.updated', data: { status: 'CONFIRMED', version: 2 } },
    ]);
    // bob never joined order:1, but receives his own user room events
    expect(bob.msgs.filter((m) => m.type === 'event').map((m) => m.event)).toEqual(['task.offer']);
    alice.ws.close();
    bob.ws.close();
  });

  it('does not let a client join another user\'s private room', async () => {
    const bob = await open(port, signAccessToken('bob', 'customer'));
    bob.ws.send(JSON.stringify({ type: 'subscribe', room: 'user:alice', id: 'x' }));
    await tick();
    expect(bob.msgs.find((m) => m.type === 'ack')).toMatchObject({ ok: false });
    hub.publish('user:alice', 'secret', {});
    await tick();
    expect(bob.msgs.filter((m) => m.type === 'event')).toHaveLength(0);
    bob.ws.close();
  });
});
