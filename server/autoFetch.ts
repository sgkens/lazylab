// Background auto-fetch loop: at most one cycle in flight, and the next cycle is scheduled only after
// the previous one finished, so slow cycles never stack (GL-20).

export const MIN_AUTOFETCH_SEC = 30;
export const MAX_AUTOFETCH_SEC = 3600;

/**
 * Validates an auto-fetch interval from a request body. Returns whole seconds:
 * 0 (off) or MIN_AUTOFETCH_SEC..MAX_AUTOFETCH_SEC. Throws with a user-facing message otherwise.
 */
export function parseAutoFetchInterval(value: unknown): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error('intervalSec must be a whole number of seconds');
  }
  if (n === 0) return 0;
  if (n < MIN_AUTOFETCH_SEC || n > MAX_AUTOFETCH_SEC) {
    throw new Error(`intervalSec must be 0 (off) or between ${MIN_AUTOFETCH_SEC} and ${MAX_AUTOFETCH_SEC}`);
  }
  return n;
}

/** Brings a persisted value into range, so a hand-edited settings file cannot set a 1 s loop. */
export function clampAutoFetchInterval(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return n === 0 ? 0 : MIN_AUTOFETCH_SEC;
  return Math.min(MAX_AUTOFETCH_SEC, Math.max(MIN_AUTOFETCH_SEC, n));
}

export interface AutoFetchStatus {
  intervalSec: number;
  running: boolean;
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
  lastDurationMs: number | null;
  /** Requests to start a cycle that joined the one already in flight. */
  skippedCycles: number;
  nextRunAt: number | null;
}

export class AutoFetchLoop {
  private intervalSec: number;
  private enabled = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private rerunRequested = false;
  private lastStartedAt: number | null = null;
  private lastFinishedAt: number | null = null;
  private lastDurationMs: number | null = null;
  private skippedCycles = 0;
  private nextRunAt: number | null = null;

  constructor(
    private readonly runCycle: () => Promise<void>,
    intervalSec: number
  ) {
    this.intervalSec = clampAutoFetchInterval(intervalSec);
  }

  /** Enables the timer (vault unlocked). Does not run a cycle by itself. */
  start() {
    this.enabled = true;
    if (!this.inFlight) this.schedule();
  }

  /** Disables the timer (vault locked). A cycle already in flight finishes but schedules nothing. */
  stop() {
    this.enabled = false;
    this.rerunRequested = false;
    this.clearTimer();
  }

  setInterval(sec: number) {
    this.intervalSec = clampAutoFetchInterval(sec);
    if (this.enabled && !this.inFlight) this.schedule();
  }

  getInterval() {
    return this.intervalSec;
  }

  isRunning() {
    return this.inFlight !== null;
  }

  /**
   * Starts a cycle, or joins the one in flight. With `rerun`, a cycle requested while another is running
   * (for example after a profile switch) runs once more when the current one ends instead of being dropped.
   */
  run(opts: { rerun?: boolean } = {}): Promise<void> {
    if (this.inFlight) {
      if (opts.rerun) this.rerunRequested = true;
      else this.skippedCycles++;
      return this.inFlight;
    }
    this.clearTimer();
    const started = Date.now();
    this.lastStartedAt = started;
    this.inFlight = (async () => {
      try {
        await this.runCycle();
      } catch (err: any) {
        console.warn('Auto-fetch cycle failed:', err?.message ?? err);
      } finally {
        this.lastFinishedAt = Date.now();
        this.lastDurationMs = this.lastFinishedAt - started;
        this.inFlight = null;
        if (this.rerunRequested && this.enabled) {
          this.rerunRequested = false;
          void this.run();
        } else {
          this.schedule();
        }
      }
    })();
    return this.inFlight;
  }

  getStatus(): AutoFetchStatus {
    return {
      intervalSec: this.intervalSec,
      running: this.inFlight !== null,
      lastStartedAt: this.lastStartedAt,
      lastFinishedAt: this.lastFinishedAt,
      lastDurationMs: this.lastDurationMs,
      skippedCycles: this.skippedCycles,
      nextRunAt: this.nextRunAt
    };
  }

  private schedule() {
    this.clearTimer();
    if (!this.enabled || this.intervalSec <= 0) return;
    const delay = this.intervalSec * 1000;
    this.nextRunAt = Date.now() + delay;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, delay);
    // The loop must not keep a test runner or a shutting-down process alive.
    (this.timer as any).unref?.();
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextRunAt = null;
  }
}
