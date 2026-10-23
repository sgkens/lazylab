/** Optional adapter to the independent BugKB service. Its hooks own deduplication and trust. */
export interface KnowledgeEntry {
  id: string;
  type: string;
  title: string;
  status: string;
  project: string;
  hits: number;
  seen_in: string[];
  tags: string[];
  symptom: string;
  cause: string;
  fix: string;
  env: Record<string, string>;
  metrics: Record<string, unknown>;
  updated: string;
  notes?: string;
  verification?: string;
  truncated: boolean;
}

export interface KnowledgeFinding {
  type: 'bug' | 'gotcha' | 'perf';
  title: string;
  symptom?: string;
  cause?: string;
  fix: string;
  tags: string[];
  env: Record<string, string>;
  verification: string;
  scope?: 'general' | 'project';
  metrics?: { metric: string; before: number; after: number; unit: string; conditions: string };
}

export interface KnowledgeSearch {
  query: string;
  type?: 'bug' | 'gotcha' | 'perf';
  tag?: string;
  limit?: number;
}

export interface BriefingKnowledge {
  status: 'disabled' | 'available' | 'partial' | 'unavailable';
  queries: string[];
  entries: KnowledgeEntry[];
  errors: string[];
}

// Match recognizable credentials before task text leaves lazylab. This is not a general secret detector.
const CREDENTIALS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:llab_|glpat-|ghp_|github_pat_|xox[baprs]-|sk-)[A-Za-z0-9_-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9_.~+\/-]{8,}=*/gi,
  /\b(password|passwd|secret|token|api[_-]?key)["']?\s*[=:]\s*["']?[^\s"',}\]]{8,}/gi,
  /https?:\/\/[^\s/@]+:[^\s/@]+@/gi
];

export function redactKnowledgeText(value: string): string {
  return CREDENTIALS.reduce((text, pattern) => text.replace(pattern, '<REDACTED>'), value);
}

const nonempty = (value: unknown, field: string, max: number, min = 1): string => {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new Error(`${field} must contain ${min}–${max} characters`);
  return value.trim();
};

function object(value: unknown, field: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value as Record<string, any>;
}

function onlyFields(value: Record<string, unknown>, allowed: string[]) {
  for (const field of Object.keys(value)) if (!allowed.includes(field)) throw new Error(`unknown finding field "${field}"`);
}

export function knowledgeEnvironment(value: unknown): Record<string, string> {
  const raw = object(value ?? {}, 'env');
  if (Object.keys(raw).length > 30) throw new Error('env accepts at most 30 version/OS fields');
  return Object.fromEntries(Object.entries(raw).map(([key, v]) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('invalid env key');
    return [nonempty(key, 'env key', 80), nonempty(v, `env.${key}`, 200)];
  }));
}

function rejectCredentials(value: unknown) {
  const serialized = JSON.stringify(value);
  if (redactKnowledgeText(serialized) !== serialized) throw new Error('Finding contains a recognizable credential. Replace it with a placeholder before sending to BugKB.');
}

export function parseKnowledgeFinding(value: unknown): KnowledgeFinding {
  const raw = object(value, 'finding');
  onlyFields(raw, ['type', 'title', 'symptom', 'cause', 'fix', 'tags', 'env', 'verification', 'scope', 'metrics']);
  if (!['bug', 'gotcha', 'perf'].includes(raw.type)) throw new Error('type must be bug, gotcha or perf');
  if (!Array.isArray(raw.tags) || !raw.tags.length || raw.tags.length > 20) throw new Error('tags needs 1–20 technology tags');
  const parsed: KnowledgeFinding = {
    type: raw.type, title: nonempty(raw.title, 'title', 300, 8), fix: nonempty(raw.fix, 'fix', 12_000),
    verification: nonempty(raw.verification, 'verification', 4000), env: knowledgeEnvironment(raw.env),
    tags: [...new Set<string>(raw.tags.map((v: unknown) => nonempty(v, 'tag', 80).toLowerCase()))]
  };
  if (!Object.keys(parsed.env).length) throw new Error('env must name at least one verified version or OS');
  if (raw.type !== 'perf' || raw.symptom !== undefined) parsed.symptom = nonempty(raw.symptom, 'symptom', 12_000);
  if (raw.cause !== undefined) parsed.cause = nonempty(raw.cause, 'cause', 12_000);
  if (raw.scope !== undefined) {
    if (raw.scope !== 'general' && raw.scope !== 'project') throw new Error('scope must be general or project');
    parsed.scope = raw.scope;
  }
  if (raw.metrics !== undefined || raw.type === 'perf') {
    const m = object(raw.metrics, 'metrics');
    onlyFields(m, ['metric', 'before', 'after', 'unit', 'conditions']);
    if (typeof m.before !== 'number' || !Number.isFinite(m.before) || m.before < 0 || typeof m.after !== 'number' || !Number.isFinite(m.after) || m.after < 0) {
      throw new Error('metrics.before and metrics.after must be finite nonnegative numbers');
    }
    parsed.metrics = { metric: nonempty(m.metric, 'metric', 100), before: m.before, after: m.after,
      unit: nonempty(m.unit, 'unit', 40), conditions: nonempty(m.conditions, 'conditions', 1000) };
  }
  rejectCredentials(parsed);
  return parsed;
}

