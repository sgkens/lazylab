import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { GitLabApiError, GitLabClient } from '../server/gitlabClient.ts';
import { getSettings, resetSettingsCache, updateSettings } from '../server/settings.ts';
import { vault } from '../server/vault.ts';
import { adaptivePollMs, parseWatchPollInterval, watchManager } from '../server/watch.ts';

let now = Date.now();
let calls = 0;
let answer: Error | { status: string; created_at: string };
let clock: ReturnType<typeof spyOn>;
const missing = () => new GitLabApiError('Missing', 404, '/projects/1/pipelines/2');
const running = (age = 0) => ({ status: 'running', created_at: new Date(now - age).toISOString() });
const fakeClient = { getPipeline: async () => { calls++; if (answer instanceof Error) throw answer; return answer; } } as unknown as GitLabClient;

beforeAll(async () => {
  if (!vault.isInitialized()) await vault.initialize('tester', 'correct horse battery');
});
beforeEach(() => {
  watchManager.reset();
  vault.updateNotify((n) => { n.watches = [{ id: 'poll-test', kind: 'pipeline', project_id: 1, target_id: 2, source: 'manual', label: 'Test', web_url: '', createdAt: new Date(now).toISOString(), profileId: vault.getActiveProfile()?.id ?? null }]; });
  watchManager.attach(() => fakeClient);
  watchManager.setPollInterval(15);
  calls = 0;
  clock = spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
  clock.mockRestore();
  watchManager.reset();
  vault.updateNotify((n) => { n.watches = []; });
});
const poll = async () => { now += 15_000; await watchManager.pollAll(); };

describe('watch polling', () => {
  test('only two consecutive typed 404 responses remove the watch', async () => {
    answer = missing();
    await poll();
    expect(watchManager.listWatches()).toHaveLength(1);
    await poll();
    expect(watchManager.listWatches()).toHaveLength(0);
    expect(watchManager.listNotifications().map((n) => n.title)).toEqual(['Watch removed']);
  });

  test('network, auth, rate limit and textual not-found errors retain the watch and reset the count', async () => {
    for (const err of [new Error('404 not found'), new GitLabApiError('Denied', 403, '/test'), new GitLabApiError('Unauthorized', 401, '/test'), new GitLabApiError('Limited', 429, '/test'), new Error('Network timeout')]) {
      answer = missing(); await poll();
      answer = err; await poll();
      answer = missing(); await poll();
      expect(watchManager.listWatches()).toHaveLength(1);
      answer = running(); await poll();
    }
    expect(watchManager.listNotifications()).toHaveLength(0);
  });

  test('success resets a missing response and clears its error', async () => {
    answer = missing(); await poll();
    answer = running(); await poll();
    expect(watchManager.listWatches()[0].error).toBeUndefined();
    answer = missing(); await poll();
    expect(watchManager.listWatches()).toHaveLength(1);
  });

  test('old pipelines wait for their own adaptive due time', async () => {
    answer = running(3 * 3_600_000);
    await watchManager.pollAll();
    expect(calls).toBe(1);
    expect(watchManager.listWatches()[0].nextCheckAt).toBe(now + 120_000);
    await poll();
    expect(calls).toBe(1);
    now += 105_000;
    await watchManager.pollAll();
    expect(calls).toBe(2);
    watchManager.setPollInterval(10);
    expect(watchManager.listWatches()[0].nextCheckAt).toBe(now + 80_000);
  });

  test('interval validation rejects invalid values and stored settings reload', () => {
    expect(parseWatchPollInterval('10')).toBe(10);
    expect(parseWatchPollInterval(300)).toBe(300);
    for (const bad of [0, 9, 301, 10.1, '', null, true, {}, Infinity, NaN]) expect(() => parseWatchPollInterval(bad)).toThrow();
    const saved = getSettings().watchPollSec;
    updateSettings({ watchPollSec: 60 });
    resetSettingsCache();
    expect(getSettings().watchPollSec).toBe(60);
    updateSettings({ watchPollSec: saved });
  });

  test('age thresholds and cap are bounded', () => {
    expect(adaptivePollMs(15_000, 0)).toBe(15_000);
    expect(adaptivePollMs(15_000, 10 * 60_000)).toBe(30_000);
    expect(adaptivePollMs(15_000, 30 * 60_000)).toBe(60_000);
    expect(adaptivePollMs(15_000, 2 * 3_600_000)).toBe(120_000);
    expect(adaptivePollMs(300_000, 2 * 3_600_000)).toBe(600_000);
  });
});


test('watch interval API validates before saving or changing the live interval', async () => {
  const express = (await import('express')).default;
  const { apiRouter } = await import('../server/apiRouter.ts');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = await new Promise<import('http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as import('net').AddressInfo;
  const post = (body: unknown) => fetch(`http://127.0.0.1:${port}/api/config/watch-poll`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  try {
    for (const body of [{}, { intervalSec: 0 }, { intervalSec: 301 }, { intervalSec: 'fast' }]) {
      expect((await post(body)).status).toBe(400);
      expect(watchManager.getPollIntervalSec()).toBe(15);
    }
    const response = await post({ intervalSec: 60 });
    expect(response.status).toBe(200);
    expect((await response.json()).watchPollSec).toBe(60);
    resetSettingsCache();
    expect(getSettings().watchPollSec).toBe(60);
    expect(watchManager.getPollIntervalSec()).toBe(60);
  } finally {
    server.close();
    updateSettings({ watchPollSec: 15 });
  }
});
