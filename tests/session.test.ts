// Sessions and apiGuard over HTTP: cookies, expiry, Origin checks, bearer tokens and login throttling.
import { afterAll, afterEach, beforeAll, describe, expect, setSystemTime, test } from 'bun:test';
import express from 'express';
import type { Server } from 'http';
import { apiGuard, LoginThrottle, sessionRouter } from '../server/session.ts';
import { vault } from '../server/vault.ts';

const USER = 'tester';
const PASSWORD = 'correct horse battery';
const HOUR = 60 * 60 * 1000;

let server: Server;
let base: string;
let ipCounter = 1;
/** Each test logs in from its own client address so throttle state never leaks between tests. */
const freshIp = () => `10.0.0.${ipCounter++}`;

beforeAll(async () => {
  if (!vault.isInitialized()) await vault.initialize(USER, PASSWORD);
  if (!vault.isUnlocked()) await vault.verifyAndUnlock(USER, PASSWORD);
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use('/api/session', sessionRouter);
  app.use('/api', apiGuard);
  app.all('/api/ping', (_req, res) => res.json({ success: true }));
  app.all('/api/agent/ping', (_req, res) => res.json({ success: true }));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});

afterAll(async () => {
  server.close();
  // Other test files share the vault singleton and expect it open.
  if (!vault.isUnlocked()) await vault.verifyAndUnlock(USER, PASSWORD);
});

afterEach(() => setSystemTime());

interface Client {
  ip: string;
  cookie: string | null;
  call(method: string, path: string, opts?: { body?: unknown; origin?: string | null; headers?: Record<string, string> }): Promise<Response>;
}

function client(ip = freshIp()): Client {
  const c: Client = {
    ip,
    cookie: null,
    async call(method, path, opts = {}) {
      const headers: Record<string, string> = { 'X-Forwarded-For': ip, ...opts.headers };
      if (opts.origin !== null) headers.Origin = opts.origin ?? base;
      if (c.cookie) headers.Cookie = c.cookie;
      if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
      const set = res.headers.get('set-cookie');
      if (set) c.cookie = set.split(';')[0].endsWith('=') ? null : set.split(';')[0];
      return res;
    }
  };
  return c;
}

async function loggedIn(): Promise<Client> {
  const c = client();
  const res = await c.call('POST', '/api/session/login', { body: { username: USER, password: PASSWORD } });
  expect(res.status).toBe(200);
  expect(c.cookie).toStartWith('lazylab_sid=');
  return c;
}

describe('session cookie', () => {
  test('is HttpOnly and SameSite=Strict, without Secure over plain HTTP', async () => {
    const c = client();
    const res = await c.call('POST', '/api/session/login', { body: { username: USER, password: PASSWORD } });
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('Secure');
  });

  test('is Secure when a trusted proxy reports HTTPS', async () => {
    const c = client();
    const res = await c.call('POST', '/api/session/login', {
      body: { username: USER, password: PASSWORD },
      headers: { 'X-Forwarded-Proto': 'https' }
    });
    expect(res.headers.get('set-cookie')).toContain('Secure');
  });
});

describe('apiGuard', () => {
  test('rejects requests without a session', async () => {
    const c = client();
    const res = await c.call('GET', '/api/ping');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ success: false, locked: false });
  });

  test('rejects an unknown session id', async () => {
    const c = client();
    c.cookie = 'lazylab_sid=not-a-real-session';
    expect((await c.call('GET', '/api/ping')).status).toBe(401);
  });

  test('accepts a valid session', async () => {
    const c = await loggedIn();
    expect((await c.call('GET', '/api/ping')).status).toBe(200);
    expect((await c.call('POST', '/api/ping')).status).toBe(200);
  });

  test('expires a session after 12 hours idle', async () => {
    const c = await loggedIn();
    const start = Date.now();
    setSystemTime(new Date(start + 11 * HOUR));
    expect((await c.call('GET', '/api/ping')).status).toBe(200);
    // Activity resets the idle timer.
    setSystemTime(new Date(start + 22 * HOUR));
    expect((await c.call('GET', '/api/ping')).status).toBe(200);
    setSystemTime(new Date(start + 34 * HOUR + 1000));
    expect((await c.call('GET', '/api/ping')).status).toBe(401);
  });

  test('expires a session 7 days after login even when active', async () => {
    const c = await loggedIn();
    const start = Date.now();
    for (let h = 10; h < 7 * 24; h += 10) {
      setSystemTime(new Date(start + h * HOUR));
      expect((await c.call('GET', '/api/ping')).status).toBe(200);
    }
    setSystemTime(new Date(start + 7 * 24 * HOUR + 1000));
    expect((await c.call('GET', '/api/ping')).status).toBe(401);
  });

  test('locking the vault ends every session', async () => {
    const a = await loggedIn();
    const b = await loggedIn();
    expect((await a.call('POST', '/api/session/lock')).status).toBe(200);
    expect(vault.isUnlocked()).toBe(false);
    const res = await b.call('GET', '/api/ping');
    expect(res.status).toBe(401);
    expect((await res.json()).locked).toBe(true);
    await vault.verifyAndUnlock(USER, PASSWORD);
    // The old session does not come back after the vault is unlocked again.
    expect((await b.call('GET', '/api/ping')).status).toBe(401);
  });

  test('logout ends only that session', async () => {
    const a = await loggedIn();
    const b = await loggedIn();
    const cookieA = a.cookie;
    expect((await a.call('POST', '/api/session/logout')).status).toBe(200);
    a.cookie = cookieA;
    expect((await a.call('GET', '/api/ping')).status).toBe(401);
    expect((await b.call('GET', '/api/ping')).status).toBe(200);
  });
});

