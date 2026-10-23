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
  /** Text journal size that triggers a rotation to `<journal>.1`. 0 disables rotation. */
  journalMaxBytes?: number;
  /** Newest `wal_logs` rows kept. 0 keeps every row. */
  journalKeepRows?: number;
  /** Age in days after which `wal_logs` rows are pruned. 0 keeps rows of any age. */
  journalKeepDays?: number;
  /** How long expired rows stay readable through `allowStale` before they are deleted. */
  staleKeepHours?: number;
  /** Row cap for `cache_store`; the least recently written rows go first. 0 disables the cap. */
  maxRows?: number;
  /** Cap on the stored JSON size in MiB; the least recently written rows go first. 0 disables the cap. */
  maxMegabytes?: number;
  /** Interval of the background retention sweep. 0 disables the timer (tests call sweep()). */
  sweepIntervalMs?: number;
}

export interface SweepResult {
  expired: number;
  overCap: number;
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
const DEFAULT_JOURNAL_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_JOURNAL_KEEP_ROWS = 10_000;
const DEFAULT_JOURNAL_KEEP_DAYS = 7;
const DEFAULT_STALE_KEEP_HOURS = 24;
const DEFAULT_MAX_ROWS = 5_000;
const DEFAULT_MAX_MEGABYTES = 128;
const DEFAULT_SWEEP_INTERVAL_MS = 10 * 60_000;
const HOUR_MS = 3_600_000;
/** Journal inserts between two prunes of `wal_logs`. */
const PRUNE_EVERY = 500;
const DAY_MS = 86_400_000;

/** Reads a non-negative integer setting; unset or invalid values fall back to the default. */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.warn(`Ignoring ${name}=${raw}: expected a non-negative number, using ${fallback}`);
    return fallback;
  }
  return Math.floor(n);
}

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
  private readonly journalMaxBytes: number;
  private readonly journalKeepRows: number;
  private readonly journalKeepDays: number;
  private journalBytes = 0;
  private logsSincePrune = 0;
  private readonly staleKeepMs: number;
  private readonly maxRows: number;
  private readonly maxBytes: number;
  private readonly sweepIntervalMs: number;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private stmts: {
    get: Statement<CacheRow, [string]>;
    getData: Statement<{ data: string }, [string]>;
    upsert: Statement;
    touch: Statement;
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
    this.memoryEntries = Math.max(1, opts.memoryEntries ?? envInt('LAZYLAB_CACHE_MEMORY_ENTRIES', DEFAULT_MEMORY_ENTRIES));
    this.journalMaxBytes = opts.journalMaxBytes ?? envInt('LAZYLAB_JOURNAL_MAX_BYTES', DEFAULT_JOURNAL_MAX_BYTES);
    this.journalKeepRows = opts.journalKeepRows ?? envInt('LAZYLAB_JOURNAL_KEEP_ROWS', DEFAULT_JOURNAL_KEEP_ROWS);
    this.journalKeepDays = opts.journalKeepDays ?? envInt('LAZYLAB_JOURNAL_KEEP_DAYS', DEFAULT_JOURNAL_KEEP_DAYS);
    this.staleKeepMs = (opts.staleKeepHours ?? envInt('LAZYLAB_CACHE_STALE_HOURS', DEFAULT_STALE_KEEP_HOURS)) * HOUR_MS;
    this.maxRows = opts.maxRows ?? envInt('LAZYLAB_CACHE_MAX_ROWS', DEFAULT_MAX_ROWS);
    this.maxBytes = (opts.maxMegabytes ?? envInt('LAZYLAB_CACHE_MAX_MB', DEFAULT_MAX_MEGABYTES)) * 1024 * 1024;
    this.sweepIntervalMs = opts.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
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

    try {
      this.journalBytes = fs.existsSync(this.walPath) ? fs.statSync(this.walPath).size : 0;
    } catch {
      this.journalBytes = 0;
    }
    this.pruneJournal();

    this.isInitialized = true;
    this.logWal('SYSTEM_INIT', 'cache', 'system', 'Cache database opened (SQLite WAL)');
    this.sweep();
    if (this.sweepIntervalMs > 0) {
      this.sweepTimer = setInterval(() => this.sweep(), this.sweepIntervalMs);
      this.sweepTimer.unref?.();
    }
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
      // Purged GitLab data is overwritten on disk instead of lingering in free pages.
      db.run('PRAGMA secure_delete = ON');
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
        getData: db.query('SELECT data FROM cache_store WHERE key = ?'),
        touch: db.query('UPDATE cache_store SET category = ?, project_id = ?, etag = ?, updated_at = ?, expires_at = ? WHERE key = ?'),
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
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
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
      if (this.journalMaxBytes > 0 && this.journalBytes > 0 && this.journalBytes + line.length > this.journalMaxBytes) {
        // Keep one previous file: the journal on disk stays below about twice the limit.
        fs.renameSync(this.walPath, `${this.walPath}.1`);
        this.journalBytes = 0;
      }
      fs.appendFileSync(this.walPath, line);
      this.journalBytes += Buffer.byteLength(line);
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
      if (++this.logsSincePrune >= PRUNE_EVERY) this.pruneJournal(now);
    }
  }

  /** Drops `wal_logs` rows older than the day limit and beyond the row limit. Returns the rows removed. */
  pruneJournal(now = Date.now()): number {
    this.logsSincePrune = 0;
    const db = this.db;
    if (!db) return 0;
    let removed = 0;
    try {
      if (this.journalKeepDays > 0) {
        removed += db.query('DELETE FROM wal_logs WHERE timestamp < ?').run(now - this.journalKeepDays * DAY_MS).changes;
      }
      if (this.journalKeepRows > 0) {
        removed += db
          .query('DELETE FROM wal_logs WHERE id <= (SELECT id FROM wal_logs ORDER BY id DESC LIMIT 1 OFFSET ?)')
          .run(this.journalKeepRows).changes;
      }
      this.walEntriesCount = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM wal_logs').get()?.n ?? 0;
    } catch (err) {
      console.warn('Journal prune error:', err);
    }
    return removed;
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

    let changed = true;
    if (this.stmts) {
      try {
        const json = JSON.stringify(data);
        // Auto-fetch rewrites the same lists every cycle: an unchanged body only extends the TTL
        // and is not journaled, which keeps the journal to real changes.
        changed = this.stmts.getData.get(key)?.data !== json;
        if (changed) this.stmts.upsert.run(key, category, projectId, json, etag ?? null, now, expiresAt);
        else this.stmts.touch.run(category, projectId, etag ?? null, now, expiresAt, key);
        this.lastCheckpoint = now;
      } catch (err) {
        console.warn('Cache insert error:', err);
      }
    }

    if (changed) this.logWal('SET', key, category, `Cached ${Array.isArray(data) ? data.length + ' items' : 'object'}`);

    // The membership list is the authority on which projects the user can still see.
    if (category === 'projects' && projectId === null && Array.isArray(data)) {
      const ids = data.map((p: any) => p?.id).filter((id) => typeof id === 'number' || typeof id === 'string');
      if (ids.length === data.length) this.retainProjects(ids.map(String), now);
    }
  }

  /** Drops memory entries whose rows are gone from SQLite after a bulk delete. */
  private forgetMissing() {
    const db = this.db;
    if (!db) return;
    const exists = db.query<{ one: number }, [string]>('SELECT 1 AS one FROM cache_store WHERE key = ?');
    for (const key of [...this.memCache.keys()]) {
      if (!exists.get(key)) this.memCache.delete(key);
    }
  }

  /**
   * Deletes expired rows of projects missing from the membership list. They skip the stale grace
   * period; fresh rows age out within their TTL and go at the next membership refresh. The list
   * covers the first page of member projects (by activity), so a project beyond it loses only its
   * stale copies.
   */
  retainProjects(memberIds: string[], now = Date.now()): number {
    const db = this.db;
    if (!db) return 0;
    let removed = 0;
    try {
      removed = db
        .query('DELETE FROM cache_store WHERE project_id IS NOT NULL AND expires_at <= ? AND project_id NOT IN (SELECT value FROM json_each(?))')
        .run(now, JSON.stringify(memberIds)).changes;
    } catch (err) {
      console.warn('Cache retention error:', err);
    }
    if (removed > 0) {
      this.forgetMissing();
      this.logWal('EVICT', 'non-member', 'system', `Evicted ${removed} cached rows of projects you are no longer a member of`);
    }
    return removed;
  }

  /**
   * Retention pass: deletes rows expired for longer than the stale grace period, then the least
   * recently written rows beyond the row and size caps. Runs at start and on a timer.
   */
  sweep(now = Date.now()): SweepResult {
    const result: SweepResult = { expired: 0, overCap: 0 };
    const db = this.db;
    if (!db) return result;
    try {
      result.expired = db.query('DELETE FROM cache_store WHERE expires_at < ?').run(now - this.staleKeepMs).changes;

      if (this.maxRows > 0) {
        result.overCap += db
          .query('DELETE FROM cache_store WHERE key IN (SELECT key FROM cache_store ORDER BY updated_at DESC LIMIT -1 OFFSET ?)')
          .run(this.maxRows).changes;
      }

      if (this.maxBytes > 0) {
        const total = db.query<{ bytes: number | null }, []>('SELECT SUM(length(data)) AS bytes FROM cache_store').get()?.bytes ?? 0;
        if (total > this.maxBytes) {
          let excess = total - this.maxBytes;
          const victims: string[] = [];
          for (const row of db.query<{ key: string; size: number }, []>('SELECT key, length(data) AS size FROM cache_store ORDER BY updated_at ASC').iterate()) {
            if (excess <= 0) break;
            victims.push(row.key);
            excess -= row.size;
          }
          const del = db.query('DELETE FROM cache_store WHERE key = ?');
          db.transaction((keys: string[]) => {
            for (const k of keys) result.overCap += del.run(k).changes;
          })(victims);
        }
      }
    } catch (err) {
      console.warn('Cache sweep error:', err);
    }
    if (result.expired + result.overCap > 0) {
      this.forgetMissing();
      this.logWal('EVICT', 'sweep', 'system', `Evicted ${result.expired} expired and ${result.overCap} over-cap cached rows`);
    }
    return result;
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
        // A full purge runs on profile changes and removal: drop the old pages from the WAL file too.
        this.db?.run('PRAGMA wal_checkpoint(TRUNCATE)');
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
