import { beforeAll, describe, expect, test } from 'bun:test';
import { GitLabClient } from '../server/gitlabClient.ts';
import { cacheDb } from '../server/cacheDb.ts';
import { vault } from '../server/vault.ts';
import { daysLeft, describeExpiry, dueWarnings, thresholdFor, TokenExpiryMonitor, TrackedToken } from '../server/tokenExpiry.ts';

const NOW = Date.parse('2026-10-17T10:00:00Z');
const tok = (key: string, days: number | null): TrackedToken => ({
  key, kind: 'project', name: key, owner: 'group/app', host: 'https://gitlab.example', expires_at: null, days_left: days, scopes: ['api']
});

describe('daysLeft', () => {
  test('counts calendar days in UTC; expires_at today means already revoked', () => {
    expect(daysLeft('2026-10-17', NOW)).toBe(0);
    expect(daysLeft('2026-10-16', NOW)).toBe(-1);
    expect(daysLeft('2026-10-18', NOW)).toBe(1);
    expect(daysLeft('2026-10-31', NOW)).toBe(14);
    expect(daysLeft('2026-10-22T00:00:00.000Z', NOW)).toBe(5);
    expect(daysLeft(null, NOW)).toBeNull();
    expect(daysLeft('not a date', NOW)).toBeNull();
  });
});

describe('thresholdFor', () => {
  test('picks the tightest threshold reached', () => {
    expect(thresholdFor(30)).toBeNull();
    expect(thresholdFor(14)).toBe(14);
    expect(thresholdFor(8)).toBe(14);
    expect(thresholdFor(7)).toBe(7);
    expect(thresholdFor(2)).toBe(3);
    expect(thresholdFor(1)).toBe(1);
    expect(thresholdFor(0)).toBe(0);
    expect(thresholdFor(-5)).toBe(0);
    expect(thresholdFor(null)).toBeNull();
  });
});

describe('dueWarnings', () => {
  test('warns once per threshold and again only when a tighter one is crossed', () => {
    const tokens = [tok('a', 10), tok('b', 5), tok('c', 40), tok('d', null)];
    expect(dueWarnings(tokens, {}).map((d) => [d.token.key, d.threshold])).toEqual([['a', 14], ['b', 7]]);
    expect(dueWarnings(tokens, { a: 14, b: 7 })).toEqual([]);
    expect(dueWarnings([tok('a', 6)], { a: 14 }).map((d) => d.threshold)).toEqual([7]);
  });
});

describe('describeExpiry', () => {
  test('reads naturally', () => {
    expect(describeExpiry(null)).toBe('never expires');
    expect(describeExpiry(-1)).toBe('expired 1 day ago');
    expect(describeExpiry(0)).toBe('expired today');
    expect(describeExpiry(1)).toBe('expires tonight (00:00 UTC)');
    expect(describeExpiry(2)).toBe('expires in 2 days');
    expect(describeExpiry(9)).toBe('expires in 9 days');
  });
});

describe('TokenExpiryMonitor', () => {
  beforeAll(async () => {
    await cacheDb.init();
    if (!vault.isInitialized()) await vault.initialize('tester', 'correct horse battery');
  });

  const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
  /** A live-looking client with one project token expiring in 5 days. */
  const liveStub = () =>
    ({
      isDemo: () => false,
      getResourceTokens: async () => ({
        tokens: [{ key: 'project:stub:5:1', kind: 'project', name: 'release-bot', owner: 'team/app', host: 'https://gitlab.example', expires_at: inDays(5), scopes: ['api'] }],
        errors: []
      })
    }) as unknown as GitLabClient;

  test('warns once and remembers it in the vault', async () => {
    const sent: { title: string; level: string }[] = [];
    const monitor = new TokenExpiryMonitor(liveStub, (n) => sent.push(n));
    const first = await monitor.check();
    expect(first.tokens[0].days_left).toBe(5);
    expect(sent.map((n) => n.title)).toEqual(['GitLab token expires in 5 days']);
    await monitor.check();
    expect(sent.length).toBe(1);
    expect(Object.keys(vault.getNotify().expiryWarned ?? {})).toContain('project:stub:5:1');
  });

  test('lists demo tokens but never warns about them', async () => {
    vault.updateNotify((n) => void (n.expiryWarned = {}));
    const sent: unknown[] = [];
    const overview = await new TokenExpiryMonitor(() => new GitLabClient(), (n) => sent.push(n)).check();
    expect(overview.tokens.some((t) => t.name === 'release-bot')).toBe(true);
    expect(sent).toEqual([]);
  });

  test('sends nothing when the rule is off', async () => {
    vault.updateNotify((n) => {
      n.rules.tokenExpiry = false;
      n.expiryWarned = {};
    });
    const sent: unknown[] = [];
    await new TokenExpiryMonitor(liveStub, (n) => sent.push(n)).check();
    expect(sent).toEqual([]);
    vault.updateNotify((n) => void (n.rules.tokenExpiry = true));
  });
});
