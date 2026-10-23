import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { CacheDb } from '../server/cacheDb.ts';

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
