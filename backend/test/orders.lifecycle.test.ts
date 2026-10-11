import { Types } from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app';
import { processJob } from '../src/jobs/handlers';
import { AvailabilityDay, Reservation } from '../src/modules/availability/availability.model';
import { DeliveryTask } from '../src/modules/drivers/driver.model';
import { acceptTask, dispatchTask, expireOffer } from '../src/modules/drivers/dispatch.service';
import { Order, OrderEvent } from '../src/modules/orders/order.model';
import { placeOrder, transition } from '../src/modules/orders/order.service';
import { executePaymentAction, handleProviderEvent } from '../src/modules/payments/payments.service';
import { services } from '../src/services';
import type { FakePaymentProvider } from '../src/modules/payments/fakeProvider';
import type { RecordingJobs, RecordingRealtime } from '../src/services/defaults';
import { clearDb, day, makeOnlineDriver, makeShopWithSku, makeUser, orderBody, startDb, stopDb } from './helpers';

const SYSTEM = { id: 'system', role: 'system' } as const;
const app = createApp();

beforeAll(startDb, 120_000);
afterAll(stopDb);
beforeEach(clearDb);

const provider = () => services().payments as FakePaymentProvider;

async function placeAndPay() {
  const { shop, sku } = await makeShopWithSku({ totalQty: 2, dailyPriceMinor: 10000, depositMinor: 50000 });
  const customer = await makeUser('customer');
  const { order, clientSecret } = await placeOrder(customer.id, orderBody(String(sku._id)), `key-${new Types.ObjectId()}`);
  expect(clientSecret).toContain('_secret');
  const intentId = order.payment!.intentId!;
  await handleProviderEvent(provider().authorize(intentId));
  return { shop, sku, customer, orderId: String(order._id) };
}

describe('placement', () => {
  it('creates a PENDING_PAYMENT order with a held reservation and a scheduled hold expiry', async () => {
    const { sku } = await makeShopWithSku({ totalQty: 2 });
    const customer = await makeUser('customer');
    const { order } = await placeOrder(customer.id, orderBody(String(sku._id)), 'k1');

    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.rentMinor).toBe(3 * 10000); // 3 days
    expect(order.totalMinor).toBe(3 * 10000 + 50000);
    expect(await Reservation.countDocuments({ orderId: order._id, status: 'HELD' })).toBe(1);
    expect((services().jobs as RecordingJobs).names()).toContain('holdExpiry');
    expect(provider().calls[0]).toMatchObject({ type: 'create', amountMinor: 80000 });
  });

  it('fails the order and releases the hold if the payment provider is down', async () => {
    const { sku } = await makeShopWithSku({ totalQty: 2 });
    const customer = await makeUser('customer');
    provider().failNextAuthorization = true;
    await expect(placeOrder(customer.id, orderBody(String(sku._id)), 'k2')).rejects.toMatchObject({ code: 'payment_unavailable' });

    const order = await Order.findOne({});
    expect(order!.status).toBe('PAYMENT_FAILED');
    const days = await AvailabilityDay.find({ skuId: sku._id });
    days.forEach((d) => expect(d.reserved).toBe(0));
  });

  it('rejects mixed-shop carts', async () => {
    const a = await makeShopWithSku();
    const b = await makeShopWithSku();
    const customer = await makeUser('customer');
    await expect(
      placeOrder(customer.id, orderBody(String(a.sku._id), { items: [{ skuId: String(a.sku._id), qty: 1 }, { skuId: String(b.sku._id), qty: 1 }] }), 'k3'),
    ).rejects.toMatchObject({ code: 'mixed_shops' });
  });
});

