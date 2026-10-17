/**
 * Watches and notifications.
 *
 * - A watch follows one pipeline, job or merge request. The poller checks every active watch and
 *   raises a notification when something worth knowing happens; pipelines and jobs end the watch
 *   when they reach a terminal state, merge requests when they are merged or closed.
 * - Rules turn inbox and runner refreshes into notifications (new review request, new commits on
 *   an MR I review, runner offline) and auto-watch the running pipelines of my own MRs.
 * - Every notification goes to the browser over SSE and to each enabled push channel in the vault.
 *
 * Watch definitions live in the vault so they survive a restart; poll snapshots and the
 * notification history are in memory.
 */
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { GitLabClient, GitLabRunner } from './gitlabClient.js';
import { Inbox } from './inbox.js';
import { channelAccepts, deliver, LazyNotification, NotifyLevel } from './notify.js';
import { vault, WatchRecord } from './vault.js';

const POLL_INTERVAL_MS = 15_000;
const HISTORY_LIMIT = 100;

const TERMINAL = new Set(['success', 'failed', 'canceled', 'skipped', 'manual']);
const ACTIVE_PIPELINE = new Set(['created', 'waiting_for_resource', 'preparing', 'pending', 'running', 'scheduled']);

// ---- evaluation (pure, unit tested) -----------------------------------------

export interface Snapshot {
  status: string;
  /** Merge requests only. */
  pipelineId?: number;
  pipelineStatus?: string;
  conflicts?: boolean;
  failureReason?: string;
}

export interface WatchEvent {
  level: NotifyLevel;
  title: string;
  body: string;
}

const levelFor = (status: string): NotifyLevel =>
  status === 'success' ? 'success' : status === 'failed' ? 'failure' : 'info';

const describeStatus = (status: string) =>
  status === 'manual' ? 'is waiting for a manual action' : status === 'success' ? 'passed' : status;

/**
 * Decides what a status change means. `prev` is undefined on the first observation; for
 * pipelines and jobs that are already finished this still notifies, so a watch added on a
 * pipeline that finished meanwhile is not silent.
 */
export function evaluateWatch(
  watch: Pick<WatchRecord, 'kind' | 'label' | 'target_id'>,
  prev: Snapshot | undefined,
  cur: Snapshot
): { events: WatchEvent[]; done: boolean } {
  if (watch.kind === 'pipeline' || watch.kind === 'job') {
    if (!TERMINAL.has(cur.status)) return { events: [], done: false };
    const noun = watch.kind === 'pipeline' ? `Pipeline #${watch.target_id}` : `Job ${watch.label.split(' · ').pop()}`;
    const reason = cur.failureReason ? ` (${cur.failureReason.replace(/_/g, ' ')})` : '';
    return {
      events: [{ level: levelFor(cur.status), title: `${noun} ${describeStatus(cur.status)}${reason}`, body: watch.label }],
      done: true
    };
  }

  // merge_request
  const events: WatchEvent[] = [];
  if (cur.status === 'merged' || cur.status === 'closed') {
    events.push({ level: cur.status === 'merged' ? 'success' : 'info', title: `MR ${cur.status}`, body: watch.label });
    return { events, done: true };
  }
  if (!prev) return { events, done: false };
  if (cur.conflicts && !prev.conflicts) {
    events.push({ level: 'failure', title: 'MR has merge conflicts', body: watch.label });
  }
  const pipelineFinished =
    cur.pipelineStatus !== undefined &&
    TERMINAL.has(cur.pipelineStatus) &&
    (cur.pipelineId !== prev.pipelineId || cur.pipelineStatus !== prev.pipelineStatus);
  if (pipelineFinished) {
    events.push({
      level: levelFor(cur.pipelineStatus!),
      title: `MR pipeline ${describeStatus(cur.pipelineStatus!)}`,
      body: watch.label
    });
  }
  return { events, done: false };
}

// ---- manager ----------------------------------------------------------------

export interface WatchView extends WatchRecord {
  status?: string;
  checkedAt?: number;
  error?: string;
}

export interface ChannelHealth {
  lastDeliveredAt?: number;
  lastError?: string;
}

class WatchManager extends EventEmitter {
  private getClient: (() => GitLabClient) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private snapshots = new Map<string, Snapshot & { checkedAt: number; error?: string }>();
  private history: LazyNotification[] = [];
  private channelHealth = new Map<string, ChannelHealth>();

  // Rule state. null means "no baseline yet": the first refresh after start records state silently.
  private reviewShas: Map<string, string | undefined> | null = null;
  private runnerStatus: Map<number, string> | null = null;
  private autoWatched = new Set<string>();

  attach(getClient: () => GitLabClient) {
    this.getClient = getClient;
  }

