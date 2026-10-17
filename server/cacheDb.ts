import fs from 'fs';
import path from 'path';
import initSqlJs, { Database } from 'sql.js';

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

class CacheDb {
  private db: Database | null = null;
  private memCache = new Map<string, CacheEntry>();
  private dataDir = path.resolve(process.env.LAZYLAB_DATA_DIR || path.join(process.cwd(), '.data'));
  private dbPath = path.resolve(this.dataDir, 'labwi_cache.sqlite');
  private walPath = path.resolve(this.dataDir, 'labwi_cache.wal');
  private isInitialized = false;
  private lastCheckpoint = Date.now();
  private walEntriesCount = 0;

  async init() {
    if (this.isInitialized) return;

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    const SQL = await initSqlJs();

    if (fs.existsSync(this.dbPath)) {
      try {
        const fileBuffer = fs.readFileSync(this.dbPath);
        this.db = new SQL.Database(fileBuffer);
      } catch (err) {
        console.warn('Corrupted sqlite cache, initializing new db', err);
        this.db = new SQL.Database();
      }
    } else {
      this.db = new SQL.Database();
    }

    // Set schema
    this.db.run(`
      CREATE TABLE IF NOT EXISTS cache_store (
        key TEXT PRIMARY KEY,
        category TEXT,
        project_id TEXT,
        data TEXT,
        etag TEXT,
        updated_at INTEGER,
        expires_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_cat_proj ON cache_store(category, project_id);

      CREATE TABLE IF NOT EXISTS wal_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation TEXT,
        key TEXT,
        category TEXT,
        timestamp INTEGER,
        details TEXT
      );
    `);

    // Load existing cache into in-memory LRU
    try {
      const res = this.db.exec("SELECT key, category, project_id, data, etag, updated_at, expires_at FROM cache_store");
      if (res.length > 0 && res[0].values) {
        for (const row of res[0].values) {
          const key = String(row[0]);
          const category = String(row[1]);
          const projectId = row[2] ? String(row[2]) : null;
          let data = null;
          try {
            data = JSON.parse(String(row[3]));
          } catch {
            data = row[3];
          }
          const etag = row[4] ? String(row[4]) : undefined;
          const updatedAt = Number(row[5]);
          const expiresAt = Number(row[6]);

          this.memCache.set(key, { key, category, projectId, data, etag, updatedAt, expiresAt });
        }
      }
    } catch (e) {
      console.error('Failed reading existing cache rows:', e);
    }

    // Check WAL file stats
    if (fs.existsSync(this.walPath)) {
      try {
        const stats = fs.statSync(this.walPath);
        this.walEntriesCount = Math.floor(stats.size / 64);
      } catch {
        this.walEntriesCount = 0;
      }
    }

    this.isInitialized = true;
    this.logWal('SYSTEM_INIT', 'cache', 'system', 'Database & WAL initialized in memory');
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
      this.walEntriesCount++;
    } catch (err) {
      console.warn('Failed appending to WAL log:', err);
    }
  }

  logWal(operation: string, key: string, category: string, details?: string) {
    const now = Date.now();
    this.appendWalDisk(operation, key, category, details);

    if (this.db) {
      try {
        this.db.run(
          "INSERT INTO wal_logs (operation, key, category, timestamp, details) VALUES (?, ?, ?, ?, ?)",
          [operation, key, category, now, details || null]
        );
      } catch (err) {
        console.warn('WAL insert error:', err);
      }
    }
  }

  /**
   * Returns a cached entry, or null when it is missing or past its TTL.
   * Expired entries are kept so `allowStale` callers can still serve them (e.g. GitLab unreachable).
   */
  get<T = any>(key: string, opts: { allowStale?: boolean } = {}): { data: T; etag?: string; updatedAt: number; stale: boolean } | null {
    const entry = this.memCache.get(key);
    if (!entry) return null;
    const stale = entry.expiresAt <= Date.now();
    if (stale && !opts.allowStale) return null;
    return { data: entry.data as T, etag: entry.etag, updatedAt: entry.updatedAt, stale };
  }

  set<T = any>(key: string, category: string, projectId: string | null, data: T, etag?: string, ttlMs: number = 300000) {
    const now = Date.now();
    const expiresAt = now + ttlMs;
    const entry: CacheEntry<T> = { key, category, projectId, data, etag, updatedAt: now, expiresAt };

    this.memCache.set(key, entry);

    if (this.db) {
      try {
        this.db.run(
          "INSERT OR REPLACE INTO cache_store (key, category, project_id, data, etag, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [key, category, projectId, JSON.stringify(data), etag || null, now, expiresAt]
        );
      } catch (err) {
        console.warn('Cache insert error:', err);
      }
    }

    this.logWal('SET', key, category, `Cached ${Array.isArray(data) ? data.length + ' items' : 'object'}`);
    this.scheduleCheckpoint();
  }

  queryCategory<T = any>(category: string, projectId?: string | null): T[] {
    const results: T[] = [];
    for (const entry of this.memCache.values()) {
      if (entry.category === category) {
        if (!projectId || entry.projectId === projectId || entry.projectId === null) {
          if (Array.isArray(entry.data)) {
            results.push(...(entry.data as any[]));
          } else {
            results.push(entry.data as T);
          }
        }
      }
    }
    return results;
  }

  clear(category?: string) {
    if (category) {
      for (const [k, v] of this.memCache.entries()) {
        if (v.category === category) {
          this.memCache.delete(k);
        }
      }
      if (this.db) {
        this.db.run("DELETE FROM cache_store WHERE category = ?", [category]);
      }
      this.logWal('CLEAR', category, category, `Purged cache for ${category}`);
    } else {
      this.memCache.clear();
      if (this.db) {
        this.db.run("DELETE FROM cache_store");
      }
      this.logWal('PURGE_ALL', 'all', 'system', 'Purged all cache store');
    }
    this.scheduleCheckpoint(true);
  }

  private checkpointTimeout: any = null;
  private scheduleCheckpoint(immediate = false) {
    if (immediate) {
      this.persistToDisk();
      return;
    }
    if (this.checkpointTimeout) return;
    this.checkpointTimeout = setTimeout(() => {
      this.checkpointTimeout = null;
      this.persistToDisk();
    }, 2000);
  }

  persistToDisk() {
    if (!this.db) return;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
      this.lastCheckpoint = Date.now();
    } catch (err) {
      console.error('Failed writing sqlite snapshot:', err);
    }
  }

  getStats() {
    let walFileSize = 0;
    try {
      if (fs.existsSync(this.walPath)) {
        walFileSize = fs.statSync(this.walPath).size;
      }
    } catch {}

    let recentLogs: WalLog[] = [];
    if (this.db) {
      try {
        const res = this.db.exec("SELECT id, operation, key, category, timestamp, details FROM wal_logs ORDER BY id DESC LIMIT 10");
        if (res.length > 0 && res[0].values) {
          recentLogs = res[0].values.map((row) => ({
            id: Number(row[0]),
            operation: String(row[1]),
            key: String(row[2]),
            category: String(row[3]),
            timestamp: Number(row[4]),
            details: row[5] ? String(row[5]) : undefined
          }));
        }
      } catch {}
    }

    return {
      totalEntries: this.memCache.size,
      walEntriesCount: this.walEntriesCount,
      walSizeBytes: walFileSize,
      lastCheckpoint: this.lastCheckpoint,
      recentLogs
    };
  }
}

export const cacheDb = new CacheDb();