describe('payments', () => {
  it('confirms on authorization, and a redelivered webhook is a no-op', async () => {
    const { sku } = await makeShopWithSku({ totalQty: 2 });
    const customer = await makeUser('customer');
    const { order } = await placeOrder(customer.id, orderBody(String(sku._id)), 'k1');
    const evt = provider().authorize(order.payment!.intentId!);

    expect(await handleProviderEvent(evt)).toBe('processed');
    expect(await handleProviderEvent(evt)).toBe('duplicate');
    expect(await handleProviderEvent(evt)).toBe('duplicate');

    const fresh = await Order.findById(order._id);
    expect(fresh!.status).toBe('CONFIRMED');
    expect(fresh!.version).toBe(2);
    expect(await OrderEvent.countDocuments({ orderId: order._id, toStatus: 'CONFIRMED' })).toBe(1);
    expect(await DeliveryTask.countDocuments({ orderId: order._id, leg: 'DELIVERY' })).toBe(1);
    expect(await Reservation.countDocuments({ orderId: order._id, status: 'CONFIRMED' })).toBe(1);
  });

  it('a payment that arrives after the hold expired is released, never charged', async () => {
    const { sku } = await makeShopWithSku({ totalQty: 2 });
    const customer = await makeUser('customer');
    const { order } = await placeOrder(customer.id, orderBody(String(sku._id)), 'k1');
    await processJob('hold-expiry', { orderId: String(order._id) });
    expect((await Order.findById(order._id))!.status).toBe('PAYMENT_FAILED');

    await handleProviderEvent(provider().authorize(order.payment!.intentId!));
    expect((await Order.findById(order._id))!.status).toBe('PAYMENT_FAILED');
    const jobs = (services().jobs as RecordingJobs).scheduled.filter((s) => s.name === 'paymentAction');
    expect(jobs.some((j) => j.args[1] === 'cancel')).toBe(true);

    await executePaymentAction(String(order._id), 'cancel');
    expect(provider().calls.some((c) => c.type === 'cancel')).toBe(true);
  });

  it('hold expiry is a no-op once the order is paid', async () => {
    const { orderId } = await placeAndPay();
    await processJob('hold-expiry', { orderId });
    expect((await Order.findById(orderId))!.status).toBe('CONFIRMED');
  });
});