  start() {
    this.stop();
    this.timer = setInterval(() => void this.pollAll(), POLL_INTERVAL_MS);
    void this.pollAll();
  }

  /** Stops polling and forgets in-memory state (called on vault lock and profile switch). */
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.snapshots.clear();
    this.reviewShas = null;
    this.runnerStatus = null;
    this.autoWatched.clear();
  }

  /** stop() plus dropping the notification history (vault lock). */
  reset() {
    this.stop();
    this.history = [];
    this.channelHealth.clear();
  }

  // ---- watches ----

  /** Watches of the active GitLab profile (or demo mode). Others stay stored until that profile is active again. */
  private activeWatches(): WatchRecord[] {
    const profileId = vault.getActiveProfile()?.id ?? null;
    return vault.getNotify().watches.filter((w) => (w.profileId ?? null) === profileId);
  }

  listWatches(): WatchView[] {
    if (!vault.isUnlocked()) return [];
    return this.activeWatches().map((w) => {
      const snap = this.snapshots.get(w.id);
      return { ...w, status: snap?.status, checkedAt: snap?.checkedAt, error: snap?.error };
    });
  }

  async addWatch(input: { kind: WatchRecord['kind']; project_id: number; target_id: number; source: WatchRecord['source'] }): Promise<WatchView> {
    const existing = this.activeWatches().find((w) => w.kind === input.kind && w.project_id === input.project_id && w.target_id === input.target_id);
    if (existing) return this.listWatches().find((w) => w.id === existing.id)!;

    const { label, web_url } = await this.describe(input.kind, input.project_id, input.target_id);
    const record: WatchRecord = {
      id: randomUUID(),
      ...input,
      label,
      web_url,
      profileId: vault.getActiveProfile()?.id ?? null,
      createdAt: new Date().toISOString()
    };
    vault.updateNotify((n) => n.watches.push(record));
    this.emit('watches-changed');
    await this.pollOne(record);
    return this.listWatches().find((w) => w.id === record.id) ?? { ...record };
  }

  removeWatch(id: string) {
    vault.updateNotify((n) => {
      n.watches = n.watches.filter((w) => w.id !== id);
    });
    this.snapshots.delete(id);
    this.emit('watches-changed');
  }

  private async describe(kind: WatchRecord['kind'], projectId: number, targetId: number) {
    const client = this.client();
    const projects = await client.getProjects().catch(() => []);
    const project = projects.find((p) => p.id === projectId)?.name ?? `project ${projectId}`;
    if (kind === 'pipeline') {
      const p = await client.getPipeline(projectId, targetId);
      return { label: `${project} · ${p.ref}`, web_url: p.web_url };
    }
    if (kind === 'job') {
      const j = await client.getJob(projectId, targetId);
      return { label: `${project} · ${j.name}`, web_url: j.web_url ?? '' };
    }
    const mr = await client.getMergeRequest(projectId, targetId);
    return { label: `${project}!${mr.iid} ${mr.title}`, web_url: mr.web_url };
  }

  private client(): GitLabClient {
    if (!this.getClient) throw new Error('Watch manager is not attached');
    return this.getClient();
  }

  private async snapshot(w: WatchRecord): Promise<Snapshot> {
    const client = this.client();
    if (w.kind === 'pipeline') return { status: (await client.getPipeline(w.project_id, w.target_id)).status };
    if (w.kind === 'job') {
      const j = await client.getJob(w.project_id, w.target_id);
      return { status: j.status, failureReason: j.status === 'failed' ? j.failure_reason : undefined };
    }
    const mr = await client.getMergeRequest(w.project_id, w.target_id);
    return { status: mr.state, pipelineId: mr.pipeline?.id, pipelineStatus: mr.pipeline?.status, conflicts: mr.has_conflicts };
  }

  private async pollOne(w: WatchRecord) {
    const prev = this.snapshots.get(w.id);
    let cur: Snapshot;
    try {
      cur = await this.snapshot(w);
    } catch (err: any) {
      if (/\b404\b|not found/i.test(err.message)) {
        this.removeWatch(w.id);
        this.notify({ level: 'info', title: 'Watch removed', body: `${w.label} no longer exists`, source: 'watch' });
        return;
      }
      this.snapshots.set(w.id, { ...(prev ?? { status: 'unknown' }), checkedAt: Date.now(), error: err.message });
      return;
    }
    const { events, done } = evaluateWatch(w, prev, cur);
    this.snapshots.set(w.id, { ...cur, checkedAt: Date.now() });
    for (const e of events) this.notify({ ...e, url: w.web_url, source: 'watch' });
    if (done) this.removeWatch(w.id);
    else if (!prev || prev.status !== cur.status) this.emit('watches-changed');
  }

  async pollAll() {
    if (this.polling || !vault.isUnlocked() || !this.getClient) return;
    this.polling = true;
    try {
      for (const w of this.activeWatches()) await this.pollOne(w);
    } finally {
      this.polling = false;
    }
  }

  // ---- rules ----

  /** Called after every inbox refresh. */
  async onInbox(inbox: Inbox) {
    if (!vault.isUnlocked() || !inbox.user || inbox.errors.length > 0) return;
    const rules = vault.getNotify().rules;
    const me = inbox.user.username;

    if (rules.myMrPipelines) {
      for (const item of inbox.items) {
        const mr = item.merge_request;
        if (!mr || mr.author.username !== me || !mr.pipeline || !ACTIVE_PIPELINE.has(mr.pipeline.status)) continue;
        const key = `${mr.project_id}:${mr.pipeline.id}`;
        if (this.autoWatched.has(key)) continue;
        this.autoWatched.add(key);
        await this.addWatch({ kind: 'pipeline', project_id: mr.project_id, target_id: mr.pipeline.id, source: 'auto' }).catch(
          (err) => console.warn('Auto-watch failed:', err.message)
        );
      }
    }

    const reviewing = inbox.items.filter((i) => i.merge_request && i.reason.startsWith('Review requested'));
    const current = new Map(reviewing.map((i) => [i.key, i.merge_request!.sha]));
    if (this.reviewShas) {
      for (const item of reviewing) {
        const known = this.reviewShas.has(item.key);
        const prevSha = this.reviewShas.get(item.key);
        if (!known && rules.reviewRequests) {
          this.notify({
            level: 'info',
            title: 'Review requested',
            body: `${item.reference ?? ''} ${item.title}${item.author ? ` by @${item.author.username}` : ''}`.trim(),
            url: item.web_url,
            source: 'review'
          });
        } else if (known && rules.reReview && prevSha && item.merge_request!.sha && prevSha !== item.merge_request!.sha) {
          this.notify({
            level: 'info',
            title: 'New commits on an MR you review',
            body: `${item.reference ?? ''} ${item.title}`.trim(),
            url: item.web_url,
            source: 'review'
          });
        }
      }
    }
    this.reviewShas = current;
  }

  /** Called after every runner refresh. */
  onRunners(runners: GitLabRunner[]) {
    if (!vault.isUnlocked()) return;
    const current = new Map(runners.map((r) => [r.id, r.status]));
    if (this.runnerStatus && vault.getNotify().rules.runnerOffline) {
      for (const r of runners) {
        const before = this.runnerStatus.get(r.id);
        if (before === 'online' && (r.status === 'offline' || r.status === 'not_connected')) {
          this.notify({ level: 'failure', title: 'Runner offline', body: `${r.description} (#${r.id})`, source: 'runner' });
        } else if (before && before !== 'online' && before !== 'paused' && r.status === 'online') {
          this.notify({ level: 'success', title: 'Runner back online', body: `${r.description} (#${r.id})`, source: 'runner' });
        }
      }
    }
    this.runnerStatus = current;
  }

  // ---- notifications ----

  notify(input: Omit<LazyNotification, 'id' | 'createdAt' | 'read'>): LazyNotification {
    const n: LazyNotification = { ...input, id: randomUUID(), createdAt: Date.now(), read: false };
    this.history.unshift(n);
    this.history.length = Math.min(this.history.length, HISTORY_LIMIT);
    this.emit('notification', n);
    if (vault.isUnlocked()) {
      for (const channel of vault.getNotify().channels) {
        if (!channelAccepts(channel, n)) continue;
        this.deliverTo(channel.id, n).catch(() => undefined); // failure is recorded in channel health
      }
    }
    return n;
  }

  /** Delivers to one channel and records the outcome. Rejects so a test send can report the error. */
  async deliverTo(channelId: string, n: LazyNotification): Promise<void> {
    const channel = vault.getNotify().channels.find((c) => c.id === channelId);
    if (!channel) throw new Error('Channel not found');
    try {
      await deliver(channel, n);
      this.channelHealth.set(channelId, { lastDeliveredAt: Date.now() });
    } catch (err: any) {
      this.channelHealth.set(channelId, { ...this.channelHealth.get(channelId), lastError: err.message });
      console.warn(`Notification channel "${channel.name}" failed:`, err.message);
      throw err;
    }
  }

  getChannelHealth(id: string): ChannelHealth {
    return this.channelHealth.get(id) ?? {};
  }

  listNotifications(): LazyNotification[] {
    return this.history;
  }

  markAllRead() {
    for (const n of this.history) n.read = true;
  }

  clearNotifications() {
    this.history = [];
  }
}

export const watchManager = new WatchManager();
