// Agent token scopes (AGENT-2 / SEC-6): read-only vs write, project allowlist, default project, expiry, last use.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import express from 'express';
import { buildTaskBriefing } from '../server/briefing.ts';
import type { Server } from 'http';
import { isExpired, normalizeAgentToken, parseAgentTokenSettings } from '../server/agentPolicy.ts';
import { GitLabClient } from '../server/gitlabClient.ts';
import { createMcpRouter, handleMessage, listTools, ToolContext } from '../server/mcp.ts';
import { apiGuard } from '../server/session.ts';
import { hashAgentToken, vault } from '../server/vault.ts';

const demo = new GitLabClient();
const NOW = Date.parse('2026-10-24T12:00:00Z');

let server: Server;
let origin: string;

beforeAll(async () => {
  if (!vault.isInitialized()) await vault.initialize('tester', 'correct horse battery');
  // Imported after the vault is unlocked so the router's unlock hook (auto-fetch timers) does not fire here.
  const { apiRouter } = await import('../server/apiRouter.ts');
  const app = express();
  app.use(express.json());
  app.use('/api', apiGuard);
  app.use('/api', apiRouter);
  app.use('/mcp', createMcpRouter(() => demo));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  origin = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => server.close());

const rest = async (token: string, method: string, url: string, body?: unknown) => {
  const res = await fetch(`${origin}/api/agent${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
};

const rpc = async (token: string, method: string, params?: unknown) => {
  const res = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  return { status: res.status, body: (await res.json()) as any };
};
const tool = async (token: string, name: string, args: unknown) => {
  const { body } = await rpc(token, 'tools/call', { name, arguments: args });
  const text = body.result.content[0].text;
  return { isError: body.result.isError as boolean, text, data: body.result.isError ? null : JSON.parse(text) };
};

describe('settings validation', () => {
  test('a new token defaults to read scope, every project, no expiry, no secrets', () => {
    expect(parseAgentTokenSettings({}, false)).toEqual({ scope: 'read', dailyCiLimit: 50, tools: null, secrets: false, projects: null, defaultProjectId: null, expiresAt: null });
    expect(parseAgentTokenSettings(undefined, false).scope).toBe('read');
  });

  test('an edit leaves absent fields untouched', () => {
    expect(parseAgentTokenSettings({ scope: 'write' }, true)).toEqual({ scope: 'write' });
    expect(parseAgentTokenSettings({}, true)).toEqual({});
  });

  test('converts expiresInDays and clears expiry with null', () => {
    expect(parseAgentTokenSettings({ expiresInDays: 30 }, true, NOW).expiresAt).toBe('2026-11-23T12:00:00.000Z');
    expect(parseAgentTokenSettings({ expiresInDays: null }, true).expiresAt).toBeNull();
  });

  test('rejects bad values', () => {
    expect(() => parseAgentTokenSettings({ scope: 'admin' }, false)).toThrow('scope');
    expect(() => parseAgentTokenSettings({ secrets: 'yes' }, false)).toThrow('secrets');
    expect(() => parseAgentTokenSettings({ projects: ['group/project'] }, false)).toThrow('projects');
    expect(() => parseAgentTokenSettings({ projects: [0] }, false)).toThrow('projects');
    expect(() => parseAgentTokenSettings({ projects: 901 }, false)).toThrow('projects');
    expect(() => parseAgentTokenSettings({ projects: Array.from({ length: 101 }, (_, i) => i + 1) }, false)).toThrow('100');
    expect(() => parseAgentTokenSettings({ defaultProjectId: -1 }, false)).toThrow('defaultProjectId');
    expect(() => parseAgentTokenSettings({ expiresInDays: 0 }, false)).toThrow('expiresInDays');
    expect(() => parseAgentTokenSettings({ expiresInDays: 4000 }, false)).toThrow('expiresInDays');
    expect(() => parseAgentTokenSettings({ expiresInDays: 1.5 }, false)).toThrow('expiresInDays');
    expect(() => parseAgentTokenSettings([], false)).toThrow('object');
  });

  test('validates MCP tool names, preserves deny-all, and leaves absent edits unchanged', () => {
    expect(parseAgentTokenSettings({ tools: ['get_inbox', 'get_inbox'] }, true).tools).toEqual(['get_inbox']);
    expect(parseAgentTokenSettings({ tools: [] }, true).tools).toEqual([]);
    expect(parseAgentTokenSettings({ tools: null }, true).tools).toBeNull();
    for (const tools of ['get_inbox', [7], ['bad-name'], Array(101).fill('get_inbox')]) {
      expect(() => parseAgentTokenSettings({ tools }, true)).toThrow('tools');
    }
  });

  test('deduplicates the allowlist; an empty list means every project', () => {
    expect(parseAgentTokenSettings({ projects: [901, 901, 902] }, true).projects).toEqual([901, 902]);
    expect(parseAgentTokenSettings({ projects: [] }, true).projects).toBeNull();
  });

  test('legacy records keep write scope; unreadable expiry fails closed', () => {
    expect(normalizeAgentToken({ id: 'x', name: 'old' })).toEqual({
      id: 'x', name: 'old', scope: 'write', dailyCiLimit: null, tools: null, secrets: false, projects: null, defaultProjectId: null, expiresAt: null
    });
    expect(isExpired('not a date')).toBe(true);
    expect(isExpired(null)).toBe(false);
    expect(isExpired('2026-10-24T11:59:59Z', NOW)).toBe(true);
    expect(isExpired('2026-10-24T12:00:01Z', NOW)).toBe(false);
  });
});

describe('vault storage', () => {
  test('migrates a token stored before scopes as legacy write access; an edit makes it explicit', () => {
    const plaintext = 'llab_legacy-token-for-migration-test';
    (vault as any).payload.agentTokens.push({
      id: 'legacy-id', name: 'legacy', prefix: plaintext.slice(0, 9), hash: hashAgentToken(plaintext), createdAt: '2026-01-01T00:00:00Z'
    });
    const listed = vault.listAgentTokens().find((t) => t.id === 'legacy-id')!;
    expect(listed).toMatchObject({ scope: 'write', projects: null, expiresAt: null, lastUsedAt: null, legacy: true, expired: false });
    expect((listed as any).hash).toBeUndefined();
    const auth = vault.authenticateAgentToken(plaintext);
    expect(auth.ok && auth.token.scope).toBe('write');

    const edited = vault.updateAgentToken('legacy-id', { scope: 'read' });
    expect(edited).toMatchObject({ scope: 'read', legacy: false, secrets: false });
    vault.deleteAgentToken('legacy-id');
  });

  test('records the last use and rejects expired tokens', () => {
    const { token, record } = vault.createAgentToken('expiring', { scope: 'read' });
    expect(record.lastUsedAt).toBeNull();
    expect(vault.authenticateAgentToken(token).ok).toBe(true);
    expect(vault.listAgentTokens().find((t) => t.id === record.id)!.lastUsedAt).not.toBeNull();

    vault.updateAgentToken(record.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const auth = vault.authenticateAgentToken(token);
    expect(auth).toMatchObject({ ok: false, reason: 'expired' });
    expect(vault.verifyAgentToken(token)).toBeNull();
    expect(vault.listAgentTokens().find((t) => t.id === record.id)!.expired).toBe(true);
    expect(vault.authenticateAgentToken('llab_unknown')).toEqual({ ok: false, reason: 'invalid' });
  });

  test('the default project must be in the allowlist', () => {
    expect(() => vault.createAgentToken('bad-default', { projects: [901], defaultProjectId: 902 })).toThrow('allowed projects');
    const { record } = vault.createAgentToken('narrow', { projects: [901], defaultProjectId: 901 });
    expect(() => vault.updateAgentToken(record.id, { projects: [902] })).toThrow('allowed projects');
    expect(vault.listAgentTokens().find((t) => t.id === record.id)!.projects).toEqual([901]);
    expect(() => vault.updateAgentToken('missing', { scope: 'read' })).toThrow('not found');
  });
});

describe('REST enforcement', () => {
  test('a read-scope token reads and adds watches, but cannot write GitLab or run CI', async () => {
    const { token } = vault.createAgentToken('rest-read', { scope: 'read' });
    expect((await rest(token, 'GET', '/work-items?projectId=901')).status).toBe(200);
    expect((await rest(token, 'GET', '/inbox')).status).toBe(200);
    for (const [method, url, body] of [
      ['POST', '/work-items', { projectId: 901, title: 'x' }],
      ['PATCH', '/work-items/1', { projectId: 901, state_event: 'close' }],
      ['PUT', '/merge-requests/1', { projectId: 901, title: 'x' }],
      ['POST', '/merge-requests', { projectId: 901, title: 'x', source_branch: 'b' }],
      ['POST', '/pipelines', { projectId: 901, ref: 'main' }]
    ] as const) {
      const res = await rest(token, method, url, body);
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('read-only');
    }
    const pipelines = await demo.getPipelines(901);
    const watch = await rest(token, 'POST', '/watches', { kind: 'pipeline', projectId: 901, targetId: pipelines[0].id });
    expect(watch.status).toBe(200);
  });

  test('a project allowlist limits every project-scoped route and filters the inbox and watches', async () => {
    const { token } = vault.createAgentToken('rest-narrow', { scope: 'write', projects: [901] });
    expect((await rest(token, 'GET', '/work-items?projectId=901')).status).toBe(200);
    const denied = await rest(token, 'GET', '/work-items?projectId=902');
    expect(denied.status).toBe(403);
    expect(denied.body.error).toContain('project 902');
    expect((await rest(token, 'POST', '/work-items', { projectId: 902, title: 'x' })).status).toBe(403);
    expect((await rest(token, 'PATCH', '/merge-requests/1', { projectId: 902, state_event: 'close' })).status).toBe(403);
    expect((await rest(token, 'POST', '/pipelines', { projectId: 902, ref: 'main' })).status).toBe(403);
    expect((await rest(token, 'GET', '/jobs/1/failure?projectId=903')).status).toBe(403);
    expect((await rest(token, 'POST', '/watches', { kind: 'pipeline', projectId: 902, targetId: 1 })).status).toBe(403);

    const inbox = await rest(token, 'GET', '/inbox');
    expect(inbox.body.items.length).toBeGreaterThan(0);
    expect(inbox.body.items.every((i: any) => i.project_id === 901)).toBe(true);
    expect(inbox.body.counts.action + inbox.body.counts.waiting + inbox.body.counts.assigned).toBe(inbox.body.items.length);
    const watches = await rest(token, 'GET', '/watches');
    expect(watches.body.watches.every((w: any) => w.project_id === 901)).toBe(true);
  });

  test('the per-token default project is used when projectId is omitted, and still checked', async () => {
    const { token } = vault.createAgentToken('rest-default', { scope: 'write', projects: [902], defaultProjectId: 902 });
    const list = await rest(token, 'GET', '/work-items');
    expect(list.status).toBe(200);
    expect(list.body.projectId).toBe(902);
    expect((await rest(token, 'GET', '/work-items?projectId=901')).status).toBe(403);
  });

  test('expired tokens get 401 with the reason; use is recorded', async () => {
    const { token, record } = vault.createAgentToken('rest-expired', { scope: 'read' });
    expect((await rest(token, 'GET', '/inbox')).status).toBe(200);
    expect(vault.listAgentTokens().find((t) => t.id === record.id)!.lastUsedAt).not.toBeNull();
    vault.updateAgentToken(record.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const res = await rest(token, 'GET', '/inbox');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('expired');
  });
});

describe('MCP enforcement', () => {
  test('a read-scope token lists and calls only read and local tools', async () => {
    const { token } = vault.createAgentToken('mcp-read', { scope: 'read' });
    const { body } = await rpc(token, 'tools/list');
    const names = body.result.tools.map((t: any) => t.name);
    expect(names).toContain('get_inbox');
    expect(names).toContain('watch');
    expect(names).toContain('save_handoff');
    expect(names).toContain('add_note');
    for (const write of ['create_work_item', 'update_work_item', 'add_comment', 'create_merge_request', 'run_pipeline', 'retry_job', 'record_bugkb_finding', 'confirm_bugkb_finding']) {
      expect(names).not.toContain(write);
      const res = await tool(token, write, {});
      expect(res.isError).toBe(true);
      expect(res.text).toContain('read-only');
    }
    expect(names).not.toContain('get_env');
    expect((await tool(token, 'list_work_items', { project: 901 })).isError).toBe(false);
  });

  test('a project allowlist applies to ids and paths, and filters list outputs', async () => {
    const { token } = vault.createAgentToken('mcp-narrow', { scope: 'write', projects: [901] });
    expect((await tool(token, 'list_work_items', { project: 901 })).isError).toBe(false);
    expect((await tool(token, 'list_work_items', { project: 'platform/gitlab-orchestrator' })).isError).toBe(false);
    for (const project of [902, '902', 'infra/k8s-operator']) {
      const res = await tool(token, 'list_work_items', { project });
      expect(res.isError).toBe(true);
      expect(res.text).toContain('project 902');
    }
    expect((await tool(token, 'create_work_item', { project: 902, title: 'x' })).isError).toBe(true);
    expect((await tool(token, 'get_task_briefing', { project: 902, kind: 'merge_request', iid: 77 })).isError).toBe(true);

    expect((await tool(token, 'list_projects', {})).data.map((p: any) => p.id)).toEqual([901]);
    const inbox = (await tool(token, 'get_inbox', {})).data;
    expect(inbox.items.every((i: any) => i.project_id === 901)).toBe(true);
    expect(inbox.counts.action + inbox.counts.waiting + inbox.counts.assigned).toBe(inbox.items.length);
    expect((await tool(token, 'list_watches', {})).data.every((w: any) => w.project_id === 901)).toBe(true);
  });

  test('get_env applies the project allowlist even with secret access', async () => {
    const { token } = vault.createAgentToken('env-narrow', { scope: 'read', secrets: true, projects: [901] });
    expect((await tool(token, 'get_env', { project: 901 })).isError).toBe(false);
    const denied = await tool(token, 'get_env', { project: 902 });
    expect(denied.isError).toBe(true);
    expect(denied.text).toContain('project 902');
  });

  test('briefings skip forbidden related MRs and fork pipelines before fetching their data', async () => {
    const client = new GitLabClient();
    const item = (await client.getWorkItems(901))[0];
    const mr = await client.getMergeRequest(901, 77);
    client.getIssueMergeRequests = async () => [{ ...mr, project_id: 902 }];
    client.getMergeRequest = async () => { throw new Error('forbidden MR must never be fetched'); };
    let brief = await buildTaskBriefing(client, { project_id: 901, kind: 'work_item', iid: item.iid }, [], undefined, (id) => id === 901);
    expect(brief.merge_requests).toEqual([]);
    expect(brief.errors).toEqual([]);
    expect(brief.omissions.join(' ')).toContain('outside this token');

    client.getMergeRequest = async () => ({ ...mr, pipeline: { ...mr.pipeline!, project_id: 902 } });
    client.getPipelineJobs = async () => { throw new Error('forbidden pipeline must never be fetched'); };
    client.getJobFailure = async () => { throw new Error('forbidden job must never be fetched'); };
    brief = await buildTaskBriefing(client, { project_id: 901, kind: 'merge_request', iid: 77 }, [], undefined, (id) => id === 901);
    expect((brief.merge_requests[0] as any).pipeline).toBeNull();
    expect((brief.merge_requests[0] as any).failures).toBeNull();
    expect(brief.errors).toEqual([]);
  });

  test('MCP tool allowlists intersect scope and secret permissions and changes apply immediately', async () => {
    const { token, record } = vault.createAgentToken('tools', { scope: 'read', tools: ['get_inbox', 'run_pipeline', 'get_env'] });
    const listed = await rpc(token, 'tools/list');
    expect(listed.body.result.tools.map((t: any) => t.name)).toEqual(['get_inbox']);
    const denied = await tool(token, 'list_projects', {});
    expect(denied.isError).toBe(true);
    expect(denied.text).toContain('not allowed to call list_projects');
    expect((await tool(token, 'run_pipeline', { project: 901, ref: 'main' })).isError).toBe(true);
    expect((await tool(token, 'get_env', { project: 901 })).isError).toBe(true);
    vault.updateAgentToken(record.id, { tools: [] });
    expect((await rpc(token, 'tools/list')).body.result.tools).toEqual([]);
    expect((await tool(token, 'get_inbox', {})).isError).toBe(true);
    vault.updateAgentToken(record.id, { tools: null });
    expect((await tool(token, 'list_projects', {})).isError).toBe(false);
    expect((await rest(token, 'GET', '/work-items?projectId=901')).status).toBe(200);
  });

  test('expired tokens are refused at the transport', async () => {
    const { token, record } = vault.createAgentToken('mcp-expired', { scope: 'read' });
    vault.updateAgentToken(record.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const res = await rpc(token, 'tools/list');
    expect(res.status).toBe(401);
    expect(res.body.error.message).toContain('expired');
  });

  test('in-process contexts without scope keep full access (tests, internal callers)', async () => {
    const ctx = (): ToolContext => ({ client: demo, token: { name: 'internal', secrets: false } });
    const res: any = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, ctx);
    expect(res.result.tools.map((t: any) => t.name)).toContain('create_work_item');
    expect(listTools({ name: 'r', secrets: false, scope: 'read' }).map((t) => t.name)).not.toContain('run_pipeline');
  });
});


describe('daily CI quotas', () => {
  test('validates limits and preserves legacy unlimited access', () => {
    expect(parseAgentTokenSettings({}, false).dailyCiLimit).toBe(50);
    expect(parseAgentTokenSettings({ dailyCiLimit: 0 }, true).dailyCiLimit).toBe(0);
    expect(parseAgentTokenSettings({ dailyCiLimit: null }, true).dailyCiLimit).toBeNull();
    expect(parseAgentTokenSettings({}, true).dailyCiLimit).toBeUndefined();
    for (const dailyCiLimit of [-1, 1.5, 10001, '3', true]) expect(() => parseAgentTokenSettings({ dailyCiLimit }, true)).toThrow('dailyCiLimit');
    expect(normalizeAgentToken({ id: 'legacy', name: 'old' }).dailyCiLimit).toBeNull();
  });

  test('runs and retries share quota across REST and MCP; other tokens stay independent', async () => {
    const { token, record } = vault.createAgentToken('combined-cap', { scope: 'write', dailyCiLimit: 2 });
    const first = await rest(token, 'POST', '/pipelines', { projectId: 901, ref: 'main', watch: false });
    expect(first.status).toBe(200);
    const existingPipelines = await demo.getPipelines(901);
    const existingJobs = await demo.getPipelineJobs(901, existingPipelines.find(p => p.id !== first.body.pipeline.id)!.id);
    expect((await tool(token, 'retry_job', { project: 901, job_id: existingJobs.jobs[0].id, watch: false })).isError).toBe(false);
    const denied = await rest(token, 'POST', '/pipelines', { projectId: 901, ref: 'main', watch: false });
    expect(denied.status).toBe(429);
    expect(denied.body.resetAt).toMatch(/T00:00:00.000Z$/);
    expect((await tool(token, 'run_pipeline', { project: 901, ref: 'main', watch: false })).text).toContain('daily CI limit (2)');
    expect(vault.listAgentTokens().find(t => t.id === record.id)!.ciUsage?.used).toBe(2);
    const other = vault.createAgentToken('other-cap', { scope: 'write', dailyCiLimit: 1 });
    expect((await tool(other.token, 'run_pipeline', { project: 901, ref: 'main', watch: false })).isError).toBe(false);
  });

  test('concurrent requests reserve one remaining slot only', async () => {
    const { token } = vault.createAgentToken('concurrent-cap', { scope: 'write', dailyCiLimit: 1 });
    const responses = await Promise.all([1, 2, 3].map(() => rest(token, 'POST', '/pipelines', { projectId: 901, ref: 'main', watch: false })));
    expect(responses.map(r => r.status).sort()).toEqual([200, 429, 429]);
  });

  test('denied projects and invalid arguments do not consume budget; zero disables CI', async () => {
    const { token, record } = vault.createAgentToken('validated-cap', { scope: 'write', projects: [901], dailyCiLimit: 1 });
    expect((await rest(token, 'POST', '/pipelines', { projectId: 902, ref: 'main' })).status).toBe(403);
    expect((await rest(token, 'POST', '/pipelines', { projectId: 901 })).status).toBe(400);
    expect((await tool(token, 'retry_job', { project: 901, job_id: -1 })).text).toContain('positive integer');
    expect(vault.listAgentTokens().find(t => t.id === record.id)!.ciUsage).toBeUndefined();
    vault.updateAgentToken(record.id, { dailyCiLimit: 0 });
    expect((await rest(token, 'POST', '/pipelines', { projectId: 901, ref: 'main' })).status).toBe(429);
    vault.updateAgentToken(record.id, { dailyCiLimit: null });
    expect((await rest(token, 'POST', '/pipelines', { projectId: 901, ref: 'main', watch: false })).status).toBe(200);
  });

  test('upstream failures count and persistence failure rolls the reservation back', async () => {
    const { record } = vault.createAgentToken('failure-cap', { scope: 'write', dailyCiLimit: 1 });
    const policy = normalizeAgentToken(record);
    let calls = 0;
    const context = { token: policy, client: { createPipeline: async () => { calls++; throw new Error('upstream down'); } } } as unknown as ToolContext;
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_pipeline', arguments: { project: 901, ref: 'main', watch: false } } };
    const first = await handleMessage(request, () => context) as any;
    expect(first.result.content[0].text).toContain('upstream down');
    const second = await handleMessage(request, () => context) as any;
    expect(second.result.content[0].text).toContain('daily CI limit');
    expect(calls).toBe(1);
    const other = vault.createAgentToken('persist-failure-cap', { scope: 'write', dailyCiLimit: 1 });
    const persist = (vault as any).persist;
    try {
      (vault as any).persist = () => { throw new Error('disk full'); };
      expect(() => vault.consumeAgentCi(other.record.id)).toThrow('disk full');
      expect(vault.listAgentTokens().find(t => t.id === other.record.id)!.ciUsage).toBeUndefined();
    } finally { (vault as any).persist = persist; }
    expect(() => vault.consumeAgentCi(other.record.id)).not.toThrow();
  });

  test('UTC rollover resets the budget and fresh process reload keeps the spent quota', () => {
    const { record } = vault.createAgentToken('rollover-cap', { scope: 'write', dailyCiLimit: 1 });
    const midnight = Date.parse('2026-10-24T00:00:00Z');
    vault.consumeAgentCi(record.id, midnight - 1);
    expect(() => vault.consumeAgentCi(record.id, midnight - 1)).toThrow('daily CI limit');
    expect(() => vault.consumeAgentCi(record.id, midnight)).not.toThrow();
    expect(vault.listAgentTokens().find(t => t.id === record.id)!.ciUsage).toEqual({ day: '2026-10-24', used: 1 });
    const script = `import { vault } from './server/vault.ts';
      if (!await vault.verifyAndUnlock('tester', 'correct horse battery')) process.exit(2);
      try { vault.consumeAgentCi(${JSON.stringify(record.id)}, ${midnight}); process.exit(3); }
      catch (err) { if (!String(err).includes('daily CI limit')) process.exit(4); }
      vault.lock();`;
    const child = spawnSync(process.execPath, ['-e', script], { cwd: process.cwd(), env: { ...process.env }, encoding: 'utf8' });
    expect(child.status).toBe(0);
  });
});
