import { Database, type Statement } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';

export interface CacheEntry<T = any> {
  key: string;
  category: string;
  projectId: string | null;
  data: T;
  etag?: string;
  updatedAt: number;
  expiresAt: number;
}

export interface WalLog {
  id: number;
  operation: string;
  key: string;
  category: string;
  timestamp: number;
  details?: string;
}

export interface CacheDbOptions {
  /** Directory for the SQLite file and the text journal. Defaults to LAZYLAB_DATA_DIR or ./.data. */
  dataDir?: string;
  /** Parsed entries kept in memory; older ones are re-read from SQLite on demand. */
  memoryEntries?: number;
}

interface CacheRow {
  key: string;
  category: string;
  project_id: string | null;
  data: string;
  etag: string | null;
  updated_at: number;
  expires_at: number;
}

const DEFAULT_MEMORY_ENTRIES = 256;

/**
 * GitLab response cache on bun:sqlite in WAL mode. Every write is a single-row statement;
 * nothing exports the whole database. A small LRU of parsed entries saves JSON.parse on hot keys.
 * The cache is disposable: a corrupt file is moved aside and lazylab refetches from GitLab.
 */
export class CacheDb {
  private db: Database | null = null;
  private memCache = new Map<string, CacheEntry>();
  private readonly memoryEntries: number;
  readonly dataDir: string;
  readonly dbPath: string;
  readonly walPath: string;
  private isInitialized = false;
  private lastCheckpoint = Date.now();
  private walEntriesCount = 0;
  private stmts: {
    get: Statement<CacheRow, [string]>;
    upsert: Statement;
    insertLog: Statement;
    deleteCategory: Statement;
    deleteAll: Statement;
    recentLogs: Statement<WalLog & { details: string | null }, []>;
    countEntries: Statement<{ n: number }, []>;
  } | null = null;

  constructor(opts: CacheDbOptions = {}) {
    this.dataDir = path.resolve(opts.dataDir ?? (process.env.LAZYLAB_DATA_DIR || path.join(process.cwd(), '.data')));
    this.dbPath = path.join(this.dataDir, 'labwi_cache.sqlite');
    this.walPath = path.join(this.dataDir, 'labwi_cache.wal');
    this.memoryEntries = Math.max(1, opts.memoryEntries ?? DEFAULT_MEMORY_ENTRIES);
  }

  async init() {
    this.initSync();
  }

