import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import express from 'express';
import type { Server } from 'http';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { briefingKnowledge, BugKbClient, parseKnowledgeFinding, redactKnowledgeText } from '../server/bugkb.ts';
import { buildTaskBriefing } from '../server/briefing.ts';
import { GitLabClient } from '../server/gitlabClient.ts';
import { createMcpRouter, handleMessage, listTools } from '../server/mcp.ts';
import { vault } from '../server/vault.ts';

const finding = { type: 'bug', title: 'Bun cache expiry retains stale entries', symptom: 'Expired cache entries are still returned',
  cause: 'Read path does not compare the expiry time', fix: 'Exclude expired entries from normal reads', tags: ['bun', 'sqlite'],
  env: { bun: '1.3.11', os: 'linux' }, verification: 'Expiry regression check passed; stale offline reads still work' };
const sample = { id: 'abc123entry00001', ...finding, type: 'bug', status: 'unverified', project: 'first-app',
  hits: 1, seen_in: ['first-app'], notes: '', metrics: {}, updated: '2026-10-20 00:00:00.000Z' };

function serve(handler: (req: Request, url: URL) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (req) => handler(req, new URL(req.url)) });
  return { server, url: `http://127.0.0.1:${server.port}` };
}

describe('finding validation and credential handling', () => {
  test('requires reusable evidence, environment and technology tags; trust cannot be supplied', () => {
    expect(parseKnowledgeFinding(finding).tags).toEqual(['bun', 'sqlite']);
    for (const extra of ['status', 'hits', 'seen_in', 'source', 'project', 'force', 'notes']) {
      expect(() => parseKnowledgeFinding({ ...finding, [extra]: 'forged' })).toThrow('unknown finding field');
    }
    expect(() => parseKnowledgeFinding({ ...finding, verification: '' })).toThrow('verification');
    expect(() => parseKnowledgeFinding({ ...finding, env: {} })).toThrow('env');
    expect(() => parseKnowledgeFinding({ ...finding, tags: [] })).toThrow('tags');
    expect(() => parseKnowledgeFinding({ ...finding, env: { bun: { version: '1' } } })).toThrow('env.bun');
    expect(() => parseKnowledgeFinding({ ...finding, type: 'perf' })).toThrow('metrics');
    expect(() => parseKnowledgeFinding({ ...finding, type: 'perf', metrics: { before: 10, after: NaN } })).toThrow('finite');
    expect(parseKnowledgeFinding({ ...finding, type: 'perf', metrics: { metric: 'query', before: 10, after: 2, unit: 'ms', conditions: '1000 rows' } }).metrics!.after).toBe(2);
  });

  test('rejects recognizable credentials in records and redacts them from search text', () => {
    const secret = `llab_${'x'.repeat(40)}`;
    expect(redactKnowledgeText(`Error ${secret} password=super-secret-value https://user:pass@host/path`)).not.toContain(secret);
    expect(redactKnowledgeText('https://user:pass@host/path')).not.toContain('user:pass');
    expect(redactKnowledgeText('Bearer abcdefgh12345')).toBe('<REDACTED>');
    expect(() => parseKnowledgeFinding({ ...finding, symptom: `Failed with ${secret}` })).toThrow('credential');
    expect(() => parseKnowledgeFinding({ ...finding, env: { token: secret } })).toThrow('credential');
    expect(redactKnowledgeText('TypeError: SQLite cache eviction failed')).toBe('TypeError: SQLite cache eviction failed');
  });
});

