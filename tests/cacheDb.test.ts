import { beforeAll, describe, expect, test } from 'bun:test';
import { cacheDb } from '../server/cacheDb.ts';

describe('cacheDb TTL', () => {
  beforeAll(async () => {
    await cacheDb.init();
  });

  test('returns fresh entries', () => {
    cacheDb.set('t:fresh', 'test', null, [1, 2], undefined, 60_000);
    expect(cacheDb.get<number[]>('t:fresh')?.data).toEqual([1, 2]);
    expect(cacheDb.get('t:fresh')?.stale).toBe(false);
  });

  test('hides expired entries unless allowStale is set', async () => {
    cacheDb.set('t:old', 'test', null, { v: 1 }, undefined, 1);
    await Bun.sleep(5);
    expect(cacheDb.get('t:old')).toBeNull();
    const stale = cacheDb.get<{ v: number }>('t:old', { allowStale: true });
    expect(stale?.data.v).toBe(1);
    expect(stale?.stale).toBe(true);
  });

  test('missing keys return null', () => {
    expect(cacheDb.get('t:none', { allowStale: true })).toBeNull();
  });
});
