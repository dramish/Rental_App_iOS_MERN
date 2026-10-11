import { ORDER_STATUSES } from '../src/modules/orders/order.model';
import { TERMINAL_STATUSES, TRANSITIONS } from '../src/modules/orders/orderStateMachine';
import { computePricing, computeSettlement } from '../src/modules/orders/pricing';
import { validateWindow } from '../src/modules/availability/availability.service';
import { addDays, eachDay, parseDay, formatDay } from '../src/utils/dates';
import { etaMinutes, haversineMeters } from '../src/utils/geo';

describe('state machine table', () => {
  it('only references real statuses', () => {
    for (const r of Object.values(TRANSITIONS)) {
      expect(ORDER_STATUSES).toContain(r.to);
      r.from.forEach((s) => expect(ORDER_STATUSES).toContain(s));
    }
  });

  it('has no transitions out of terminal states', () => {
    for (const r of Object.values(TRANSITIONS)) {
      r.from.forEach((s) => expect(TERMINAL_STATUSES).not.toContain(s));
    }
  });

  it('every non-initial status is reachable from PENDING_PAYMENT', () => {
    const reach = new Set<string>(['PENDING_PAYMENT']);
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of Object.values(TRANSITIONS)) {
        if (r.from.some((s) => reach.has(s)) && !reach.has(r.to)) {
          reach.add(r.to);
          grew = true;
        }
      }
    }
    expect([...reach].sort()).toEqual([...ORDER_STATUSES].sort());
  });

  it('customers cannot drive delivery or settlement events', () => {
    for (const e of ['DRIVER_DELIVERED', 'DRIVER_PICKED_UP_RETURN', 'SETTLE', 'SHOP_INSPECTED', 'PAYMENT_AUTHORIZED'] as const) {
      expect(TRANSITIONS[e].actors).not.toContain('customer');
    }
  });
});

describe('pricing', () => {
  it('computes rent and deposit in integer minor units', () => {
    const p = computePricing([{ qty: 2, dailyPriceMinor: 15000, depositMinor: 50000 }, { qty: 1, dailyPriceMinor: 5000, depositMinor: 0 }], 3);
    expect(p).toEqual({ rentMinor: 2 * 15000 * 3 + 5000 * 3, depositMinor: 100000, totalMinor: 90000 + 15000 + 100000 });
  });

  it('captures rent only when returned on time and undamaged', () => {
    const s = computeSettlement({ rentMinor: 30000, depositMinor: 50000, days: 3, rentalEnd: '2030-01-10', returnedOn: parseDay('2030-01-10'), damageMinor: 0 });
    expect(s).toEqual({ lateDays: 0, lateFeeMinor: 0, damageMinor: 0, capturedMinor: 30000 });
  });

  it('adds a 1.5x late fee per late day', () => {
    const s = computeSettlement({ rentMinor: 30000, depositMinor: 50000, days: 3, rentalEnd: '2030-01-10', returnedOn: parseDay('2030-01-12'), damageMinor: 0 });
    expect(s.lateDays).toBe(2);
    expect(s.lateFeeMinor).toBe(30000); // 2 days * 10000/day * 1.5
    expect(s.capturedMinor).toBe(60000);
  });

  it('never captures more than the authorization', () => {
    const s = computeSettlement({ rentMinor: 30000, depositMinor: 50000, days: 3, rentalEnd: '2030-01-10', returnedOn: parseDay('2030-01-10'), damageMinor: 999999 });
    expect(s.capturedMinor).toBe(80000);
  });
});

describe('dates and windows', () => {
  it('parses strict UTC days and rejects junk', () => {
    expect(formatDay(parseDay('2030-02-28'))).toBe('2030-02-28');
    expect(() => parseDay('2030-02-30')).toThrow();
    expect(() => parseDay('tomorrow')).toThrow();
  });

  it('enumerates inclusive ranges across a month boundary', () => {
    expect(eachDay(parseDay('2030-01-30'), parseDay('2030-02-02')).map(formatDay)).toEqual(['2030-01-30', '2030-01-31', '2030-02-01', '2030-02-02']);
    expect(formatDay(addDays(parseDay('2030-03-01'), -1))).toBe('2030-02-28');
  });

  it('validates rental windows', () => {
    const now = new Date('2030-01-05T12:00:00Z');
    expect(validateWindow('2030-01-05', '2030-01-07', now).days).toBe(3);
    expect(() => validateWindow('2030-01-04', '2030-01-07', now)).toThrow(/past/);
    expect(() => validateWindow('2030-01-08', '2030-01-07', now)).toThrow();
    expect(() => validateWindow('2030-01-05', '2030-03-01', now)).toThrow(/limited/);
  });
});

describe('geo', () => {
  it('haversine is roughly right (Delhi to Gurugram ~ 25-30 km)', () => {
    const d = haversineMeters({ lat: 28.6139, lng: 77.209 }, { lat: 28.4595, lng: 77.0266 });
    expect(d).toBeGreaterThan(22_000);
    expect(d).toBeLessThan(30_000);
  });
  it('eta is at least a minute', () => {
    expect(etaMinutes(10)).toBe(1);
    expect(etaMinutes(25_000, 25)).toBe(60);
  });
});