describe('BugKB HTTP adapter', () => {
  test('searches with filters, preserves trust and bounds excerpts; full reads preserve evidence', async () => {
    const kb = serve((_req, url) => {
      if (url.pathname.endsWith('/search')) {
        expect(url.searchParams.get('tag')).toBe('sqlite');
        expect(url.searchParams.get('type')).toBe('bug');
        expect(url.searchParams.get('limit')).toBe('2');
        expect(url.searchParams.get('q')).not.toContain('llab_');
        return Response.json({ items: [{ ...sample, status: 'confirmed', hits: 3, fix: 'x'.repeat(3000) }, { ...sample, id: 'obsolete', status: 'obsolete' }] });
      }
      return Response.json({ ...sample, fix: `${sample.fix}\nVerification: passed all expiry checks`, notes: 'Confirmed on another platform' });
    });
    try {
      const client = new BugKbClient(kb.url);
      const result = await client.search({ query: `cache llab_${'z'.repeat(40)}`, tag: 'sqlite', type: 'bug', limit: 2 });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].status).toBe('confirmed');
      expect(result.entries[0].fix.length).toBe(1500);
      expect(result.entries[0].truncated).toBe(true);
      const full = await client.get(sample.id);
      expect(full.fix).toContain('Verification: passed');
      expect(full.notes).toContain('another platform');
      await expect(client.get('../entries')).rejects.toThrow('entry_id');
    } finally { kb.server.stop(true); }
  });

  test('writes verification inside the fix and lets server hooks own initial trust', async () => {
    let posted: any;
    const methods: string[] = [];
    const kb = serve(async (req, url) => {
      methods.push(req.method);
      if (url.pathname.endsWith('/info')) return Response.json({ hooks: 1 });
      expect(req.headers.get('X-KB-Project')).toBe('lazylab');
      posted = await req.json();
      return Response.json({ ...sample, ...posted, status: 'unverified' });
    });
    try {
      const result = await new BugKbClient(kb.url).record('lazylab', finding);
      expect(methods).toEqual(['GET', 'POST']);
      expect(posted.fix).toContain(`Verification: ${finding.verification}`);
      expect(posted).not.toHaveProperty('verification');
      expect(posted).not.toHaveProperty('status');
      expect(posted).not.toHaveProperty('notes');
      expect(posted.project).toBe('lazylab');
      expect(result.status).toBe('unverified');
    } finally { kb.server.stop(true); }
  });

  test('refuses writes without hooks and refuses secrets before sending requests', async () => {
    let requests = 0;
    const kb = serve(() => { requests++; return Response.json({ hooks: 0 }); });
    try {
      const client = new BugKbClient(kb.url);
      await expect(client.record('lazylab', finding)).rejects.toThrow('hooks');
      expect(requests).toBe(1);
      await expect(client.record('lazylab', { ...finding, fix: `glpat-${'x'.repeat(30)}` })).rejects.toThrow('credential');
      await expect(client.confirm('lazylab', sample.id, `token=secretvalue123`)).rejects.toThrow('credential');
      expect(requests).toBe(1);
    } finally { kb.server.stop(true); }
  });

  test('duplicate refusal includes the existing ID and never forces or retries a write', async () => {
    let posts = 0;
    const kb = serve((req, url) => {
      if (url.pathname.endsWith('/info')) return Response.json({ hooks: 1 });
      expect(req.headers.has('X-KB-Force')).toBe(false);
      posts++;
      return Response.json({ message: `Duplicate: ${JSON.stringify([{ id: sample.id, title: sample.title, similarity: 0.9 }])}` }, { status: 409 });
    });
    try {
      await expect(new BugKbClient(kb.url).record('lazylab', finding)).rejects.toThrow(sample.id);
      expect(posts).toBe(1);
    } finally { kb.server.stop(true); }
  });

  test('confirmations carry project, checked evidence and tested versions', async () => {
    const kb = serve(async (req, url) => {
      if (url.pathname.endsWith('/info')) return Response.json({ hooks: 1 });
      expect(url.pathname).toBe(`/api/kb/confirm/${sample.id}`);
      expect(await req.json()).toEqual({ project: 'second-app', note: 'Expiry checks passed', env: { bun: '1.3.11' } });
      return Response.json({ ...sample, status: 'confirmed', hits: 2, seen_in: ['first-app', 'second-app'] });
    });
    try {
      const result = await new BugKbClient(kb.url).confirm('second-app', sample.id, 'Expiry checks passed', { bun: '1.3.11' });
      expect(result.status).toBe('confirmed');
      expect(result.hits).toBe(2);
    } finally { kb.server.stop(true); }
  });

  test('bounds slow reads and warns about an uncertain write outcome without retrying', async () => {
    let posts = 0;
    const kb = serve(async (req, url) => {
      if (url.pathname.endsWith('/info')) return Response.json({ hooks: 1 });
      if (req.method === 'POST') posts++;
      await Bun.sleep(150);
      return Response.json({ ...sample, items: [] });
    });
    try {
      const client = new BugKbClient(kb.url, 30);
      await expect(client.search({ query: 'cache' })).rejects.toThrow('timed out');
      await expect(client.record('lazylab', finding)).rejects.toThrow('outcome may be unknown');
      expect(posts).toBe(1);
    } finally { kb.server.stop(true); }
  });

  test('reports disabled, invalid configuration and malformed service responses clearly', async () => {
    await expect(new BugKbClient('').search({ query: 'cache' })).rejects.toThrow('disabled');
    await expect(new BugKbClient('http://user:pass@localhost').search({ query: 'cache' })).rejects.toThrow('without credentials');
    const kb = serve(() => new Response('<html>Docs site, not BugKB</html>'));
    try { await expect(new BugKbClient(kb.url).search({ query: 'cache' })).rejects.toThrow('invalid JSON'); }
    finally { kb.server.stop(true); }
  });

  test('rejects oversized responses and redirects', async () => {
    const large = serve(() => new Response('x'.repeat(1_000_001)));
    try { await expect(new BugKbClient(large.url).get(sample.id)).rejects.toThrow('exceeds 1 MB'); }
    finally { large.server.stop(true); }
    let redirected = 0;
    const target = serve(() => { redirected++; return Response.json(sample); });
    const redirect = serve(() => Response.redirect(target.url));
    try {
      await expect(new BugKbClient(redirect.url).get(sample.id)).rejects.toThrow();
      expect(redirected).toBe(0);
    } finally { redirect.server.stop(true); target.server.stop(true); }
  });
});

