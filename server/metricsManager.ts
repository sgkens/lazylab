import { readRateLimitHeaders } from './requestScheduler.js';

export interface ApiMetricBucket {
  timestamp: number;
  label: string; // e.g., "14:05"
  apiHits: number;
  cacheHits: number;
  rateLimitRemaining: number;
  usagePercent: number;
}

export interface GitLabRateLimitInfo {
  limit: number;
  remaining: number;
  observed: number;
  resetAt: number; // unix timestamp in ms
  resetSeconds: number;
  lastUpdated: number;
}

export interface MetricsSummary {
  totalApiHits: number;
  totalCacheHits: number;
  cacheHitRatio: number; // 0 - 100
  rateLimit: GitLabRateLimitInfo;
  buckets: ApiMetricBucket[];
  recentCalls: {
    id: string;
    endpoint: string;
    type: 'cache_hit' | 'api_call';
    status: number;
    durationMs: number;
    timestamp: number;
  }[];
}

class MetricsManager {
  private totalApiHits = 0;
  private totalCacheHits = 0;
  // GitLab.com's authenticated default until the first response carries RateLimit-* headers.
  private rateLimit: GitLabRateLimitInfo = {
    limit: 2000,
    remaining: 2000,
    observed: 0,
    resetAt: Date.now() + 45 * 1000,
    resetSeconds: 45,
    lastUpdated: Date.now()
  };

  private buckets: ApiMetricBucket[] = [];
  private recentCalls: MetricsSummary['recentCalls'] = [];
  private readonly maxBuckets = 30; // 30 minutes window

  constructor() {
    this.initBuckets();
  }

  /** Empty one-minute buckets so the chart has a time axis before any traffic. */
  private initBuckets() {
    const now = Date.now();
    for (let i = this.maxBuckets - 1; i >= 0; i--) {
      const time = now - i * 60 * 1000;
      const date = new Date(time);
      const label = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
      this.buckets.push({
        timestamp: time,
        label,
        apiHits: 0,
        cacheHits: 0,
        rateLimitRemaining: this.rateLimit.remaining,
        usagePercent: Number(((this.rateLimit.observed / this.rateLimit.limit) * 100).toFixed(1))
      });
    }
  }

  private getCurrentBucket(): ApiMetricBucket {
    const now = Date.now();
    const date = new Date(now);
    const label = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

    const lastBucket = this.buckets[this.buckets.length - 1];
    if (lastBucket && now - lastBucket.timestamp < 60 * 1000) {
      return lastBucket;
    }

    // Create new bucket
    const newBucket: ApiMetricBucket = {
      timestamp: now,
      label,
      apiHits: 0,
      cacheHits: 0,
      rateLimitRemaining: this.rateLimit.remaining,
      usagePercent: Number(((this.rateLimit.observed / this.rateLimit.limit) * 100).toFixed(1))
    };

    this.buckets.push(newBucket);
    if (this.buckets.length > this.maxBuckets) {
      this.buckets.shift();
    }
    return newBucket;
  }

  recordCacheHit(endpoint: string, durationMs: number = 1.0) {
    this.totalCacheHits++;
    const bucket = this.getCurrentBucket();
    bucket.cacheHits++;

    this.recentCalls.unshift({
      id: `ch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      endpoint,
      type: 'cache_hit',
      status: 200,
      durationMs: Number(durationMs.toFixed(1)),
      timestamp: Date.now()
    });

    if (this.recentCalls.length > 20) {
      this.recentCalls.pop();
    }
  }

  recordApiHit(endpoint: string, status: number, durationMs: number, headers?: Headers) {
    this.totalApiHits++;
    const bucket = this.getCurrentBucket();
    bucket.apiHits++;

    // Parse standard and GitLab rate limit headers if present. 0 is a real value (quota used up).
    if (headers) {
      const rl = readRateLimitHeaders(headers);
      const observedH = headers.get('ratelimit-observed') ?? headers.get('x-ratelimit-observed');
      if (rl.limit !== null && rl.limit > 0) this.rateLimit.limit = rl.limit;
      this.rateLimit.remaining = rl.remaining !== null ? Math.max(0, rl.remaining) : Math.max(0, this.rateLimit.remaining - 1);
      const observed = observedH !== null ? Number(observedH) : NaN;
      this.rateLimit.observed = Number.isFinite(observed) ? observed : this.rateLimit.limit - this.rateLimit.remaining;
      if (rl.resetAt !== null) {
        this.rateLimit.resetAt = rl.resetAt;
        this.rateLimit.resetSeconds = Math.max(0, Math.round((rl.resetAt - Date.now()) / 1000));
      }
    } else {
      // Fallback update
      this.rateLimit.observed++;
      this.rateLimit.remaining = Math.max(0, this.rateLimit.limit - this.rateLimit.observed);
      this.rateLimit.resetSeconds = Math.max(0, Math.round((this.rateLimit.resetAt - Date.now()) / 1000));
      if (this.rateLimit.resetSeconds <= 0) {
        this.rateLimit.resetAt = Date.now() + 60 * 1000;
        this.rateLimit.resetSeconds = 60;
        this.rateLimit.observed = 1;
        this.rateLimit.remaining = this.rateLimit.limit - 1;
      }
    }

    this.rateLimit.lastUpdated = Date.now();
    bucket.rateLimitRemaining = this.rateLimit.remaining;
    bucket.usagePercent = Number(((this.rateLimit.observed / this.rateLimit.limit) * 100).toFixed(1));

    this.recentCalls.unshift({
      id: `api-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      endpoint,
      type: 'api_call',
      status,
      durationMs: Number(durationMs.toFixed(1)),
      timestamp: Date.now()
    });

    if (this.recentCalls.length > 20) {
      this.recentCalls.pop();
    }
  }

  getSummary(): MetricsSummary {
    const totalRequests = this.totalApiHits + this.totalCacheHits;
    const cacheHitRatio = totalRequests > 0
      ? Number(((this.totalCacheHits / totalRequests) * 100).toFixed(1))
      : 100;

    const remainingSec = Math.max(0, Math.round((this.rateLimit.resetAt - Date.now()) / 1000));
    const rateLimitInfo: GitLabRateLimitInfo = {
      ...this.rateLimit,
      resetSeconds: remainingSec
    };

    return {
      totalApiHits: this.totalApiHits,
      totalCacheHits: this.totalCacheHits,
      cacheHitRatio,
      rateLimit: rateLimitInfo,
      buckets: [...this.buckets],
      recentCalls: [...this.recentCalls]
    };
  }

  reset() {
    this.totalApiHits = 0;
    this.totalCacheHits = 0;
    this.rateLimit.observed = 0;
    this.rateLimit.remaining = this.rateLimit.limit;
    this.buckets = [];
    this.recentCalls = [];
    this.initBuckets();
  }
}

export const metricsManager = new MetricsManager();
