/**
 * Token expiry tracking (ENV-4): which GitLab tokens expire soon, and which warnings are due.
 * The pure functions decide; TokenExpiryMonitor collects tokens and sends the warnings.
 */
import { GitLabClient } from './gitlabClient.js';
import { vault } from './vault.js';

export type TrackedTokenKind = 'personal' | 'project' | 'group' | 'deploy';

export interface TrackedToken {
  /** Stable per token: a rotated token has a new id, so its warnings start over. */
  key: string;
  kind: TrackedTokenKind;
  name: string;
  /** Profile name for personal tokens, project or group path otherwise. */
  owner: string;
  host: string;
  expires_at: string | null;
  days_left: number | null;
  scopes: string[];
  last_used_at?: string | null;
  /** Where the token is managed in GitLab. */
  web_url?: string;
  /** Personal tokens of a vault profile can be rotated from lazylab. */
  profileId?: string;
}

export interface TokenOverview {
  tokens: TrackedToken[];
  /** Sources that could not be read, e.g. "work: GitLab API Error (401)". */
  errors: string[];
  checkedAt: number;
}

/** Warning points in days before expiry; 0 means expired. */
export const WARN_THRESHOLDS = [14, 7, 3, 1, 0] as const;

const DAY_MS = 86_400_000;

/**
 * Calendar days from today (UTC) to expires_at, as GitLab shows them. GitLab revokes the token at
 * 00:00 UTC on expires_at, so 1 means today is the last day it works and 0 or less means expired.
 */
export function daysLeft(expiresAt: string | null | undefined, now = Date.now()): number | null {
  if (!expiresAt) return null;
  const at = Date.parse(`${expiresAt.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(at)) return null;
  return Math.round(at / DAY_MS) - Math.floor(now / DAY_MS);
}

/** The tightest threshold the token has reached, or null when it is further out than all of them. */
export function thresholdFor(days: number | null): number | null {
  if (days === null) return null;
  let reached: number | null = null;
  for (const t of WARN_THRESHOLDS) if (days <= t) reached = t;
  return reached;
}

/**
 * Warnings to send now. `warned` maps token key → the last threshold warned about; a token is
 * warned again only when it crosses a tighter threshold.
 */
export function dueWarnings(tokens: TrackedToken[], warned: Record<string, number>): { token: TrackedToken; threshold: number }[] {
  const due: { token: TrackedToken; threshold: number }[] = [];
  for (const token of tokens) {
    const threshold = thresholdFor(token.days_left);
    if (threshold === null) continue;
    const last = warned[token.key];
    if (last === undefined || threshold < last) due.push({ token, threshold });
  }
  return due;
}

export function describeExpiry(days: number | null): string {
  if (days === null) return 'never expires';
  if (days === 0) return 'expired today';
  if (days < 0) return `expired ${-days} day${days === -1 ? '' : 's'} ago`;
  if (days === 1) return 'expires tonight (00:00 UTC)';
  return `expires in ${days} day${days === 1 ? '' : 's'}`;
}

export function warningText(token: TrackedToken): { title: string; body: string } {
  const kind = { personal: 'Personal access token', project: 'Project access token', group: 'Group access token', deploy: 'Deploy token' }[token.kind];
  const days = token.days_left;
  const title = days !== null && days <= 0 ? `GitLab token expired` : `GitLab token ${describeExpiry(days)}`;
  return { title, body: `${kind} "${token.name}" · ${token.owner} · ${token.expires_at}` };
}

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type Notify = (n: { level: 'failure' | 'info'; title: string; body: string; url?: string; source: string }) => void;

export class TokenExpiryMonitor {
  private timer: NodeJS.Timeout | null = null;
  private overview: TokenOverview | null = null;
  private running: Promise<TokenOverview> | null = null;

  constructor(private getActiveClient: () => GitLabClient, private notify: Notify) {}

  start() {
    this.stop();
    this.check().catch((err) => console.warn('Token expiry check failed:', err?.message ?? err));
    this.timer = setInterval(() => {
      this.check().catch((err) => console.warn('Token expiry check failed:', err?.message ?? err));
    }, CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  reset() {
    this.stop();
    this.overview = null;
  }

  /** Last result, or a fresh check when there is none or `force` is set. */
  async getOverview(force = false): Promise<TokenOverview> {
    if (this.overview && !force) return this.overview;
    return this.check();
  }

  /** Collects tokens and sends due warnings. Concurrent callers share one run. */
  check(): Promise<TokenOverview> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async run(): Promise<TokenOverview> {
    const now = Date.now();
    const tokens: TrackedToken[] = [];
    const errors: string[] = [];

    // Personal access token of every profile, not only the active one: each can expire.
    for (const summary of vault.listProfiles()) {
      const profile = vault.getProfile(summary.id);
      try {
        const self = await new GitLabClient(profile.host, profile.token).getPersonalAccessTokenSelf();
        tokens.push({
          key: `personal:${profile.id}:${self.id}`,
          kind: 'personal',
          name: self.name,
          owner: profile.name,
          host: profile.host,
          expires_at: self.expires_at,
          days_left: daysLeft(self.expires_at, now),
          scopes: self.scopes,
          last_used_at: self.last_used_at,
          web_url: `${profile.host}/-/user_settings/personal_access_tokens`,
          profileId: profile.id
        });
      } catch (err: any) {
        errors.push(`${profile.name}: ${err?.message ?? err}`);
      }
    }

    // Project, group and deploy tokens of the projects the active profile aggregates.
    const client = this.getActiveClient();
    try {
      const { tokens: resourceTokens, errors: resourceErrors } = await client.getResourceTokens();
      for (const t of resourceTokens) tokens.push({ ...t, days_left: daysLeft(t.expires_at, now) });
      errors.push(...resourceErrors);
    } catch (err: any) {
      errors.push(`projects: ${err?.message ?? err}`);
    }

    tokens.sort((a, b) => (a.days_left ?? Infinity) - (b.days_left ?? Infinity));
    this.overview = { tokens, errors, checkedAt: now };
    this.sendWarnings(tokens);
    return this.overview;
  }

  private sendWarnings(tokens: TrackedToken[]) {
    if (!vault.isUnlocked()) return;
    const settings = vault.getNotify();
    const warned = settings.expiryWarned ?? {};
    const due = settings.rules.tokenExpiry ? dueWarnings(tokens, warned) : [];
    for (const { token } of due) {
      const { title, body } = warningText(token);
      this.notify({ level: (token.days_left ?? 99) <= 3 ? 'failure' : 'info', title, body, url: token.web_url, source: 'token' });
    }
    // Keep only tokens that still exist, so the map does not grow with rotated tokens.
    const live = new Set(tokens.map((t) => t.key));
    const next: Record<string, number> = {};
    for (const [key, t] of Object.entries(warned)) if (live.has(key)) next[key] = t;
    for (const { token, threshold } of due) next[token.key] = threshold;
    const changed = JSON.stringify(next) !== JSON.stringify(warned);
    if (changed) vault.updateNotify((n) => void (n.expiryWarned = next));
  }
}