describe('state machine rules', () => {
  it('replays the same idempotency key without applying twice', async () => {
    const { orderId, customer } = await placeAndPay();
    const input = { orderId, event: 'CUSTOMER_CANCEL', actor: { id: customer.id, role: 'customer' as const }, idempotencyKey: 'cancel-1' };
    const first = await transition(input);
    const second = await transition(input);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(await OrderEvent.countDocuments({ orderId, event: 'CUSTOMER_CANCEL' })).toBe(1);
  });

  it('exactly one of two concurrent cancels wins, and capacity is released once', async () => {
    const { orderId, customer, shop, sku } = await placeAndPay();
    const results = await Promise.allSettled([
      transition({ orderId, event: 'CUSTOMER_CANCEL', actor: { id: customer.id, role: 'customer' }, idempotencyKey: 'a' }),
      transition({ orderId, event: 'SHOP_CANCEL', actor: { id: shop.id, role: 'shop' }, idempotencyKey: 'b' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason.code).toBe('illegal_transition');

    const order = await Order.findById(orderId);
    expect(order!.status).toBe('CANCELLED');
    expect(order!.version).toBe(3);
    (await AvailabilityDay.find({ skuId: sku._id })).forEach((d) => expect(d.reserved).toBe(0));
  });

  it("does not reveal an order's status to someone who does not own it", async () => {
    const { orderId, customer } = await placeAndPay();
    await transition({ orderId, event: 'CUSTOMER_CANCEL', actor: { id: customer.id, role: 'customer' }, idempotencyKey: 'own-cancel' });
    const stranger = await makeUser('customer');
    // The order is CANCELLED, so for the owner this event would be an illegal transition (409 with the status).
    // For a stranger it must be a plain 403: no status in the response.
    const err = await transition({ orderId, event: 'CUSTOMER_CANCEL', actor: { id: stranger.id, role: 'customer' }, idempotencyKey: 'probe' }).catch((e) => e);
    expect(err.code).toBe('forbidden');
    expect(err.details).toBeUndefined();
  });

  it('rejects wrong actors, wrong states, and missing payloads', async () => {
    const { orderId, customer } = await placeAndPay();
    const stranger = await makeUser('customer');
    await expect(transition({ orderId, event: 'CUSTOMER_CANCEL', actor: { id: stranger.id, role: 'customer' }, idempotencyKey: 'x1' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(transition({ orderId, event: 'SETTLE', actor: { id: customer.id, role: 'customer' }, idempotencyKey: 'x2' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(transition({ orderId, event: 'DRIVER_DELIVERED', actor: SYSTEM, idempotencyKey: 'x3' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(transition({ orderId, event: 'NOPE', actor: SYSTEM, idempotencyKey: 'x4' })).rejects.toMatchObject({ code: 'unknown_event' });
    await expect(transition({ orderId, event: 'MARK_OVERDUE', actor: SYSTEM, idempotencyKey: 'x5' })).rejects.toMatchObject({ code: 'illegal_transition' });
  });
});

describe('full lifecycle: order, delivery, return, settlement', () => {
  it('walks every state and captures rent + damage', async () => {
    const { orderId, customer, shop } = await placeAndPay();
    const driver = await makeOnlineDriver();
    const otherDriver = await makeOnlineDriver(28.7, 77.3);
    const rt = services().realtime as RecordingRealtime;
    const act = (id: string, role: 'driver' | 'shop' | 'customer') => ({ id, role });

    // dispatch the delivery task to the nearest driver and accept it
    const deliveryTask = (await DeliveryTask.findOne({ orderId, leg: 'DELIVERY' }))!;
    expect(await dispatchTask(String(deliveryTask._id))).toBe('offered');
    expect(rt.events.some((e) => e.event === 'task.offer' && e.room === `user:${driver.id}`)).toBe(true);
    await expect(acceptTask(String(deliveryTask._id), otherDriver.id)).rejects.toMatchObject({ code: 'offer_unavailable' });
    await acceptTask(String(deliveryTask._id), driver.id);
    expect(String((await Order.findById(orderId))!.deliveryDriverId)).toBe(driver.id);

    // only the assigned driver can act
    await expect(transition({ orderId, event: 'DRIVER_PICKED_UP_FROM_SHOP', actor: act(otherDriver.id, 'driver'), idempotencyKey: 'd0' })).rejects.toMatchObject({ code: 'forbidden' });
    await transition({ orderId, event: 'DRIVER_PICKED_UP_FROM_SHOP', actor: act(driver.id, 'driver'), idempotencyKey: 'd1' });
    await expect(transition({ orderId, event: 'DRIVER_DELIVERED', actor: act(driver.id, 'driver'), idempotencyKey: 'd2' })).rejects.toMatchObject({ code: 'invalid_payload' });
    await transition({ orderId, event: 'DRIVER_DELIVERED', actor: act(driver.id, 'driver'), idempotencyKey: 'd3', payload: { proofPhotoUrl: 'https://example.com/p.jpg' } });
    await expect(transition({ orderId, event: 'CUSTOMER_CANCEL', actor: act(customer.id, 'customer'), idempotencyKey: 'd4' })).rejects.toMatchObject({ code: 'illegal_transition' });

    await transition({ orderId, event: 'RENTAL_STARTED', actor: SYSTEM, idempotencyKey: 's1' });
    await transition({ orderId, event: 'REQUEST_RETURN', actor: act(customer.id, 'customer'), idempotencyKey: 'r1' });

    const returnTask = (await DeliveryTask.findOne({ orderId, leg: 'RETURN' }))!;
    await DeliveryTask.updateOne({ _id: deliveryTask._id }, { $set: { status: 'DONE' } }); // delivery driver is free again
    expect(await dispatchTask(String(returnTask._id))).toBe('offered');
    await acceptTask(String(returnTask._id), driver.id);
    await transition({ orderId, event: 'DRIVER_PICKED_UP_RETURN', actor: act(driver.id, 'driver'), idempotencyKey: 'r2', payload: { proofPhotoUrl: 'https://example.com/r.jpg' } });
    await transition({ orderId, event: 'SHOP_INSPECTED', actor: act(shop.id, 'shop'), idempotencyKey: 'i1', payload: { damageMinor: 5000 } });
    await transition({ orderId, event: 'SETTLE', actor: SYSTEM, idempotencyKey: 'f1' });

    const settled = (await Order.findById(orderId))!;
    expect(settled.status).toBe('SETTLED');
    expect(settled.settlement!.capturedMinor).toBe(30000 + 5000); // rent + damage, deposit remainder is released
    await executePaymentAction(orderId, 'capture');
    await executePaymentAction(orderId, 'capture'); // retry-safe
    expect(provider().calls.filter((c) => c.type === 'capture')).toHaveLength(1);
    expect((await Order.findById(orderId))!.payment!.status).toBe('captured');

    const log = await OrderEvent.find({ orderId }).sort({ version: 1 });
    expect(log.map((e) => e.version)).toEqual(log.map((_, i) => i + 1)); // gapless audit trail
    expect(log.at(-1)!.toStatus).toBe('SETTLED');
  }, 60_000);
});

describe('dispatch', () => {
  it('re-offers after a timeout and never re-offers to a driver who skipped', async () => {
    const { orderId } = await placeAndPay();
    const driver = await makeOnlineDriver();
    const task = (await DeliveryTask.findOne({ orderId }))!;
    expect(await dispatchTask(String(task._id))).toBe('offered');

    expect(await expireOffer(String(task._id), driver.id)).toBe(false); // not expired yet
    await DeliveryTask.updateOne({ _id: task._id }, { $set: { offerExpiresAt: new Date(Date.now() - 1000) } });
    await expect(acceptTask(String(task._id), driver.id)).rejects.toMatchObject({ code: 'offer_unavailable' }); // late accept
    expect(await expireOffer(String(task._id), driver.id)).toBe(true);

    const reopened = (await DeliveryTask.findById(task._id))!;
    expect(reopened.status).toBe('OPEN');
    expect(reopened.declinedBy.map(String)).toContain(driver.id);
    expect(await dispatchTask(String(task._id))).toBe('no_candidate');
  });

  it('only one of two concurrent accepts can claim a task', async () => {
    const { orderId } = await placeAndPay();
    const driver = await makeOnlineDriver();
    const task = (await DeliveryTask.findOne({ orderId }))!;
    await dispatchTask(String(task._id));
    const results = await Promise.allSettled([acceptTask(String(task._id), driver.id), acceptTask(String(task._id), driver.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});

describe('HTTP: idempotency and access control', () => {
  it('replays the stored response for the same Idempotency-Key and rejects a different body', async () => {
    const { sku } = await makeShopWithSku({ totalQty: 3 });
    const customer = await makeUser('customer');
    const body = orderBody(String(sku._id));
    const first = await request(app).post('/v1/orders').set(customer.auth).set('Idempotency-Key', 'abc').send(body).expect(201);
    const second = await request(app).post('/v1/orders').set(customer.auth).set('Idempotency-Key', 'abc').send(body).expect(201);

    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.order._id).toBe(first.body.order._id);
    expect(await Order.countDocuments({})).toBe(1);

    await request(app).post('/v1/orders').set(customer.auth).set('Idempotency-Key', 'abc').send(orderBody(String(sku._id), { rentalEnd: day(6) })).expect(422);
    await request(app).post('/v1/orders').set(customer.auth).send(body).expect(400); // key is required
  });

  it('two simultaneous requests with one key create one order', async () => {
    const { sku } = await makeShopWithSku({ totalQty: 3 });
    const customer = await makeUser('customer');
    const body = orderBody(String(sku._id));
    const [a, b] = await Promise.all([
      request(app).post('/v1/orders').set(customer.auth).set('Idempotency-Key', 'dup').send(body),
      request(app).post('/v1/orders').set(customer.auth).set('Idempotency-Key', 'dup').send(body),
    ]);
    expect([a.status, b.status].filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
    expect([a.status, b.status].every((s) => s === 201 || s === 409)).toBe(true);
    expect(await Order.countDocuments({})).toBe(1);
  });

  it("hides other users' orders (404) and lets participants read them", async () => {
    const { sku } = await makeShopWithSku({ totalQty: 3 });
    const customer = await makeUser('customer');
    const stranger = await makeUser('customer');
    const created = await request(app).post('/v1/orders').set(customer.auth).set('Idempotency-Key', 'k').send(orderBody(String(sku._id))).expect(201);
    const id = created.body.order._id;
    await request(app).get(`/v1/orders/${id}`).set(customer.auth).expect(200);
    await request(app).get(`/v1/orders/${id}`).set(stranger.auth).expect(404);
    await request(app).get(`/v1/orders/${id}/tracking`).set(stranger.auth).expect(404);
  });

  it('accepts a webhook through the raw-body route', async () => {
    const { sku } = await makeShopWithSku({ totalQty: 3 });
    const customer = await makeUser('customer');
    const created = await request(app).post('/v1/orders').set(customer.auth).set('Idempotency-Key', 'w').send(orderBody(String(sku._id))).expect(201);
    const evt = provider().authorize(created.body.order.payment.intentId);
    await request(app).post('/v1/payments/webhook').set('Content-Type', 'application/json').send(JSON.stringify(evt)).expect(200);
    expect((await Order.findById(created.body.order._id))!.status).toBe('CONFIRMED');
  });
});
