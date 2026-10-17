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
  private totalApiHits = 142; // starting sensible default for demo visualization
  private totalCacheHits = 488; // sensible default showing WAL cache efficiency
  private rateLimit: GitLabRateLimitInfo = {
    limit: 2000,
    remaining: 1858,
    observed: 142,
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

  private initBuckets() {
    const now = Date.now();
    for (let i = this.maxBuckets - 1; i >= 0; i--) {
      const time = now - i * 60 * 1000;
      const date = new Date(time);
      const label = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
      
      // Seed realistic data for the graph
      const apiHits = Math.floor(Math.random() * 8) + 1;
      const cacheHits = Math.floor(Math.random() * 25) + 10;
      const observed = 100 + (30 - i) * 3;
      const remaining = Math.max(0, 2000 - observed);
      const usagePercent = Math.min(100, (observed / 2000) * 100);

      this.buckets.push({
        timestamp: time,
        label,
        apiHits,
        cacheHits,
        rateLimitRemaining: remaining,
        usagePercent: Number(usagePercent.toFixed(1))
      });
    }

    // Seed recent calls
    this.recentCalls = [
      { id: 'c-1', endpoint: 'GET /projects', type: 'cache_hit', status: 200, durationMs: 1.2, timestamp: now - 3500 },
      { id: 'c-2', endpoint: 'GET /projects/901/issues', type: 'cache_hit', status: 200, durationMs: 0.8, timestamp: now - 8200 },
      { id: 'c-3', endpoint: 'GET /projects/901/pipelines', type: 'api_call', status: 200, durationMs: 145.4, timestamp: now - 15000 },
      { id: 'c-4', endpoint: 'GET /runners', type: 'cache_hit', status: 200, durationMs: 1.1, timestamp: now - 22000 },
      { id: 'c-5', endpoint: 'GET /milestones', type: 'cache_hit', status: 200, durationMs: 0.9, timestamp: now - 31000 }
    ];
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

    // Parse standard and GitLab rate limit headers if present
    if (headers) {
      const limitH = headers.get('ratelimit-limit') || headers.get('x-ratelimit-limit');
      const remainH = headers.get('ratelimit-remaining') || headers.get('x-ratelimit-remaining');
      const resetH = headers.get('ratelimit-reset') || headers.get('x-ratelimit-reset');
      const observedH = headers.get('ratelimit-observed') || headers.get('x-ratelimit-observed');

      if (limitH) {
        this.rateLimit.limit = parseInt(limitH, 10) || 2000;
      }
      if (remainH) {
        this.rateLimit.remaining = parseInt(remainH, 10) || Math.max(0, this.rateLimit.limit - 1);
      } else {
        this.rateLimit.remaining = Math.max(0, this.rateLimit.remaining - 1);
      }
      if (observedH) {
        this.rateLimit.observed = parseInt(observedH, 10);
      } else {
        this.rateLimit.observed = this.rateLimit.limit - this.rateLimit.remaining;
      }
      if (resetH) {
        const val = parseInt(resetH, 10);
        // Can be epoch in seconds or delta seconds
        const resetTime = val > 1000000000 ? val * 1000 : Date.now() + val * 1000;
        this.rateLimit.resetAt = resetTime;
        this.rateLimit.resetSeconds = Math.max(0, Math.round((resetTime - Date.now()) / 1000));
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
