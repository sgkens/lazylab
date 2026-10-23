import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { CacheDb, envInt } from '../server/cacheDb.ts';

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
