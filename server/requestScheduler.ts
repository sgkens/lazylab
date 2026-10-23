// Request budget for GitLab API calls (GL-19).
//
// Every GitLab request waits for a slot here. The scheduler keeps lazylab inside a per-plan budget
// (two token buckets: per minute and per hour), serves lanes by priority (interactive > watch >
// background), slows the lower lanes when GitLab's RateLimit-Remaining runs low, and pauses all
// lanes after a 429 until Retry-After / RateLimit-Reset has passed.
//
// The lane comes from the async context: code that runs background work wraps it in runInLane(), so
// call sites deep in the client do not have to pass a flag around.
import { AsyncLocalStorage } from 'async_hooks';

export type Lane = 'interactive' | 'watch' | 'background';
export const LANES: readonly Lane[] = ['interactive', 'watch', 'background'];

export type BudgetPlan = 'free' | 'premium' | 'ultimate' | 'unlimited' | 'custom';

export interface RequestBudget {
  plan: BudgetPlan;
  /** Requests per hour lazylab may send; 0 means no hourly cap. */
  perHour: number;
  /** Requests per minute (burst); 0 means no per-minute cap. */
  perMinute: number;
}

/**
 * Defaults leave about 20% of each GitLab.com plan limit for glab, the CLI and other tools on the same
 * account, since GitLab counts requests per user, not per token. Free: 5,000/h and 100/min burst.
 */
export const PLAN_BUDGETS: Record<Exclude<BudgetPlan, 'custom'>, Omit<RequestBudget, 'plan'>> = {
  free: { perHour: 4000, perMinute: 80 },
  premium: { perHour: 12000, perMinute: 1000 },
  ultimate: { perHour: 20000, perMinute: 1600 },
  unlimited: { perHour: 0, perMinute: 0 }
};

export const DEFAULT_BUDGET: RequestBudget = { plan: 'free', ...PLAN_BUDGETS.free };

export const REQUEST_TIMEOUT_MS = 15_000;

const MAX_PER_HOUR = 1_000_000;
const MAX_PER_MINUTE = 100_000;

/** Validates a budget from a request body or the settings file. Throws with a user-facing message. */
export function parseBudget(input: unknown): RequestBudget {
  const body = (input ?? {}) as Record<string, unknown>;
  const plan = body.plan as BudgetPlan;
  if (plan !== 'custom') {
    if (typeof plan !== 'string' || !Object.hasOwn(PLAN_BUDGETS, plan)) throw new Error('plan must be free, premium, ultimate, unlimited or custom');
    return { plan, ...PLAN_BUDGETS[plan as keyof typeof PLAN_BUDGETS] };
  }
  const perHour = Number(body.perHour);
  const perMinute = Number(body.perMinute);
  if (!Number.isInteger(perHour) || perHour < 0 || perHour > MAX_PER_HOUR) throw new Error(`perHour must be a whole number from 0 to ${MAX_PER_HOUR}`);
  if (!Number.isInteger(perMinute) || perMinute < 0 || perMinute > MAX_PER_MINUTE) throw new Error(`perMinute must be a whole number from 0 to ${MAX_PER_MINUTE}`);
  return { plan, perHour, perMinute };
}

export class RateLimitedError extends Error {
  readonly status = 429;
  constructor(
    message: string,
    readonly retryAt: number | null
  ) {
    super(message);
    this.name = 'RateLimitedError';
  }
}

export interface RateLimitObservation {
  limit: number | null;
  remaining: number | null;
  /** Epoch ms when the window resets, when the response said so. */
  resetAt: number | null;
}

