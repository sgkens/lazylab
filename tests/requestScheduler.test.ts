import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GitLabApiError, GitLabClient } from '../server/gitlabClient.ts';
import {
  parseBudget,
  parseResetHeader,
  parseRetryAfter,
  RateLimitedError,
  RequestScheduler,
  requestScheduler,
  runInLane
} from '../server/requestScheduler.ts';

/** A scheduler on a fake clock; tests advance `clock.t` and call pump(). */
const fake = (budget = { plan: 'custom' as const, perHour: 0, perMinute: 0 }, maxConcurrent = 8) => {
  const clock = { t: 1_800_000_000_000 };
  const s = new RequestScheduler({ budget, maxConcurrent, now: () => clock.t, random: () => 0 });
  return { s, clock };
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('header parsing', () => {
  test('Retry-After as seconds or HTTP date', () => {
    expect(parseRetryAfter('30', 1000)).toBe(31_000);
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT')).toBe(Date.parse('Wed, 21 Oct 2026 07:28:00 GMT'));
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });

  test('RateLimit-Reset as epoch seconds or delta seconds', () => {
    expect(parseResetHeader('1800000000', 0)).toBe(1_800_000_000_000);
    expect(parseResetHeader('45', 1000)).toBe(46_000);
    expect(parseResetHeader('-1')).toBeNull();
  });

  test('budget validation', () => {
    expect(parseBudget({ plan: 'free' })).toEqual({ plan: 'free', perHour: 4000, perMinute: 80 });
    expect(parseBudget({ plan: 'custom', perHour: 100, perMinute: 10 })).toEqual({ plan: 'custom', perHour: 100, perMinute: 10 });
    expect(() => parseBudget({ plan: 'gold' })).toThrow();
    expect(() => parseBudget({ plan: 'custom', perHour: -1, perMinute: 1 })).toThrow();
    expect(() => parseBudget({ plan: 'custom', perHour: 1.5, perMinute: 1 })).toThrow();
    expect(() => parseBudget(null)).toThrow();
  });
});

describe('RequestScheduler', () => {
  test('the per-minute bucket holds requests until tokens refill', async () => {
    const { s, clock } = fake({ plan: 'custom', perHour: 0, perMinute: 2 });
    const granted: number[] = [];
    for (let i = 0; i < 3; i++) s.acquire('interactive').then((release) => (granted.push(i), release()));
    await flush();
    expect(granted).toEqual([0, 1]);
    clock.t += 30_000; // half a minute refills one token at 2/min
    s.pump();
    await flush();
    expect(granted).toEqual([0, 1, 2]);
  });

  test('interactive requests go before queued background requests', async () => {
    const { s, clock } = fake({ plan: 'custom', perHour: 0, perMinute: 100 });
    // Drain the bucket.
    for (let i = 0; i < 100; i++) (await s.acquire('interactive'))();
    const order: string[] = [];
    s.acquire('background').then((r) => (order.push('background'), r()));
    s.acquire('watch').then((r) => (order.push('watch'), r()));
    s.acquire('interactive').then((r) => (order.push('interactive'), r()));
    await flush();
    expect(order).toEqual([]);
    clock.t += 20_000; // 33 tokens: enough for each lane's reserve in priority order
    s.pump();
    await flush();
    expect(order).toEqual(['interactive', 'watch', 'background']);
  });

  test('background keeps a reserve: it waits while the bucket is below 20%', async () => {
    const { s, clock } = fake({ plan: 'custom', perHour: 0, perMinute: 10 });
    for (let i = 0; i < 8; i++) (await s.acquire('interactive'))(); // 2 of 10 left
    let bg = false;
    s.acquire('background').then((r) => ((bg = true), r()));
    await flush();
    expect(bg).toBe(false);
    let ui = false;
    s.acquire('interactive').then((r) => ((ui = true), r()));
    await flush();
    expect(ui).toBe(true);
    clock.t += 60_000;
    s.pump();
    await flush();
    expect(bg).toBe(true);
  });

  test('low RateLimit-Remaining holds background until the reset, interactive continues', async () => {
    const { s, clock } = fake();
    s.observe(200, new Headers({ 'RateLimit-Limit': '100', 'RateLimit-Remaining': '10', 'RateLimit-Reset': String(Math.floor((clock.t + 20_000) / 1000)) }));
    let bg = false;
    s.acquire('background').then((r) => ((bg = true), r()));
    let ui = false;
    s.acquire('interactive').then((r) => ((ui = true), r()));
    await flush();
    expect(ui).toBe(true);
    expect(bg).toBe(false);
    expect(s.getStatus().slowedLanes).toContain('background');
    expect(s.getStatus().message).toContain('quota low');
    clock.t += 21_000;
    s.pump();
    await flush();
    expect(bg).toBe(true);
  });

  test('a 429 pauses every lane until Retry-After, and repeated 429s back off further', async () => {
    const { s, clock } = fake();
    const until = s.observe(429, new Headers({ 'Retry-After': '10' }));
    expect(until).toBe(clock.t + 10_000);
    expect(s.getStatus().pausedUntil).toBe(clock.t + 10_000);
    expect(s.getStatus().message).toContain('paused until');
    let ui = false;
    s.acquire('interactive').then((r) => ((ui = true), r()));
    await flush();
    expect(ui).toBe(false);
    clock.t += 10_001;
    s.pump();
    await flush();
    expect(ui).toBe(true);
    s.observe(429, new Headers({ 'Retry-After': '0' }));
    const second = s.observe(429, new Headers({ 'Retry-After': '0' }))!;
    expect(second - clock.t).toBeGreaterThanOrEqual(2000); // 2^2 s backoff on the third 429
  });

  test('a pause longer than the lane may wait rejects at once', async () => {
    const { s } = fake();
    s.observe(429, new Headers({ 'Retry-After': '600' }));
    await expect(s.acquire('interactive')).rejects.toBeInstanceOf(RateLimitedError);
    expect(s.getStatus().stats.rejected).toBe(1);
  });

  test('waiters past their deadline are rejected', async () => {
    const { s, clock } = fake({ plan: 'custom', perHour: 0, perMinute: 1 });
    (await s.acquire('interactive'))();
    const p = s.acquire('interactive');
    clock.t += 30_001; // interactive waits at most 30 s; only half a token has refilled at 1/min
    s.pump();
    await expect(p).rejects.toBeInstanceOf(RateLimitedError);
  });

  test('concurrency is capped and released slots are reused', async () => {
    const { s } = fake(undefined, 2);
    const releases: (() => void)[] = [];
    for (let i = 0; i < 3; i++) s.acquire('interactive').then((r) => releases.push(r));
    await flush();
    expect(releases).toHaveLength(2);
    expect(s.getStatus().queued.interactive).toBe(1);
    releases[0]();
    releases[0](); // a second release of the same slot is ignored
    await flush();
    expect(releases).toHaveLength(3);
    expect(s.getStatus().inFlight).toBe(2);
  });

  test('the lane comes from the async context', async () => {
    const { s } = fake();
    expect(s.currentLane()).toBe('interactive');
    const lane = await s.runInLane('background', async () => {
      await flush();
      return s.currentLane();
    });
    expect(lane).toBe('background');
  });

  test('resetRemoteState clears a pause from the previous account', () => {
    const { s } = fake();
    s.observe(429, new Headers({ 'Retry-After': '60' }));
    s.resetRemoteState();
    expect(s.getStatus().pausedUntil).toBeNull();
  });
});

describe('GitLabClient through the scheduler', () => {
  let server: ReturnType<typeof Bun.serve>;
  let hits: Record<string, number> = {};
  const savedTimeout = requestScheduler.timeoutMs;

  beforeAll(() => {
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(req) {
        const path = new URL(req.url).pathname.replace('/api/v4', '');
        hits[path] = (hits[path] ?? 0) + 1;
        if (path === '/user' && hits[path] === 1) return new Response('{"message":"429 Too Many Requests"}', { status: 429, headers: { 'Retry-After': '0' } });
        if (path === '/user') return Response.json({ id: 1, username: 'me', name: 'Me', avatar_url: '' }, { headers: { 'RateLimit-Limit': '2000', 'RateLimit-Remaining': '1999' } });
        if (path === '/slow') {
          await new Promise((r) => setTimeout(r, 500));
          return Response.json({});
        }
        if (path === '/projects/1/pipelines/2') return Response.json({ message: '404 Not found' }, { status: 404 });
        if (path === '/always429') return new Response('', { status: 429, headers: { 'Retry-After': '0' } });
        return Response.json({});
      }
    });
  });

  afterAll(() => {
    server.stop(true);
    requestScheduler.timeoutMs = savedTimeout;
    requestScheduler.resetRemoteState();
  });

  const client = () => new GitLabClient(`http://127.0.0.1:${server.port}`, 'glpat-test');

  test('a GET that gets a 429 waits for Retry-After and is retried once', async () => {
    hits = {};
    const user = await client().apiGet<{ username: string }>('/user');
    expect(user.username).toBe('me');
    expect(hits['/user']).toBe(2);
    expect(requestScheduler.getStatus().rateLimit.remaining).toBe(1999);
  });

  test('a second 429 surfaces as RateLimitedError', async () => {
    hits = {};
    await expect(client().apiGet('/always429')).rejects.toBeInstanceOf(RateLimitedError);
    expect(hits['/always429']).toBe(2);
    requestScheduler.resetRemoteState();
  });

  test('a request that exceeds the timeout fails with a timeout message', async () => {
    requestScheduler.timeoutMs = 100;
    try {
      await expect(client().apiGet('/slow')).rejects.toThrow(/timed out after/);
      expect(requestScheduler.getStatus().stats.timeouts).toBeGreaterThan(0);
    } finally {
      requestScheduler.timeoutMs = savedTimeout;
    }
  });

  test('API errors carry the HTTP status', async () => {
    const err = await client().getPipeline(1, 2).catch((e) => e);
    expect(err).toBeInstanceOf(GitLabApiError);
    expect(err.status).toBe(404);
    expect(err.message).toContain('404');
  });

  test('requests inside runInLane use that lane', async () => {
    const lane = await runInLane('watch', async () => {
      await client().apiGet('/anything');
      return requestScheduler.currentLane();
    });
    expect(lane).toBe('watch');
  });
});