  private initSync() {
    if (this.isInitialized) return;
    fs.mkdirSync(this.dataDir, { recursive: true });

    try {
      this.db = this.open();
    } catch (err) {
      // The cache only holds copies of GitLab data: keep the bad file for inspection and start empty.
      const aside = `${this.dbPath}.corrupt-${Date.now()}`;
      console.warn(`Unreadable cache database, moving it to ${aside} and starting empty:`, err);
      this.db?.close();
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          if (fs.existsSync(this.dbPath + suffix)) fs.renameSync(this.dbPath + suffix, aside + suffix);
        } catch {}
      }
      try {
        this.db = this.open();
      } catch (again) {
        // Read-only volume or similar: keep serving from an in-memory cache rather than failing startup.
        console.warn('Cache database unavailable, using an in-memory cache for this run:', again);
        this.db = this.open(':memory:');
      }
    }

    const n = this.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM wal_logs').get();
    this.walEntriesCount = n?.n ?? 0;

    this.isInitialized = true;
    this.logWal('SYSTEM_INIT', 'cache', 'system', 'Cache database opened (SQLite WAL)');
  }

  /**
   * Opens the database and applies the schema. A file written by the earlier sql.js engine is a
   * plain SQLite database with the same schema, so it opens as is and switches to WAL here.
   */
  private open(file = this.dbPath): Database {
    const db = new Database(file, { create: true, strict: true });
    try {
      db.run('PRAGMA journal_mode = WAL');
      db.run('PRAGMA synchronous = NORMAL');
      db.run('PRAGMA busy_timeout = 5000');
      db.run(`CREATE TABLE IF NOT EXISTS cache_store (
        key TEXT PRIMARY KEY,
        category TEXT,
        project_id TEXT,
        data TEXT,
        etag TEXT,
        updated_at INTEGER,
        expires_at INTEGER
      )`);
      db.run('CREATE INDEX IF NOT EXISTS idx_cat_proj ON cache_store(category, project_id)');
      db.run(`CREATE TABLE IF NOT EXISTS wal_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation TEXT,
        key TEXT,
        category TEXT,
        timestamp INTEGER,
        details TEXT
      )`);
      const check = db.query<{ quick_check: string }, []>('PRAGMA quick_check').get();
      if (check && check.quick_check !== 'ok') throw new Error(`quick_check: ${check.quick_check}`);
      this.stmts = {
        get: db.query('SELECT key, category, project_id, data, etag, updated_at, expires_at FROM cache_store WHERE key = ?'),
        upsert: db.query(
          'INSERT OR REPLACE INTO cache_store (key, category, project_id, data, etag, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ),
        insertLog: db.query('INSERT INTO wal_logs (operation, key, category, timestamp, details) VALUES (?, ?, ?, ?, ?)'),
        deleteCategory: db.query('DELETE FROM cache_store WHERE category = ?'),
        deleteAll: db.query('DELETE FROM cache_store'),
        recentLogs: db.query('SELECT id, operation, key, category, timestamp, details FROM wal_logs ORDER BY id DESC LIMIT 10'),
        countEntries: db.query('SELECT COUNT(*) AS n FROM cache_store')
      };
      return db;
    } catch (err) {
      this.stmts = null;
      db.close();
      throw err;
    }
  }

  /** Closes the database (tests, shutdown). A later init() reopens it. */
  close() {
    this.stmts = null;
    this.db?.close();
    this.db = null;
    this.memCache.clear();
    this.isInitialized = false;
  }

  private appendWalDisk(operation: string, key: string, category: string, details?: string) {
    try {
      const line = JSON.stringify({
        ts: Date.now(),
        op: operation,
        key,
        cat: category,
        det: details
      }) + '\n';
      fs.appendFileSync(this.walPath, line);
    } catch (err) {
      console.warn('Failed appending to WAL log:', err);
    }
  }

  logWal(operation: string, key: string, category: string, details?: string) {
    const now = Date.now();
    this.appendWalDisk(operation, key, category, details);

    if (this.stmts) {
      try {
        this.stmts.insertLog.run(operation, key, category, now, details ?? null);
        this.walEntriesCount++;
      } catch (err) {
        console.warn('WAL insert error:', err);
      }
    }
  }

  private remember(entry: CacheEntry) {
    this.memCache.delete(entry.key);
    this.memCache.set(entry.key, entry);
    while (this.memCache.size > this.memoryEntries) {
      const oldest = this.memCache.keys().next().value;
      if (oldest === undefined) break;
      this.memCache.delete(oldest);
    }
  }

  private load(key: string): CacheEntry | null {
    const hit = this.memCache.get(key);
    if (hit) {
      this.remember(hit);
      return hit;
    }
    if (!this.stmts) return null;
    let row: CacheRow | null;
    try {
      row = this.stmts.get.get(key);
    } catch (err) {
      console.warn('Cache read error:', err);
      return null;
    }
    if (!row) return null;
    let data: unknown;
    try {
      data = JSON.parse(row.data);
    } catch {
      data = row.data;
    }
    const entry: CacheEntry = {
      key: row.key,
      category: row.category,
      projectId: row.project_id,
      data,
      etag: row.etag ?? undefined,
      updatedAt: Number(row.updated_at),
      expiresAt: Number(row.expires_at)
    };
    this.remember(entry);
    return entry;
  }

  /**
   * Returns a cached entry, or null when it is missing or past its TTL.
   * Expired entries are kept so `allowStale` callers can still serve them (e.g. GitLab unreachable).
   */
  get<T = any>(key: string, opts: { allowStale?: boolean } = {}): { data: T; etag?: string; updatedAt: number; stale: boolean } | null {
    const entry = this.load(key);
    if (!entry) return null;
    const stale = entry.expiresAt <= Date.now();
    if (stale && !opts.allowStale) return null;
    return { data: entry.data as T, etag: entry.etag, updatedAt: entry.updatedAt, stale };
  }

  set<T = any>(key: string, category: string, projectId: string | null, data: T, etag?: string, ttlMs: number = 300000) {
    const now = Date.now();
    const expiresAt = now + ttlMs;
    const entry: CacheEntry<T> = { key, category, projectId, data, etag, updatedAt: now, expiresAt };

    this.remember(entry);

    if (this.stmts) {
      try {
        this.stmts.upsert.run(key, category, projectId, JSON.stringify(data), etag ?? null, now, expiresAt);
        this.lastCheckpoint = now;
      } catch (err) {
        console.warn('Cache insert error:', err);
      }
    }

    this.logWal('SET', key, category, `Cached ${Array.isArray(data) ? data.length + ' items' : 'object'}`);
  }

  clear(category?: string) {
    if (category) {
      for (const [k, v] of this.memCache.entries()) {
        if (v.category === category) this.memCache.delete(k);
      }
      try {
        this.stmts?.deleteCategory.run(category);
      } catch (err) {
        console.warn('Cache delete error:', err);
      }
      this.logWal('CLEAR', category, category, `Purged cache for ${category}`);
    } else {
      this.memCache.clear();
      try {
        this.stmts?.deleteAll.run();
      } catch (err) {
        console.warn('Cache delete error:', err);
      }
      this.logWal('PURGE_ALL', 'all', 'system', 'Purged all cache store');
    }
    this.lastCheckpoint = Date.now();
  }

  getStats() {
    let walFileSize = 0;
    try {
      if (fs.existsSync(this.walPath)) walFileSize = fs.statSync(this.walPath).size;
    } catch {}

    let recentLogs: WalLog[] = [];
    let totalEntries = this.memCache.size;
    if (this.stmts) {
      try {
        recentLogs = this.stmts.recentLogs.all().map((row) => ({
          id: Number(row.id),
          operation: String(row.operation),
          key: String(row.key),
          category: String(row.category),
          timestamp: Number(row.timestamp),
          details: row.details ?? undefined
        }));
        totalEntries = this.stmts.countEntries.get()?.n ?? totalEntries;
      } catch {}
    }

    return {
      totalEntries,
      walEntriesCount: this.walEntriesCount,
      walSizeBytes: walFileSize,
      lastCheckpoint: this.lastCheckpoint,
      recentLogs
    };
  }
}

export const cacheDb = new CacheDb();