/** `Retry-After` is either delta seconds or an HTTP date. Returns epoch ms or null. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return now + Math.ceil(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : date;
}

/** `RateLimit-Reset` is epoch seconds on GitLab; some proxies send delta seconds. Returns epoch ms or null. */
export function parseResetHeader(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const n = Number(value.trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return n > 1_000_000_000 ? n * 1000 : now + n * 1000;
}

export function readRateLimitHeaders(headers: Headers, now = Date.now()): RateLimitObservation {
  const num = (name: string) => {
    const v = headers.get(name) ?? headers.get(`x-${name}`);
    if (v === null || v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    limit: num('ratelimit-limit'),
    remaining: num('ratelimit-remaining'),
    resetAt: parseResetHeader(headers.get('ratelimit-reset') ?? headers.get('x-ratelimit-reset'), now)
  };
}

/** Share of the minute and hour buckets each lane must leave for the lanes above it. */
const LANE_RESERVE: Record<Lane, number> = { interactive: 0, watch: 0.1, background: 0.2 };
/** Below this share of RateLimit-Remaining / RateLimit-Limit, the lane waits for the window to reset. */
const LANE_HEADER_FLOOR: Record<Lane, number> = { interactive: 0, watch: 0.05, background: 0.2 };
/** Longest a request may wait for a slot before it fails; long enough to ride out a short pause. */
const LANE_MAX_WAIT_MS: Record<Lane, number> = { interactive: 30_000, watch: 120_000, background: 300_000 };

const DEFAULT_429_PAUSE_MS = 60_000;
const MAX_PAUSE_MS = 15 * 60_000;
const DEFAULT_MAX_CONCURRENT = 8;

interface Waiter {
  lane: Lane;
  enqueuedAt: number;
  deadline: number;
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
}

class Bucket {
  tokens: number;
  private updatedAt: number;
  constructor(
    public capacity: number,
    private readonly periodMs: number,
    now: number
  ) {
    this.tokens = capacity;
    this.updatedAt = now;
  }
  get unlimited() {
    return this.capacity <= 0;
  }
  refill(now: number) {
    if (this.unlimited) return;
    const elapsed = Math.max(0, now - this.updatedAt);
    this.tokens = Math.min(this.capacity, this.tokens + (elapsed * this.capacity) / this.periodMs);
    this.updatedAt = now;
  }
  resize(capacity: number, now: number) {
    this.refill(now);
    this.capacity = capacity;
    this.tokens = capacity <= 0 ? 0 : Math.min(this.tokens, capacity);
    this.updatedAt = now;
  }
  /** Tokens a lane needs before it may take one. */
  needed(lane: Lane) {
    return 1 + Math.floor(this.capacity * LANE_RESERVE[lane]);
  }
  canTake(lane: Lane) {
    return this.unlimited || this.tokens >= this.needed(lane);
  }
  msUntil(lane: Lane) {
    if (this.canTake(lane)) return 0;
    return Math.ceil(((this.needed(lane) - this.tokens) * this.periodMs) / this.capacity);
  }
  take() {
    if (!this.unlimited) this.tokens -= 1;
  }
}

export interface SchedulerStatus {
  budget: RequestBudget;
  tokens: { minute: number | null; hour: number | null };
  queued: Record<Lane, number>;
  inFlight: number;
  /** Epoch ms until which every lane waits after a 429; null when not paused. */
  pausedUntil: number | null;
  /** Lanes currently held back by low RateLimit-Remaining, and until when. */
  slowedLanes: Lane[];
  slowedUntil: number | null;
  rateLimit: RateLimitObservation & { observedAt: number | null };
  stats: { sent: number; throttled429: number; timeouts: number; rejected: number };
  /** A short human-readable state for the sync bar; null when nothing is held back. */
  message: string | null;
}

export interface SchedulerOptions {
  budget?: RequestBudget;
  maxConcurrent?: number;
  now?: () => number;
  random?: () => number;
}

export class RequestScheduler {
  private budget: RequestBudget;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly maxConcurrent: number;
  private minute: Bucket;
  private hour: Bucket;
  private queue: Waiter[] = [];
  private inFlight = 0;
  private pausedUntil = 0;
  private consecutive429 = 0;
  private observed: RateLimitObservation & { observedAt: number | null } = { limit: null, remaining: null, resetAt: null, observedAt: null };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = 0;
  private stats = { sent: 0, throttled429: 0, timeouts: 0, rejected: 0 };
  private readonly laneContext = new AsyncLocalStorage<Lane>();
  /** Default per-request timeout (headers and body); individual calls may ask for longer. */
  timeoutMs = REQUEST_TIMEOUT_MS;

  constructor(opts: SchedulerOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.maxConcurrent = opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.budget = opts.budget ?? DEFAULT_BUDGET;
    const t = this.now();
    this.minute = new Bucket(this.budget.perMinute, 60_000, t);
    this.hour = new Bucket(this.budget.perHour, 3_600_000, t);
  }

  // ---- lanes ---------------------------------------------------------------

  /** Runs `fn` with every GitLab request inside it scheduled on `lane`. */
  runInLane<T>(lane: Lane, fn: () => T): T {
    return this.laneContext.run(lane, fn);
  }

  /** The lane of the current async context; requests from routes and the CLI default to interactive. */
  currentLane(): Lane {
    return this.laneContext.getStore() ?? 'interactive';
  }

  // ---- configuration -------------------------------------------------------

  setBudget(budget: RequestBudget) {
    this.budget = budget;
    const t = this.now();
    this.minute.resize(budget.perMinute, t);
    this.hour.resize(budget.perHour, t);
    this.pump();
  }

  getBudget(): RequestBudget {
    return { ...this.budget };
  }

  /** Forget what GitLab told us (pause, remaining); used when the active profile or host changes. */
  resetRemoteState() {
    this.pausedUntil = 0;
    this.consecutive429 = 0;
    this.observed = { limit: null, remaining: null, resetAt: null, observedAt: null };
    this.pump();
  }

  // ---- slots ---------------------------------------------------------------

  /**
   * Waits for a slot on `lane` and returns a release function, which must be called exactly once when
   * the request (including reading the body) has finished. Rejects with RateLimitedError when the
   * lane cannot start within its maximum wait.
   */
  acquire(lane: Lane = this.currentLane()): Promise<() => void> {
    const now = this.now();
    const maxWait = LANE_MAX_WAIT_MS[lane];
    if (this.pausedUntil - now > maxWait) {
      this.stats.rejected++;
      return Promise.reject(this.pausedError());
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ lane, enqueuedAt: now, deadline: now + maxWait, resolve, reject });
      this.pump();
    });
  }

  /** Runs one request on a slot; the slot is released when `fn` settles. */
  async schedule<T>(fn: () => Promise<T>, lane: Lane = this.currentLane()): Promise<T> {
    const release = await this.acquire(lane);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Feeds a response back. Updates the RateLimit-* view, and on 429 pauses every lane until
   * Retry-After (or RateLimit-Reset), with jittered exponential backoff on repeated 429s.
   * Returns the epoch ms the pause ends for a 429, else null.
   */
  observe(status: number, headers: Headers): number | null {
    const now = this.now();
    const rl = readRateLimitHeaders(headers, now);
    if (rl.limit !== null || rl.remaining !== null || rl.resetAt !== null) {
      this.observed = {
        limit: rl.limit ?? this.observed.limit,
        remaining: rl.remaining ?? this.observed.remaining,
        resetAt: rl.resetAt ?? this.observed.resetAt,
        observedAt: now
      };
    }
    if (status !== 429) {
      if (status < 500) this.consecutive429 = 0;
      this.pump();
      return null;
    }
    this.stats.throttled429++;
    this.consecutive429++;
    const told = parseRetryAfter(headers.get('retry-after'), now) ?? rl.resetAt;
    const base = told !== null ? Math.max(0, told - now) : DEFAULT_429_PAUSE_MS;
    // Repeated 429s mean the window GitLab reported was not the whole story (other tools on the account).
    const backoff = this.consecutive429 > 1 ? Math.min(MAX_PAUSE_MS, 1000 * 2 ** (this.consecutive429 - 1)) : 0;
    const jitter = Math.floor(this.random() * 1000);
    const until = now + Math.max(base, backoff) + jitter;
    this.pausedUntil = Math.max(this.pausedUntil, until);
    this.observed = { ...this.observed, remaining: 0, observedAt: now };
    this.pump();
    return this.pausedUntil;
  }

  noteTimeout() {
    this.stats.timeouts++;
  }

  /** True when a request on `lane` could still start before its maximum wait elapses. */
  canWaitUntil(lane: Lane, at: number) {
    return at - this.now() <= LANE_MAX_WAIT_MS[lane];
  }

  getStatus(): SchedulerStatus {
    const now = this.now();
    this.minute.refill(now);
    this.hour.refill(now);
    const queued: Record<Lane, number> = { interactive: 0, watch: 0, background: 0 };
    for (const w of this.queue) queued[w.lane]++;
    const slowedLanes = LANES.filter((l) => this.headerBlockedUntil(l, now) > now);
    const slowedUntil = slowedLanes.length ? this.headerBlockedUntil(slowedLanes[slowedLanes.length - 1], now) : null;
    const pausedUntil = this.pausedUntil > now ? this.pausedUntil : null;
    let message: string | null = null;
    const hhmm = (t: number) => new Date(t).toTimeString().slice(0, 5);
    if (pausedUntil) message = `GitLab rate limit: paused until ${hhmm(pausedUntil)}`;
    else if (slowedLanes.length) message = `GitLab quota low: background sync waits until ${hhmm(slowedUntil!)}`;
    else if (queued.background + queued.watch > 0 && !this.minute.canTake('background')) message = 'Request budget reached: background sync slowed';
    return {
      budget: this.getBudget(),
      tokens: {
        minute: this.minute.unlimited ? null : Math.floor(this.minute.tokens),
        hour: this.hour.unlimited ? null : Math.floor(this.hour.tokens)
      },
      queued,
      inFlight: this.inFlight,
      pausedUntil,
      slowedLanes,
      slowedUntil,
      rateLimit: { ...this.observed },
      stats: { ...this.stats },
      message
    };
  }

  // ---- internals -------------------------------------------------------------

  private pausedError() {
    const at = this.pausedUntil;
    return new RateLimitedError(`GitLab rate limit reached: requests are paused until ${new Date(at).toTimeString().slice(0, 8)}`, at);
  }

  /** When the lane may send again given RateLimit-Remaining; `now` or earlier means not blocked. */
  private headerBlockedUntil(lane: Lane, now: number): number {
    const { limit, remaining, resetAt, observedAt } = this.observed;
    const floor = LANE_HEADER_FLOOR[lane];
    if (floor <= 0 || limit === null || remaining === null || limit <= 0 || observedAt === null) return 0;
    if (remaining / limit >= floor) return 0;
    // Without a reset time, assume a one-minute window from the observation.
    const until = resetAt ?? observedAt + 60_000;
    return until > now ? until : 0;
  }

  /** Grants every waiter that may start now, in lane priority order, and arms a timer for the rest. */
  pump() {
    const now = this.now();
    this.minute.refill(now);
    this.hour.refill(now);

    // Expire before granting slots: a late release must not start an overdue request.
    for (const w of [...this.queue]) {
      if (now >= w.deadline) {
        this.queue.splice(this.queue.indexOf(w), 1);
        this.stats.rejected++;
        w.reject(
          this.pausedUntil > now
            ? this.pausedError()
            : new RateLimitedError(`GitLab request budget exhausted: no slot within ${Math.round(LANE_MAX_WAIT_MS[w.lane] / 1000)} s`, null)
        );
      }
    }


    let nextAt = Infinity;
    for (const lane of LANES) {
      const waiters = this.queue.filter((w) => w.lane === lane);
      for (const w of waiters) {
        if (this.inFlight >= this.maxConcurrent) break;
        const blockedUntil = Math.max(this.pausedUntil, this.headerBlockedUntil(lane, now));
        if (blockedUntil > now) {
          nextAt = Math.min(nextAt, blockedUntil);
          break;
        }
        if (!this.minute.canTake(lane) || !this.hour.canTake(lane)) {
          nextAt = Math.min(nextAt, now + Math.max(this.minute.msUntil(lane), this.hour.msUntil(lane), 10));
          break;
        }
        this.minute.take();
        this.hour.take();
        this.queue.splice(this.queue.indexOf(w), 1);
        this.inFlight++;
        this.stats.sent++;
        let released = false;
        w.resolve(() => {
          if (released) return;
          released = true;
          this.inFlight--;
          this.pump();
        });
      }
    }

    for (const w of this.queue) nextAt = Math.min(nextAt, w.deadline);
    this.arm(nextAt);
  }

  private arm(at: number) {
    if (!Number.isFinite(at)) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      return;
    }
    if (this.timer && this.timerAt <= at) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerAt = at;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, Math.max(0, at - this.now()));
    (this.timer as any).unref?.();
  }
}

/** One scheduler for the process: GitLab budgets are per user account, shared by every client instance. */
export const requestScheduler = new RequestScheduler();

/** Shorthand for background work, such as the auto-fetch cycle and the token expiry scan. */
export const runInLane = <T>(lane: Lane, fn: () => T): T => requestScheduler.runInLane(lane, fn);