describe('automatic task searches', () => {
  test('disabled integrations make no requests; available-empty differs from unavailable', async () => {
    expect(await briefingKnowledge(new BugKbClient(''), 'Task', [], [])).toEqual({ status: 'disabled', queries: [], entries: [], errors: [] });
    const kb = serve(() => Response.json({ items: [] }));
    try { expect((await briefingKnowledge(new BugKbClient(kb.url), 'Task', [], [])).status).toBe('available'); }
    finally { kb.server.stop(true); }
    const unavailable = await briefingKnowledge(new BugKbClient('invalid-url'), 'Task', [], []);
    expect(unavailable.status).toBe('unavailable');
    expect(unavailable.errors.length).toBeGreaterThan(0);
  });

  test('deduplicates matches, preserves partial results and prioritizes confirmed findings', async () => {
    const queries: string[] = [];
    const kb = serve((_req, url) => {
      const q = url.searchParams.get('q')!;
      queries.push(q);
      if (q === 'failure one') return Response.json({ items: [sample] });
      if (q === 'failure two') return new Response('down', { status: 503 });
      return Response.json({ items: [sample, { ...sample, id: 'confirmed', status: 'confirmed' }] });
    });
    try {
      const result = await briefingKnowledge(new BugKbClient(kb.url), 'Cache expiry', ['bun'], ['failure one', 'failure two', 'ignored third error']);
      expect(queries).toHaveLength(3);
      expect(result.status).toBe('partial');
      expect(result.entries.map((e) => e.id)).toEqual(['confirmed', sample.id]);
      expect(result.errors).toHaveLength(1);
    } finally { kb.server.stop(true); }
  });

  test('briefings search title/labels and failure lines, never descriptions, comments or log bodies', async () => {
    const queries: string[] = [];
    const kb = serve((_req, url) => { queries.push(url.searchParams.get('q')!); return Response.json({ items: [sample] }); });
    const client = new GitLabClient();
    const mr = await client.getMergeRequest(901, 77);
    client.getMergeRequest = async () => ({ ...mr, description: 'PRIVATE_DESCRIPTION', pipeline: { id: 30103, project_id: 902,
      status: 'failed', ref: 'fix', sha: 'a'.repeat(40), web_url: '' } });
    client.getBriefingNotes = async () => ({ notes: [{ id: 1, body: 'PRIVATE_COMMENT', author: { username: 'dev' } as any, created_at: '', system: false }], has_more: false });
    try {
      const brief = await buildTaskBriefing(client, { project_id: 901, kind: 'merge_request', iid: 77 }, [], new BugKbClient(kb.url));
      expect(brief.knowledge.status).toBe('available');
      expect(brief.knowledge.entries[0].id).toBe(sample.id);
      expect(queries.some((q) => q.includes('deadlock detected'))).toBe(true);
      expect(queries.join(' ')).not.toContain('PRIVATE_DESCRIPTION');
      expect(queries.join(' ')).not.toContain('PRIVATE_COMMENT');
      expect(queries).toHaveLength(2);
      const broken = await buildTaskBriefing(client, { project_id: 901, kind: 'merge_request', iid: 77 }, [], new BugKbClient('invalid-url'));
      expect(broken.task.title).toBe(mr.title);
      expect(broken.errors.some((e) => e.source === 'bugkb')).toBe(true);
    } finally { kb.server.stop(true); }
  });
});