function entry(raw: any, compact = false): KnowledgeEntry {
  if (!raw || typeof raw.id !== 'string' || typeof raw.title !== 'string') throw new Error('BugKB returned an invalid entry');
  let truncated = false;
  const clip = (value: unknown, max: number) => {
    const text = redactKnowledgeText(typeof value === 'string' ? value : '');
    if (text.length > max) truncated = true;
    return text.slice(0, max);
  };
  const strings = (v: unknown, max = 20) => Array.isArray(v) ? v.slice(0, max).filter((x) => typeof x === 'string').map((x) => clip(x, 200)) : [];
  const env = raw.env && typeof raw.env === 'object' && !Array.isArray(raw.env) ? raw.env : {};
  const verification = typeof raw.fix === 'string' && raw.fix.includes('\n\nVerification: ')
    ? raw.fix.slice(raw.fix.lastIndexOf('\n\nVerification: ') + 16) : undefined;
  return {
    id: clip(raw.id, 64), title: clip(raw.title, 300), type: clip(raw.type, 30),
    status: ['confirmed', 'unverified', 'obsolete'].includes(raw.status) ? raw.status : 'unknown',
    project: clip(raw.project, 200), hits: Number.isSafeInteger(raw.hits) && raw.hits >= 0 ? raw.hits : 0,
    seen_in: strings(raw.seen_in), tags: strings(raw.tags),
    symptom: clip(raw.symptom, compact ? 700 : 20_000), cause: clip(raw.cause, compact ? 500 : 20_000), fix: clip(raw.fix, compact ? 1500 : 20_000),
    env: Object.fromEntries(Object.entries(env).slice(0, 20).map(([k, v]) => [clip(k, 80), clip(typeof v === 'string' ? v : JSON.stringify(v), 200)])),
    metrics: Object.fromEntries(['metric', 'before', 'after', 'unit', 'conditions'].filter((k) => raw.metrics?.[k] !== undefined)
      .map((k) => [k, typeof raw.metrics[k] === 'number' ? raw.metrics[k] : clip(raw.metrics[k], compact ? 200 : 1000)])),
    updated: clip(raw.updated, 100), notes: clip(raw.notes, compact ? 800 : 20_000),
    ...(verification ? { verification: clip(verification, compact ? 700 : 4000) } : {}), truncated
  };
}

class BugKbRejectedError extends Error {}

export class BugKbClient {
  constructor(private readonly configuredUrl = process.env.LAZYLAB_BUGKB_URL, private readonly timeoutMs = 1500) {}

  get enabled() { return Boolean(this.configuredUrl?.trim()); }

