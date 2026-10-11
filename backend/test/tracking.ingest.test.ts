import { Types } from 'mongoose';
import { DeliveryTask, Driver } from '../src/modules/drivers/driver.model';
import { Order } from '../src/modules/orders/order.model';
import { ingest } from '../src/modules/tracking/location.service';
import { LocationPoint } from '../src/modules/tracking/locationPoint.model';
import { services } from '../src/services';
import { point } from '../src/utils/geo';
import type { RecordingRealtime } from '../src/services/defaults';
import { clearDb, makeOnlineDriver, makeShopWithSku, makeUser, orderBody, startDb, stopDb } from './helpers';
import { placeOrder } from '../src/modules/orders/order.service';

beforeAll(startDb, 120_000);
afterAll(stopDb);
beforeEach(clearDb);

const p = (seq: number, secsAgo: number, lat: number, lng = 77.209) => ({ lat, lng, accuracy: 10, recordedAt: new Date(Date.now() - secsAgo * 1000).toISOString(), seq });

describe('location ingest', () => {
  it('thins a replayed batch, stores history, and fans out only the latest point', async () => {
    const { sku } = await makeShopWithSku({ totalQty: 2 });
    const customer = await makeUser('customer');
    const driver = await makeOnlineDriver();
    const { order } = await placeOrder(customer.id, orderBody(String(sku._id)), 'k');
    await Order.updateOne({ _id: order._id }, { $set: { status: 'OUT_FOR_DELIVERY' } });
    await DeliveryTask.create({ orderId: order._id, leg: 'DELIVERY', status: 'ASSIGNED', driverId: driver.id, pickup: point(28.6, 77.2), dropoff: point(28.63, 77.22) });

    const res = await ingest(driver.id, [p(3, 6, 28.6139), p(1, 12, 28.6139), p(2, 9, 28.6143), p(4, 3, 28.615), p(4, 2.9, 28.615)]);
    expect(res.accepted).toBeGreaterThan(0);

    const rt = services().realtime as RecordingRealtime;
    const live = rt.events.filter((e) => e.event === 'driver.location');
    expect(live).toHaveLength(1); // one fan-out per batch, the freshest point
    expect((live[0]!.data as { seq: number }).seq).toBe(4);
    expect(live[0]!.room).toBe(`order:${order._id}`);

    expect(await LocationPoint.countDocuments({ driverId: driver.id })).toBe(res.accepted);
    expect((await services().locationCache.get(driver.id))!.seq).toBe(4);

    const again = await ingest(driver.id, [p(2, 9, 28.6143)]); // replay of an old seq
    expect(again.accepted).toBe(0);
    expect(again.dropped[0]!.reason).toBe('stale');
  });

  it('keeps the coarse dispatch location fresh without writing it on every point', async () => {
    const driver = await makeOnlineDriver(28.0, 77.0);
    await Driver.updateOne({ userId: driver.id }, { $set: { locationUpdatedAt: new Date(Date.now() - 60_000) } });
    await ingest(driver.id, [p(1, 1, 28.7, 77.3)]);
    const d = (await Driver.findOne({ userId: new Types.ObjectId(driver.id) }))!;
    expect(d.location!.coordinates[1]).toBeCloseTo(28.7);
  });
});
