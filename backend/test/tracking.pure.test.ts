import { shouldAccept, type IncomingPoint } from '../src/modules/tracking/location.service';
import type { CachedLocation } from '../src/services/types';

const T0 = Date.parse('2030-01-01T10:00:00.000Z');
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();
const pt = (seq: number, offsetMs: number, lat = 28.6139, lng = 77.209, accuracy = 10): IncomingPoint => ({ lat, lng, accuracy, recordedAt: iso(offsetMs), seq });
const prevOf = (p: IncomingPoint): CachedLocation => ({ lat: p.lat, lng: p.lng, accuracy: p.accuracy, recordedAt: p.recordedAt, seq: p.seq });
const NOW = T0 + 60_000;

describe('shouldAccept (location filter)', () => {
  it('accepts the first point', () => {
    expect(shouldAccept(null, pt(1, 0), NOW)).toEqual({ accept: true });
  });

  it('drops stale and replayed sequence numbers', () => {
    const prev = prevOf(pt(5, 0));
    expect(shouldAccept(prev, pt(5, 5000, 28.62), NOW)).toEqual({ accept: false, reason: 'stale' });
    expect(shouldAccept(prev, pt(3, 5000, 28.62), NOW)).toEqual({ accept: false, reason: 'stale' });
  });

  it('drops low-accuracy fixes', () => {
    expect(shouldAccept(null, pt(1, 0, 28.6, 77.2, 500), NOW)).toEqual({ accept: false, reason: 'inaccurate' });
  });

  it('drops points timestamped in the future (bad device clock)', () => {
    expect(shouldAccept(null, pt(1, 10 * 60_000), NOW)).toEqual({ accept: false, reason: 'future' });
  });

  it('throttles points closer than the minimum interval', () => {
    const prev = prevOf(pt(1, 0));
    expect(shouldAccept(prev, pt(2, 1000, 28.62), NOW)).toEqual({ accept: false, reason: 'throttled' });
  });

  it('drops stationary jitter but allows a heartbeat after 15s', () => {
    const prev = prevOf(pt(1, 0));
    expect(shouldAccept(prev, pt(2, 5000, 28.613901), NOW)).toEqual({ accept: false, reason: 'duplicate' });
    expect(shouldAccept(prev, pt(3, 16_000, 28.613901), NOW)).toEqual({ accept: true });
  });

  it('accepts real movement', () => {
    const prev = prevOf(pt(1, 0));
    expect(shouldAccept(prev, pt(2, 3000, 28.6145), NOW)).toEqual({ accept: true });
  });

  it('thins an offline replay by recordedAt, not arrival time', () => {
    let prev: CachedLocation | null = null;
    const accepted: number[] = [];
    // 10 points one second apart, moving: only every other point survives the 2s minimum interval.
    for (let i = 0; i < 10; i++) {
      const p = pt(i + 1, i * 1000, 28.6139 + i * 0.001);
      if (shouldAccept(prev, p, NOW).accept) {
        accepted.push(p.seq);
        prev = prevOf(p);
      }
    }
    expect(accepted).toEqual([1, 3, 5, 7, 9]);
  });
});
