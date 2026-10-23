import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, renameSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { CacheDb, envInt } from '../server/cacheDb.ts';
import { readStoredTheme, storeTheme } from '../src/utils/theme.ts';

const freshDir = () => mkdtempSync(path.join(tmpdir(), 'lazylab-cache-'));

describe('cacheDb storage (bun:sqlite)', () => {
  test('rows persist across a reopen without a full export', async () => {
    const dir = freshDir();
    const a = new CacheDb({ dataDir: dir });
    await a.init();
    a.set('p:1', 'pipelines', '1', [{ id: 7 }], 'W/"e1"', 60_000);
    a.close();

    const b = new CacheDb({ dataDir: dir });
    await b.init();
    const hit = b.get<{ id: number }[]>('p:1');
    expect(hit?.data[0].id).toBe(7);
    expect(hit?.etag).toBe('W/"e1"');
    const probe = new Database(b.dbPath, { readonly: true });
    expect(probe.query<{ journal_mode: string }, []>('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
    probe.close();
    b.close();
  });

  test('opens a database written by the old sql.js engine and keeps its rows', async () => {
    const dir = freshDir();
    const c = new CacheDb({ dataDir: dir });
    // sql.js exported a plain rollback-journal SQLite file with this schema.
    const old = new Database(c.dbPath, { create: true });
    old.run('CREATE TABLE cache_store (key TEXT PRIMARY KEY, category TEXT, project_id TEXT, data TEXT, etag TEXT, updated_at INTEGER, expires_at INTEGER)');
    old.run('CREATE TABLE wal_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, operation TEXT, key TEXT, category TEXT, timestamp INTEGER, details TEXT)');
    old.run('INSERT INTO cache_store VALUES (?, ?, ?, ?, ?, ?, ?)', ['user:current', 'user', null, '{"username":"ada"}', null, Date.now(), Date.now() + 60_000]);
    old.run('INSERT INTO wal_logs (operation, key, category, timestamp) VALUES (?, ?, ?, ?)', ['SET', 'user:current', 'user', Date.now()]);
    old.close();

    await c.init();
    expect(c.get<{ username: string }>('user:current')?.data.username).toBe('ada');
    // The migrated journal row plus SYSTEM_INIT.
    expect(c.getStats().walEntriesCount).toBe(2);
    c.close();
  });

  test('moves an unreadable file aside and starts empty', async () => {
    const dir = freshDir();
    const c = new CacheDb({ dataDir: dir });
    writeFileSync(c.dbPath, 'this is not a sqlite database, only some bytes that are long enough to be read');
    await c.init();
    expect(c.get('anything', { allowStale: true })).toBeNull();
    c.set('k', 'test', null, 1);
    expect(c.get<number>('k')?.data).toBe(1);
    expect(readdirSync(dir).some((f) => f.includes('.corrupt-'))).toBe(true);
    c.close();
  });

  test('entries evicted from the memory LRU are re-read from SQLite', async () => {
    const c = new CacheDb({ dataDir: freshDir(), memoryEntries: 2 });
    await c.init();
    c.set('a', 'test', null, { n: 1 });
    c.set('b', 'test', null, { n: 2 });
    c.set('c', 'test', null, { n: 3 });
    expect(c.get<{ n: number }>('a')?.data.n).toBe(1);
    expect(c.getStats().totalEntries).toBe(3);
    c.clear('test');
    expect(c.get('a', { allowStale: true })).toBeNull();
    expect(c.getStats().totalEntries).toBe(0);
    c.close();
  });
});

describe('cacheDb journal bounds', () => {
  test('rotates the text journal past the size limit and keeps one previous file', async () => {
    const dir = freshDir();
    const c = new CacheDb({ dataDir: dir, journalMaxBytes: 2_000 });
    await c.init();
    for (let i = 0; i < 100; i++) c.logWal('TEST', `k${i}`, 'test', 'x'.repeat(40));
    expect(existsSync(`${c.walPath}.1`)).toBe(true);
    expect(statSync(c.walPath).size).toBeLessThanOrEqual(2_000);
    expect(statSync(`${c.walPath}.1`).size).toBeLessThanOrEqual(2_000);
    expect(readdirSync(dir).filter((f) => f.startsWith(path.basename(c.walPath))).length).toBe(2);
    c.close();
  });

  test('prunes wal_logs to the newest N rows', async () => {
    const c = new CacheDb({ dataDir: freshDir(), journalKeepRows: 50, journalKeepDays: 0 });
    await c.init();
    // 600 inserts cross the automatic prune threshold once.
    for (let i = 0; i < 600; i++) c.logWal('TEST', `k${i}`, 'test');
    c.pruneJournal();
    const stats = c.getStats();
    expect(stats.walEntriesCount).toBe(50);
    expect(stats.recentLogs[0].key).toBe('k599');
    c.close();
  });

  test('prunes wal_logs older than N days', async () => {
    const c = new CacheDb({ dataDir: freshDir(), journalKeepRows: 0, journalKeepDays: 7 });
    await c.init();
    c.logWal('TEST', 'old', 'test');
    expect(c.pruneJournal(Date.now() + 6 * 86_400_000)).toBe(0);
    expect(c.pruneJournal(Date.now() + 8 * 86_400_000)).toBeGreaterThan(0);
    expect(c.getStats().walEntriesCount).toBe(0);
    c.close();
  });

  test('re-caching an unchanged body extends the TTL without a journal entry', async () => {
    const c = new CacheDb({ dataDir: freshDir() });
    await c.init();
    c.set('p:1', 'pipelines', '1', [{ id: 1 }], undefined, 1);
    const before = c.getStats().walEntriesCount;
    await Bun.sleep(5);
    expect(c.get('p:1')).toBeNull();
    c.set('p:1', 'pipelines', '1', [{ id: 1 }], undefined, 60_000);
    expect(c.getStats().walEntriesCount).toBe(before);
    expect(c.get('p:1')?.stale).toBe(false);
    c.set('p:1', 'pipelines', '1', [{ id: 2 }], undefined, 60_000);
    expect(c.getStats().walEntriesCount).toBe(before + 1);
    c.close();
  });

  test('envInt falls back on unset or invalid values', () => {
    process.env.LAZYLAB_TEST_INT = '12';
    expect(envInt('LAZYLAB_TEST_INT', 3)).toBe(12);
    process.env.LAZYLAB_TEST_INT = '-1';
    expect(envInt('LAZYLAB_TEST_INT', 3)).toBe(3);
    process.env.LAZYLAB_TEST_INT = 'lots';
    expect(envInt('LAZYLAB_TEST_INT', 3)).toBe(3);
    delete process.env.LAZYLAB_TEST_INT;
    expect(envInt('LAZYLAB_TEST_INT', 3)).toBe(3);
  });
});

describe('labwi file migration', () => {
  test('moves labwi_cache.* to the lazylab names once and keeps the rows', async () => {
    const dir = freshDir();
    const legacy = new CacheDb({ dataDir: dir, sweepIntervalMs: 0 });
    await legacy.init();
    legacy.set('user:current', 'user', null, { username: 'ada' }, undefined, 60_000);
    legacy.close();
    // Recreate the pre-rename layout from the files just written.
    renameSync(legacy.dbPath, path.join(dir, 'labwi_cache.sqlite'));
    for (const s of ['-wal', '-shm']) if (existsSync(legacy.dbPath + s)) renameSync(legacy.dbPath + s, path.join(dir, `labwi_cache.sqlite${s}`));
    renameSync(legacy.walPath, path.join(dir, 'labwi_cache.wal'));
    writeFileSync(path.join(dir, 'labwi_cache.wal.1'), '{}\n');

    const c = new CacheDb({ dataDir: dir, sweepIntervalMs: 0 });
    await c.init();
    expect(path.basename(c.dbPath)).toBe('lazylab_cache.sqlite');
    expect(c.get<{ username: string }>('user:current')?.data.username).toBe('ada');
    expect(existsSync(`${c.walPath}.1`)).toBe(true);
    expect(readdirSync(dir).filter((f) => f.startsWith('labwi_'))).toEqual([]);
    c.close();
  });

  test('leaves legacy files alone when the new files exist', async () => {
    const dir = freshDir();
    const c = new CacheDb({ dataDir: dir, sweepIntervalMs: 0 });
    await c.init();
    c.close();
    writeFileSync(path.join(dir, 'labwi_cache.wal'), '{}\n');
    await c.init();
    expect(existsSync(path.join(dir, 'labwi_cache.wal'))).toBe(true);
    c.close();
  });
});

describe('theme storage', () => {
  const memoryStorage = (init: Record<string, string> = {}) => {
    const m = new Map(Object.entries(init));
    return {
      map: m,
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k)
    };
  };

  test('moves labwi_theme to lazylab_theme', () => {
    const s = memoryStorage({ labwi_theme: 'light' });
    expect(readStoredTheme(s)).toBe('light');
    expect(s.map.get('lazylab_theme')).toBe('light');
    expect(s.map.has('labwi_theme')).toBe(false);
  });

  test('prefers the current key and defaults to dark', () => {
    expect(readStoredTheme(memoryStorage({ lazylab_theme: 'light', labwi_theme: 'dark' }))).toBe('light');
    expect(readStoredTheme(memoryStorage({ labwi_theme: 'purple' }))).toBe('dark');
    const s = memoryStorage();
    storeTheme('light', s);
    expect(readStoredTheme(s)).toBe('light');
  });
});

describe('cacheDb retention', () => {
  const HOUR = 3_600_000;
  const open = async (opts: ConstructorParameters<typeof CacheDb>[0] = {}) => {
    const c = new CacheDb({ dataDir: freshDir(), sweepIntervalMs: 0, ...opts });
    await c.init();
    return c;
  };

  test('keeps expired rows for the stale grace period, then deletes them', async () => {
    const c = await open({ staleKeepHours: 24 });
    c.set('old', 'test', null, 1, undefined, 1);
    c.set('fresh', 'test', null, 2, undefined, 60_000);
    await Bun.sleep(5);
    expect(c.sweep().expired).toBe(0);
    expect(c.get('old', { allowStale: true })?.stale).toBe(true);
    expect(c.sweep(Date.now() + 25 * HOUR).expired).toBe(2);
    expect(c.get('old', { allowStale: true })).toBeNull();
    c.close();
  });

  test('a membership refresh evicts expired rows of projects that left the list', async () => {
    const c = await open();
    c.set('pipelines:1', 'pipelines', '1', [{ id: 1 }], undefined, 1);
    c.set('pipelines:2', 'pipelines', '2', [{ id: 2 }], undefined, 1);
    c.set('pipelines:3', 'pipelines', '3', [{ id: 3 }], undefined, 60_000);
    await Bun.sleep(5);
    c.set('projects:list', 'projects', null, [{ id: 1 }], undefined, 60_000);
    // Project 1 is a member; project 3 is fresh and waits for its TTL.
    expect(c.get('pipelines:1', { allowStale: true })).not.toBeNull();
    expect(c.get('pipelines:2', { allowStale: true })).toBeNull();
    expect(c.get('pipelines:3')).not.toBeNull();
    expect(c.getStats().recentLogs.some((l) => l.operation === 'EVICT')).toBe(true);
    c.close();
  });

  test('caps the row count, dropping the least recently written rows', async () => {
    const c = await open({ maxRows: 3 });
    for (let i = 0; i < 5; i++) {
      c.set(`k${i}`, 'test', null, i);
      await Bun.sleep(2);
    }
    expect(c.sweep().overCap).toBe(2);
    expect(c.get('k0')).toBeNull();
    expect(c.get('k1')).toBeNull();
    expect(c.get<number>('k4')?.data).toBe(4);
    expect(c.getStats().totalEntries).toBe(3);
    c.close();
  });

  test('caps the stored size', async () => {
    const c = await open({ maxRows: 0, maxMegabytes: 1 });
    const blob = 'x'.repeat(400 * 1024);
    for (let i = 0; i < 4; i++) {
      c.set(`b${i}`, 'test', null, blob);
      await Bun.sleep(2);
    }
    expect(c.sweep().overCap).toBe(2);
    expect(c.get('b0')).toBeNull();
    expect(c.get('b3')).not.toBeNull();
    c.close();
  });

  test('a full purge removes every row and survives a reopen', async () => {
    const dir = freshDir();
    const c = new CacheDb({ dataDir: dir, sweepIntervalMs: 0 });
    await c.init();
    c.set('secret-issue', 'work_items', '9', [{ title: 'private' }]);
    c.clear();
    c.close();
    const d = new CacheDb({ dataDir: dir, sweepIntervalMs: 0 });
    await d.init();
    expect(d.get('secret-issue', { allowStale: true })).toBeNull();
    expect(d.getStats().totalEntries).toBe(0);
    d.close();
  });
});
