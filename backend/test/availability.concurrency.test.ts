import { Types } from 'mongoose';
import { AvailabilityDay, Reservation } from '../src/modules/availability/availability.model';
import { confirmReservations, getAvailability, releaseReservations, reserve } from '../src/modules/availability/availability.service';
import { AppError } from '../src/utils/errors';
import { clearDb, day, makeShopWithSku, startDb, stopDb } from './helpers';

const oid = () => new Types.ObjectId().toString();
const req = (skuId: string, qty: number, start: string, end: string, orderId = oid()) => ({
  orderId,
  items: [{ skuId, qty }],
  rentalStart: start,
  rentalEnd: end,
  holdSeconds: 600,
});

beforeAll(startDb, 120_000);
afterAll(stopDb);
beforeEach(clearDb);

describe('availability under concurrency', () => {
  it('100 parallel reservations for 10 units: exactly 10 win, no day is ever over capacity', async () => {
    const { sku } = await makeShopWithSku({ totalQty: 10, bufferDays: 1 });
    const results = await Promise.allSettled(Array.from({ length: 100 }, () => reserve(req(String(sku._id), 1, day(5), day(7)))));

    const won = results.filter((r) => r.status === 'fulfilled').length;
    const soldOut = results.filter((r) => r.status === 'rejected' && (r.reason as AppError).code === 'sold_out').length;
    expect(won).toBe(10);
    expect(soldOut).toBe(90);

    const days = await AvailabilityDay.find({ skuId: sku._id });
    expect(days).toHaveLength(5); // 3 rental days + 1 buffer day each side
    days.forEach((d) => expect(d.reserved).toBe(10));
    expect(await Reservation.countDocuments({ status: 'HELD' })).toBe(10);
  }, 120_000);

  it('partial overlap is rejected and leaves no partial increments (atomic rollback)', async () => {
    const { sku } = await makeShopWithSku({ totalQty: 10 });
    await reserve(req(String(sku._id), 6, day(5), day(7)));
    await expect(reserve(req(String(sku._id), 6, day(7), day(9)))).rejects.toMatchObject({ code: 'sold_out' });

    const rows = await AvailabilityDay.find({ skuId: sku._id }).sort({ date: 1 });
    const byDay = Object.fromEntries(rows.map((r) => [r.date.toISOString().slice(0, 10), r.reserved]));
    expect(byDay[day(7)]).toBe(6); // the loser did not touch the contested day...
    expect(byDay[day(8)] ?? 0).toBe(0); // ...nor the days that would have succeeded
    expect(byDay[day(9)] ?? 0).toBe(0);
  });

  it('a multi-item order is all-or-nothing', async () => {
    const a = await makeShopWithSku({ totalQty: 5 });
    const b = await makeShopWithSku({ totalQty: 1 });
    await reserve(req(String(b.sku._id), 1, day(6), day(6))); // B is taken on day 6

    await expect(
      reserve({
        orderId: oid(),
        items: [{ skuId: String(a.sku._id), qty: 2 }, { skuId: String(b.sku._id), qty: 1 }],
        rentalStart: day(5),
        rentalEnd: day(7),
        holdSeconds: 600,
      }),
    ).rejects.toMatchObject({ code: 'sold_out' });

    const aRows = await AvailabilityDay.find({ skuId: a.sku._id });
    aRows.forEach((r) => expect(r.reserved).toBe(0)); // A's increments were rolled back with B's failure
  });

  it('buffer days block adjacent rentals', async () => {
    const { sku } = await makeShopWithSku({ totalQty: 1, bufferDays: 1 });
    await reserve(req(String(sku._id), 1, day(5), day(6))); // blocks day 4..7
    await expect(reserve(req(String(sku._id), 1, day(7), day(8)))).rejects.toMatchObject({ code: 'sold_out' });
    await expect(reserve(req(String(sku._id), 1, day(8), day(9)))).resolves.toHaveLength(1);
  });

  it('reserve() is replay-safe for the same order', async () => {
    const { sku } = await makeShopWithSku({ totalQty: 5 });
    const input = req(String(sku._id), 2, day(5), day(6));
    const first = await reserve(input);
    const second = await reserve(input);
    expect(second[0]!.id).toBe(first[0]!.id);
    const rows = await AvailabilityDay.find({ skuId: sku._id });
    rows.forEach((r) => expect(r.reserved).toBe(2)); // incremented once, not twice
  });

  it('release is exactly-once, even called concurrently', async () => {
    const { sku } = await makeShopWithSku({ totalQty: 5 });
    const input = req(String(sku._id), 2, day(5), day(6));
    await reserve(input);
    const counts = await Promise.all([1, 2, 3, 4].map(() => releaseReservations(input.orderId)));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    const rows = await AvailabilityDay.find({ skuId: sku._id });
    rows.forEach((r) => expect(r.reserved).toBe(0)); // never negative, never double-decremented
  });

  it('hold expiry racing payment confirmation always ends consistent', async () => {
    for (let i = 0; i < 15; i++) {
      await clearDb();
      const { sku } = await makeShopWithSku({ totalQty: 3 });
      const input = req(String(sku._id), 1, day(5), day(6));
      await reserve(input);
      await Promise.allSettled([confirmReservations(input.orderId), releaseReservations(input.orderId, { onlyHeld: true })]);

      const r = await Reservation.findOne({ orderId: input.orderId });
      const rows = await AvailabilityDay.find({ skuId: sku._id });
      if (r!.status === 'CONFIRMED') rows.forEach((d) => expect(d.reserved).toBe(1));
      else {
        expect(r!.status).toBe('RELEASED');
        rows.forEach((d) => expect(d.reserved).toBe(0));
      }
    }
  }, 120_000);

  it('confirm fails once the hold has been released', async () => {
    const { sku } = await makeShopWithSku({ totalQty: 3 });
    const input = req(String(sku._id), 1, day(5), day(6));
    await reserve(input);
    await releaseReservations(input.orderId, { onlyHeld: true });
    await expect(confirmReservations(input.orderId)).rejects.toMatchObject({ code: 'reservation_expired' });
  });

  it('reports remaining units per day', async () => {
    const { sku } = await makeShopWithSku({ totalQty: 4 });
    await reserve(req(String(sku._id), 3, day(5), day(5)));
    const days = await getAvailability(String(sku._id), day(4), day(6));
    expect(days).toEqual([
      { date: day(4), available: 4 },
      { date: day(5), available: 1 },
      { date: day(6), available: 4 },
    ]);
  });

  it('rejects windows in the past, over 30 days, or with unknown SKUs', async () => {
    const { sku } = await makeShopWithSku();
    await expect(reserve(req(String(sku._id), 1, day(-1), day(1)))).rejects.toMatchObject({ code: 'invalid_window' });
    await expect(reserve(req(String(sku._id), 1, day(1), day(40)))).rejects.toMatchObject({ code: 'invalid_window' });
    await expect(reserve(req(oid(), 1, day(1), day(2)))).rejects.toMatchObject({ code: 'sku_not_found' });
  });
});
