import { describe, expect, test } from 'bun:test';
import { readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { AutoFetchLoop, clampAutoFetchInterval, parseAutoFetchInterval } from '../server/autoFetch.ts';
import { getSettings, resetSettingsCache, updateSettings } from '../server/settings.ts';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('parseAutoFetchInterval', () => {
  test('accepts 0 and whole seconds from 30 to 3600, as numbers or numeric strings', () => {
    expect(parseAutoFetchInterval(0)).toBe(0);
    expect(parseAutoFetchInterval(30)).toBe(30);
    expect(parseAutoFetchInterval('120')).toBe(120);
    expect(parseAutoFetchInterval(3600)).toBe(3600);
  });

  test('rejects values below the 30 s minimum, above the maximum, fractions and non-numbers', () => {
    for (const bad of [1, 15, 29, 3601, -30, 45.5, 'abc', '', null, undefined, {}, NaN, Infinity]) {
      expect(() => parseAutoFetchInterval(bad)).toThrow();
    }
  });

  test('clamp brings hand-edited values into range', () => {
    expect(clampAutoFetchInterval(1)).toBe(30);
    expect(clampAutoFetchInterval(0)).toBe(0);
    expect(clampAutoFetchInterval(99999)).toBe(3600);
    expect(clampAutoFetchInterval('junk')).toBe(30);
    expect(clampAutoFetchInterval(-5)).toBe(30);
  });
});

describe('AutoFetchLoop', () => {
  test('a second run while one is in flight joins it instead of starting another cycle', async () => {
    const gate = deferred();
    let calls = 0;
    const loop = new AutoFetchLoop(async () => {
      calls++;
      await gate.promise;
    }, 30);
    const a = loop.run();
    const b = loop.run();
    expect(a).toBe(b);
    expect(loop.isRunning()).toBe(true);
    gate.resolve();
    await a;
    expect(calls).toBe(1);
    expect(loop.getStatus().skippedCycles).toBe(1);
    expect(loop.isRunning()).toBe(false);
  });

  test('a rerun request during a cycle runs exactly one more cycle afterwards', async () => {
    let calls = 0;
    let gate = deferred();
    const loop = new AutoFetchLoop(async () => {
      calls++;
      await gate.promise;
    }, 30);
    loop.start();
    const first = loop.run();
    loop.run({ rerun: true });
    loop.run({ rerun: true });
    const firstGate = gate;
    gate = deferred();
    firstGate.resolve();
    await first;
    await tick();
    expect(calls).toBe(2);
    expect(loop.isRunning()).toBe(true);
    gate.resolve();
    await tick();
    await tick();
    expect(calls).toBe(2);
    loop.stop();
  });

  test('a failing cycle does not break the loop and the next run starts normally', async () => {
    let calls = 0;
    const loop = new AutoFetchLoop(async () => {
      calls++;
      if (calls === 1) throw new Error('boom');
    }, 30);
    await loop.run();
    await loop.run();
    expect(calls).toBe(2);
    expect(loop.getStatus().lastDurationMs).not.toBeNull();
  });

  test('the next cycle is scheduled only while enabled and after the current one ends', async () => {
    const gate = deferred();
    const loop = new AutoFetchLoop(() => gate.promise, 60);
    loop.start();
    expect(loop.getStatus().nextRunAt).not.toBeNull();
    const run = loop.run();
    expect(loop.getStatus().nextRunAt).toBeNull();
    gate.resolve();
    await run;
    expect(loop.getStatus().nextRunAt).not.toBeNull();
    loop.stop();
    expect(loop.getStatus().nextRunAt).toBeNull();
    loop.setInterval(0);
    loop.start();
    expect(loop.getStatus().nextRunAt).toBeNull();
    loop.stop();
  });

  test('a constructor interval below the minimum is clamped', () => {
    expect(new AutoFetchLoop(async () => {}, 5).getInterval()).toBe(30);
  });
});

describe('settings', () => {
  test('the interval persists to settings.json and reloads', () => {
    updateSettings({ autoFetchIntervalSec: 120 });
    resetSettingsCache();
    expect(getSettings().autoFetchIntervalSec).toBe(120);
    const file = path.join(process.env.LAZYLAB_DATA_DIR!, 'settings.json');
    expect(JSON.parse(readFileSync(file, 'utf-8')).autoFetchIntervalSec).toBe(120);
  });

  test('a corrupt settings file falls back to defaults', () => {
    const file = path.join(process.env.LAZYLAB_DATA_DIR!, 'settings.json');
    writeFileSync(file, '{not json');
    resetSettingsCache();
    expect(getSettings().autoFetchIntervalSec).toBe(30);
    rmSync(file, { force: true });
    resetSettingsCache();
  });
});

describe('POST /api/config/autofetch', () => {
  test('validates, applies and persists the interval', async () => {
    const express = (await import('express')).default;
    const { apiRouter } = await import('../server/apiRouter.ts');
    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    const server = await new Promise<import('http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const { port } = server.address() as import('net').AddressInfo;
    const post = (body: unknown) =>
      fetch(`http://127.0.0.1:${port}/api/config/autofetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    try {
      expect((await post({ intervalSec: 5 })).status).toBe(400);
      expect((await post({ intervalSec: 'fast' })).status).toBe(400);
      expect((await post({})).status).toBe(400);
      const ok = await post({ intervalSec: 90 });
      expect(ok.status).toBe(200);
      expect((await ok.json()).autoFetchIntervalSec).toBe(90);
      resetSettingsCache();
      expect(getSettings().autoFetchIntervalSec).toBe(90);
      const off = await post({ intervalSec: 0 });
      expect((await off.json()).autoFetchIntervalSec).toBe(0);
    } finally {
      server.close();
      rmSync(path.join(process.env.LAZYLAB_DATA_DIR!, 'settings.json'), { force: true });
      resetSettingsCache();
    }
  });
});