describe('MCP and CLI knowledge workflow', () => {
  let kb: ReturnType<typeof serve>;
  let gitlab: ReturnType<typeof serve>;
  let httpServer: Server;
  let url: string;
  let token: string;
  let writes = 0;
  const records = new Map<string, any>();
  beforeAll(async () => {
    if (!vault.isInitialized()) await vault.initialize('tester', 'correct horse battery');
    token = vault.createAgentToken('knowledge-test').token;
    kb = serve(async (req, u) => {
      if (u.pathname.endsWith('/info')) return Response.json({ hooks: 1 });
      if (u.pathname.endsWith('/search')) return Response.json({ items: [...records.values()] });
      if (req.method === 'POST') {
        writes++;
        const body = await req.json() as any;
        if (u.pathname.includes('/confirm/')) {
          const record = { ...records.get(sample.id), hits: 2, status: 'confirmed' };
          records.set(sample.id, record);
          return Response.json(record);
        }
        const record = { ...sample, ...body, status: 'unverified' };
        records.set(sample.id, record);
        return Response.json(record);
      }
      return Response.json(records.get(sample.id) ?? sample);
    });
    process.env.LAZYLAB_BUGKB_URL = kb.url;
    gitlab = serve(() => Response.json({ id: 123, path: 'lazylab', path_with_namespace: 'sgkens/lazylab' }));
    const client = new GitLabClient(gitlab.url, 'fake-test-token');
    const app = express();
    app.use(express.json());
    app.use('/mcp', createMcpRouter(() => client));
    httpServer = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    url = `http://127.0.0.1:${(httpServer.address() as any).port}`;
  });
  afterAll(() => { delete process.env.LAZYLAB_BUGKB_URL; httpServer.close(); kb.server.stop(true); gitlab.server.stop(true); });
  const cli = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, 'cli/lazy.ts', ...args, '--json'], { env: { ...process.env, LAZYLAB_URL: url, LAZYLAB_TOKEN: token }, stdout: 'pipe', stderr: 'pipe' });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { exit, stdout, stderr };
  };

  test('tools advertise write semantics; demo tasks cannot write to the shared service', async () => {
    const tools = listTools();
    expect(tools.find((t) => t.name === 'record_bugkb_finding')!.annotations.idempotentHint).toBe(false);
    expect(tools.find((t) => t.name === 'confirm_bugkb_finding')!.annotations.idempotentHint).toBe(false);
    expect(tools.find((t) => t.name === 'search_bugkb')!.annotations.readOnlyHint).toBe(true);
    const response: any = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name: 'record_bugkb_finding', arguments: { project: 901, finding }
    } }, () => ({ client: new GitLabClient() }));
    expect(response.result.isError).toBe(true);
    expect(response.result.content[0].text).toContain('live GitLab');
    expect(writes).toBe(0);
  });

  test('CLI adds, searches, reads and confirms via authenticated MCP with live project attribution', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lazylab-kb-cli-'));
    try {
      const file = path.join(dir, 'finding.json');
      writeFileSync(file, JSON.stringify(finding));
      const saved = await cli('kb', 'add', '--project', '123', '--file', file);
      expect(saved.stderr).toBe('');
      expect(saved.exit).toBe(0);
      expect(JSON.parse(saved.stdout).project).toBe('lazylab');
      const searched = await cli('kb', 'search', 'cache', 'expiry');
      expect(searched.exit).toBe(0);
      expect(JSON.parse(searched.stdout).entries[0].id).toBe(sample.id);
      const full = await cli('kb', 'show', sample.id);
      expect(JSON.parse(full.stdout).fix).toContain(finding.verification);
      const confirmed = await cli('kb', 'confirm', sample.id, '--project', '123', '--note', 'Repeated expiry check passed');
      expect(confirmed.exit).toBe(0);
      expect(JSON.parse(confirmed.stdout).status).toBe('confirmed');
      expect(writes).toBe(2);
      expect((await cli('kb', 'confirm', sample.id)).exit).toBe(2);
      writeFileSync(file, '{bad json');
      expect((await cli('kb', 'add', '--project', '123', '--file', file)).exit).toBe(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
