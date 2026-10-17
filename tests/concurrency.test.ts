import { describe, expect, test } from 'bun:test';
import { mapLimit } from '../server/concurrency.ts';

describe('mapLimit', () => {
  test('keeps input order and never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapLimit([30, 5, 20, 1, 10], 2, async (ms) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Bun.sleep(ms);
      inFlight--;
      return ms * 2;
    });
    expect(peak).toBe(2);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([60, 10, 40, 2, 20]);
  });

  test('reports rejections per item instead of throwing', async () => {
    const results = await mapLimit([1, 2, 3], 3, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    });
    expect(results[0]).toEqual({ status: 'fulfilled', value: 1 });
    expect(results[1].status).toBe('rejected');
    expect(results[2]).toEqual({ status: 'fulfilled', value: 3 });
  });

  test('handles an empty list', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});
