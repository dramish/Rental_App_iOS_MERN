import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { addDays, formatDay, todayUTC } from '../src/utils/dates';
import { point } from '../src/utils/geo';
import { signAccessToken } from '../src/middleware/auth';
import type { Role } from '../src/types/express';
import { User } from '../src/modules/auth/user.model';
import { Sku } from '../src/modules/skus/sku.model';
import { Shop } from '../src/modules/shops/shop.model';
import { Driver } from '../src/modules/drivers/driver.model';
import { setServices } from '../src/services';
import { makeTestServices } from '../src/services/defaults';
// Import every model so indexes (esp. unique ones) exist before tests run.
import '../src/modules/availability/availability.model';
import '../src/modules/orders/order.model';
import '../src/modules/payments/webhookEvent.model';
import '../src/modules/tracking/locationPoint.model';
import '../src/modules/notifications/notification.models';
import '../src/middleware/idempotency';
import '../src/modules/auth/refreshToken.model';

let replSet: MongoMemoryReplSet | undefined;

export async function startDb(): Promise<void> {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  // Build indexes, and create collections up front so transactions never race collection creation.
  for (const m of Object.values(mongoose.models)) {
    await m.createCollection().catch(() => undefined);
    await m.init();
  }
}

export async function stopDb(): Promise<void> {
  await mongoose.disconnect();
  await replSet?.stop();
}

export async function clearDb(): Promise<ReturnType<typeof makeTestServices>> {
  for (const m of Object.values(mongoose.models)) await m.deleteMany({});
  const svc = makeTestServices();
  setServices(svc);
  return svc;
}

export const day = (n: number): string => formatDay(addDays(todayUTC(), n));

export async function makeUser(role: Role, name = role) {
  const u = await User.create({ email: `${name}-${new Types.ObjectId()}@example.com`, passwordHash: 'x', name, role });
  return { id: String(u._id), token: signAccessToken(String(u._id), role), auth: { Authorization: `Bearer ${signAccessToken(String(u._id), role)}` } };
}

export async function makeShopWithSku(opts: { totalQty?: number; bufferDays?: number; dailyPriceMinor?: number; depositMinor?: number } = {}) {
  const shop = await makeUser('shop');
  await Shop.create({ userId: shop.id, name: 'Test Shop', addressLine: '1 Main St', city: 'Delhi', location: point(28.6139, 77.209) });
  const sku = await Sku.create({
    shopId: shop.id,
    title: 'Power drill',
    category: 'tools',
    totalQty: opts.totalQty ?? 1,
    bufferDays: opts.bufferDays ?? 0,
    dailyPriceMinor: opts.dailyPriceMinor ?? 10000,
    depositMinor: opts.depositMinor ?? 50000,
  });
  return { shop, sku };
}

export async function makeOnlineDriver(lat = 28.62, lng = 77.21) {
  const user = await makeUser('driver');
  await Driver.create({ userId: user.id, online: true, location: point(lat, lng), locationUpdatedAt: new Date() });
  return user;
}

export const orderBody = (skuId: string, over: Record<string, unknown> = {}) => ({
  items: [{ skuId, qty: 1 }],
  rentalStart: day(3),
  rentalEnd: day(5),
  address: { line1: '12 Park Lane', city: 'Delhi', postalCode: '110001', lat: 28.63, lng: 77.22 },
  ...over,
});