  private baseUrl() {
    if (!this.enabled) throw new Error('BugKB is disabled. Set LAZYLAB_BUGKB_URL to the service base URL.');
    let url: URL;
    try { url = new URL(this.configuredUrl!.trim()); } catch { throw new Error('LAZYLAB_BUGKB_URL must be an HTTP(S) service base URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('LAZYLAB_BUGKB_URL must be HTTP(S), without credentials, query or fragment');
    }
    return url.href.replace(/\/+$/, '') + '/';
  }

  private async request(method: 'GET' | 'POST', route: string, project = 'lazylab', body?: unknown) {
    const url = new URL(`api/${route}`, this.baseUrl());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method, redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-KB-Project': project },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 1_000_000) { await reader.cancel(); throw new Error('BugKB response exceeds 1 MB'); }
        chunks.push(next.value);
      }
      let data: any;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new Error('BugKB returned invalid JSON; check the configured service and hooks'); }
      if (!response.ok) {
        if (response.status === 409) {
          const match = typeof data.message === 'string' ? /\[[\s\S]*\]/.exec(data.message) : null;
          let candidates = '';
          try { candidates = JSON.parse(match?.[0] ?? '[]').slice(0, 3).map((d: any) => `${String(d.id).slice(0, 64)}: ${redactKnowledgeText(String(d.title)).slice(0, 300)}`).join('; '); } catch {}
          throw new BugKbRejectedError(`BugKB refused a duplicate${candidates ? ` (${candidates})` : ''}. Inspect the existing entry, then confirm it only if its fix was verified here. Nothing was added.`);
        }
        const ErrorType = [400, 401, 403, 404, 422].includes(response.status) ? BugKbRejectedError : Error;
        throw new ErrorType(`BugKB HTTP ${response.status}: ${redactKnowledgeText(String(data.message || 'request rejected')).slice(0, 1000)}`);
      }
      return data;
    } catch (err: any) {
      if (err instanceof BugKbRejectedError) throw err;
      const message = controller.signal.aborted ? 'BugKB request timed out' : err?.message || 'BugKB request failed';
      throw new Error(`${redactKnowledgeText(message)}${method === 'POST' ? '. Write outcome may be unknown; search/read before retrying. No automatic retry was made.' : ''}`);
    } finally { clearTimeout(timer); }
  }

  private id(value: unknown) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new Error('entry_id must be a BugKB record ID');
    return value;
  }

  private async requireHooks() {
    const info = await this.request('GET', 'kb/info');
    if (info?.hooks !== 1) throw new Error('BugKB hooks are unavailable; refusing to write without its validation and trust rules');
  }

  async search(input: KnowledgeSearch): Promise<{ query: string; entries: KnowledgeEntry[] }> {
    const query = redactKnowledgeText(nonempty(input.query, 'query', 2000));
    const limit = input.limit ?? 5;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('limit must be between 1 and 10');
    if (input.type !== undefined && !['bug', 'gotcha', 'perf'].includes(input.type)) throw new Error('type must be bug, gotcha or perf');
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (input.type) params.set('type', input.type);
    if (input.tag !== undefined) params.set('tag', redactKnowledgeText(nonempty(input.tag, 'tag', 80)));
    const data = await this.request('GET', `kb/search?${params}`);
    if (!Array.isArray(data?.items)) throw new Error('BugKB returned an invalid search response');
    return { query, entries: data.items.filter((r: any) => r.status !== 'obsolete').slice(0, limit).map((r: any) => entry(r, true)) };
  }

  async get(entryId: string): Promise<KnowledgeEntry> {
    return entry(await this.request('GET', `collections/entries/records/${this.id(entryId)}`));
  }

  async record(project: string, value: unknown): Promise<KnowledgeEntry> {
    const parsed = parseKnowledgeFinding(value);
    project = nonempty(project, 'project', 200);
    rejectCredentials(project);
    await this.requireHooks();
    // BugKB clears creation notes for agents. Keep verification in the persisted fix, not discarded notes.
    const { verification, ...fields } = parsed;
    return entry(await this.request('POST', 'collections/entries/records', project, {
      ...fields, project, fix: `${parsed.fix}\n\nVerification: ${verification}`
    }));
  }

  async confirm(project: string, entryId: string, verification: string, env: unknown = {}): Promise<KnowledgeEntry> {
    const id = this.id(entryId);
    const note = nonempty(verification, 'verification', 4000);
    const environment = knowledgeEnvironment(env);
    project = nonempty(project, 'project', 200);
    rejectCredentials({ project, note, env: environment });
    await this.requireHooks();
    return entry(await this.request('POST', `kb/confirm/${id}`, project, { project, note, env: environment }));
  }
}

/** Search error lines separately so generic title words do not hide the distinctive failure. */
export async function briefingKnowledge(client: BugKbClient, title: string, labels: string[], errorLines: string[]): Promise<BriefingKnowledge> {
  if (!client.enabled) return { status: 'disabled', queries: [], entries: [], errors: [] };
  const queries = [...new Set([...errorLines.filter(Boolean).slice(0, 2), [title, ...labels.slice(0, 8)].join(' ')]
    .map((q) => redactKnowledgeText(q).replace(/\s+/g, ' ').trim().slice(0, 600)).filter(Boolean))];
  const results = await Promise.allSettled(queries.map((query) => client.search({ query, limit: 5 })));
  const errors: string[] = [];
  const found = new Map<string, KnowledgeEntry>();
  for (const result of results) {
    if (result.status === 'rejected') errors.push(result.reason?.message || 'BugKB search failed');
    else for (const item of result.value.entries) if (!found.has(item.id)) found.set(item.id, item);
  }
  // Prefer confirmed matches, preserving BugKB's ranking within each trust level.
  const entries = [...found.values()].sort((a, b) => Number(b.status === 'confirmed') - Number(a.status === 'confirmed')).slice(0, 5);
  return { status: errors.length ? results.every((r) => r.status === 'rejected') ? 'unavailable' : 'partial' : 'available', queries, entries, errors: [...new Set(errors)] };
}