describe('Origin checks', () => {
  test('mutating requests need a matching Origin; reads do not', async () => {
    const c = await loggedIn();
    expect((await c.call('POST', '/api/ping', { origin: null })).status).toBe(403);
    expect((await c.call('DELETE', '/api/ping', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await c.call('PUT', '/api/ping', { origin: 'null' })).status).toBe(403);
    expect((await c.call('PATCH', '/api/ping', { origin: 'http://127.0.0.1.evil.example' })).status).toBe(403);
    expect((await c.call('POST', '/api/ping', { origin: base })).status).toBe(200);
    expect((await c.call('GET', '/api/ping', { origin: null })).status).toBe(200);
  });

  test('falls back to Referer when Origin is absent', async () => {
    const c = await loggedIn();
    expect((await c.call('POST', '/api/ping', { origin: null, headers: { Referer: `${base}/vault` } })).status).toBe(200);
    expect((await c.call('POST', '/api/ping', { origin: null, headers: { Referer: 'https://evil.example/' } })).status).toBe(403);
  });

  test('session routes reject cross-origin login and lock', async () => {
    const c = client();
    expect((await c.call('POST', '/api/session/login', { origin: 'https://evil.example', body: { username: USER, password: PASSWORD } })).status).toBe(403);
    expect(c.cookie).toBeNull();
    const d = await loggedIn();
    expect((await d.call('POST', '/api/session/lock', { origin: 'https://evil.example' })).status).toBe(403);
    expect(vault.isUnlocked()).toBe(true);
  });
});

describe('agent bearer tokens', () => {
  test('are accepted on /api/agent/* only', async () => {
    const { token, record } = vault.createAgentToken('session-test');
    try {
      const c = client();
      const auth = { Authorization: `Bearer ${token}` };
      expect((await c.call('GET', '/api/agent/ping', { headers: auth })).status).toBe(200);
      expect((await c.call('GET', '/api/ping', { headers: auth })).status).toBe(401);
      expect((await c.call('GET', '/api/agent/ping', { headers: { Authorization: 'Bearer llab_wrong' } })).status).toBe(401);
    } finally {
      vault.deleteAgentToken(record.id);
    }
  });

  test('get 423 while the vault is locked', async () => {
    const { token, record } = vault.createAgentToken('session-test-locked');
    try {
      vault.lock();
      const res = await client().call('GET', '/api/agent/ping', { headers: { Authorization: `Bearer ${token}` } });
      expect(res.status).toBe(423);
    } finally {
      if (!vault.isUnlocked()) await vault.verifyAndUnlock(USER, PASSWORD);
      vault.deleteAgentToken(record.id);
    }
  });
});

describe('login', () => {
  test('rejects bad credentials and malformed bodies', async () => {
    const c = client();
    expect((await c.call('POST', '/api/session/login', { body: { username: USER, password: 'wrong-password' } })).status).toBe(401);
    expect((await c.call('POST', '/api/session/login', { body: { username: 'nobody', password: PASSWORD } })).status).toBe(401);
    expect((await c.call('POST', '/api/session/login', { body: { username: USER } })).status).toBe(400);
    expect((await c.call('POST', '/api/session/login', { body: { username: 'testeñ', password: PASSWORD } })).status).toBe(401);
    expect(c.cookie).toBeNull();
  });

  test('throttles an address after four failures, per address', async () => {
    const c = client();
    for (let i = 0; i < 4; i++) {
      expect((await c.call('POST', '/api/session/login', { body: { username: USER, password: 'wrong-password' } })).status).toBe(401);
    }
    // The fifth failure starts a 2 s back-off.
    expect((await c.call('POST', '/api/session/login', { body: { username: USER, password: 'wrong-password' } })).status).toBe(401);
    const blocked = await c.call('POST', '/api/session/login', { body: { username: USER, password: PASSWORD } });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(c.cookie).toBeNull();

    // Another address is unaffected.
    await loggedIn();

    // After the back-off a correct password works and clears the counter.
    setSystemTime(new Date(Date.now() + 3000));
    expect((await c.call('POST', '/api/session/login', { body: { username: USER, password: PASSWORD } })).status).toBe(200);
    expect((await c.call('POST', '/api/session/login', { body: { username: USER, password: 'wrong-password' } })).status).toBe(401);
    expect((await c.call('POST', '/api/session/login', { body: { username: USER, password: PASSWORD } })).status).toBe(200);
  });

  test('state reports authentication without leaking the username to anonymous callers', async () => {
    const anon = await (await client().call('GET', '/api/session/state')).json();
    expect(anon).toMatchObject({ authenticated: false, username: null, setupRequired: false });
    const c = await loggedIn();
    const state = await (await c.call('GET', '/api/session/state')).json();
    expect(state).toMatchObject({ authenticated: true, username: USER, vaultUnlocked: true });
  });

  test('setup is refused once the vault exists', async () => {
    const res = await client().call('POST', '/api/session/setup', { body: { setupCode: 'X', username: 'abc', password: 'x'.repeat(12) } });
    expect(res.status).toBe(409);
  });
});

describe('LoginThrottle', () => {
  const make = (maxEntries = 100) => {
    let now = 1_000_000;
    const t = new LoginThrottle({ freeAttempts: 4, maxDelayMs: 15 * 60 * 1000, resetAfterMs: HOUR, maxEntries, now: () => now });
    return { t, advance: (ms: number) => (now += ms) };
  };

  test('backs off exponentially after the free attempts, capped at 15 minutes', () => {
    const { t } = make();
    for (let i = 0; i < 4; i++) t.recordFailure('a');
    expect(t.delayMs('a')).toBe(0);
    t.recordFailure('a');
    expect(t.delayMs('a')).toBe(2000);
    t.recordFailure('a');
    expect(t.delayMs('a')).toBe(4000);
    for (let i = 0; i < 100; i++) t.recordFailure('a');
    expect(t.delayMs('a')).toBe(15 * 60 * 1000);
  });

  test('forgets an address after an hour without failures', () => {
    const { t, advance } = make();
    for (let i = 0; i < 20; i++) t.recordFailure('a');
    advance(HOUR + 1);
    expect(t.delayMs('a')).toBe(0);
    expect(t.size).toBe(0);
    // The count starts again from zero: the next failure is free.
    t.recordFailure('a');
    expect(t.delayMs('a')).toBe(0);
  });

  test('sweeps quiet addresses when recording a new failure', () => {
    const { t, advance } = make();
    for (let i = 0; i < 50; i++) t.recordFailure(`old-${i}`);
    advance(HOUR + 61_000);
    t.recordFailure('new');
    expect(t.size).toBe(1);
  });

  test('never tracks more than maxEntries addresses, evicting the least recently failing', () => {
    const { t, advance } = make(10);
    for (let i = 0; i < 5; i++) t.recordFailure('attacker');
    for (let i = 0; i < 25; i++) {
      advance(10);
      t.recordFailure(`spray-${i}`);
      // Keep the attacker the most recent so it survives eviction.
      t.recordFailure('attacker');
    }
    expect(t.size).toBe(10);
    expect(t.delayMs('attacker')).toBeGreaterThan(0);
    expect(t.delayMs('spray-0')).toBe(0);
  });

  test('clear resets one address only', () => {
    const { t } = make();
    for (let i = 0; i < 6; i++) { t.recordFailure('a'); t.recordFailure('b'); }
    t.clear('a');
    expect(t.delayMs('a')).toBe(0);
    expect(t.delayMs('b')).toBeGreaterThan(0);
  });
});

describe('password change', () => {
  test('wrong current passwords count towards the sign-in throttle', async () => {
    const c = await loggedIn();
    for (let i = 0; i < 5; i++) {
      const res = await c.call('POST', '/api/session/password', { body: { currentPassword: 'wrong-password', newPassword: 'another-long-password' } });
      expect(res.status).toBe(401);
    }
    const blocked = await c.call('POST', '/api/session/password', { body: { currentPassword: PASSWORD, newPassword: 'another-long-password' } });
    expect(blocked.status).toBe(429);
    // The password is unchanged.
    expect(await vault.verifyAndUnlock(USER, PASSWORD)).toBe(true);
  });
});
