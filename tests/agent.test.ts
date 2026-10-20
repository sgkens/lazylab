import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import express from 'express';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { Server } from 'http';
import { acceptanceCriteria, buildTaskBriefing } from '../server/briefing.ts';
import { parseHandoff, TaskRef } from '../server/handoffs.ts';
import { GitLabClient } from '../server/gitlabClient.ts';
import { createMcpRouter, handleMessage } from '../server/mcp.ts';
import { vault } from '../server/vault.ts';
import { parseTask, renderBriefing } from '../cli/agent.ts';

const demo = new GitLabClient();
const task: TaskRef = { project_id: 901, kind: 'merge_request', iid: 77 };
const checkpoint = { status: 'in_progress', summary: 'Use the existing cache invalidation path.',
  decisions: ['Keep the public API stable'], attempts: ['Inspected expiry handling'],
  verification: [{ check: 'bun test', result: 'not_run' }], next_steps: ['Add the expiry check'] };
const invoke = async (name: string, args: unknown, profileId: string | null = null) => {
  const res: any = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    () => ({ client: demo, profileId, token: { id: 'agent-test-id', name: 'test-agent', secrets: false } }));
  return { error: res.result.isError, data: JSON.parse(res.result.isError ? JSON.stringify(res.result.content[0].text) : res.result.content[0].text) };
};

beforeAll(async () => {
  if (!vault.isInitialized()) await vault.initialize('tester', 'correct horse battery');
});

describe('task briefs and checkpoint validation', () => {
  test('extracts acceptance checks only within the named section, excluding fenced examples', () => {
    expect(acceptanceCriteria('- [ ] Not a requirement\n### Acceptance criteria\n- [ ] Save state\n#### Details\n* [X] Resume\n```md\n- [ ] Example\n```\n### Notes\n- [ ] Not a criterion')).toEqual([
      { text: 'Save state', completed: false }, { text: 'Resume', completed: true }
    ]);
  });

  test('rejects forged authors, empty checkpoints, invalid evidence and missing next steps', () => {
    expect(() => parseHandoff({ ...checkpoint, author: 'someone' })).toThrow('unknown handoff field');
    expect(() => parseHandoff({ ...checkpoint, summary: ' ' })).toThrow('summary');
    expect(() => parseHandoff({ ...checkpoint, next_steps: [] })).toThrow('next_steps');
    expect(() => parseHandoff({ ...checkpoint, status: 'blocked' })).toThrow('blocker');
    expect(() => parseHandoff({ ...checkpoint, decisions: Array(21).fill('x') })).toThrow('20');
    expect(() => parseHandoff({ ...checkpoint, verification: [{ check: 'tests', result: 'probably' }] })).toThrow('result');
    expect(() => parseHandoff({ ...checkpoint, head_sha: 'short' })).toThrow('full commit SHA');
    expect(() => parseHandoff({ ...checkpoint, status: ['done'] })).toThrow('status');
    expect(() => parseHandoff({ ...checkpoint, decisions: null })).toThrow('array');
    expect(parseHandoff({ status: 'done', summary: 'Complete' }).next_steps).toEqual([]);
  });

  test('issue briefs preserve useful context when secondary sources fail', async () => {
    const client = new GitLabClient();
    const item = (await client.getWorkItems(901))[0];
    client.getBriefingNotes = async () => { throw new Error('discussion unavailable'); };
    client.getIssueMergeRequests = async () => { throw new Error('relationships unavailable'); };
    const result = await buildTaskBriefing(client, { project_id: 901, kind: 'work_item', iid: item.iid }, []);
    expect(result.task.title).toBe(item.title);
    expect(result.comments).toBeNull();
    expect(result.errors.map((e) => e.source)).toEqual(['discussion', 'related_merge_requests']);
    expect(renderBriefing(result)).toContain('discussion unavailable');
    await expect(buildTaskBriefing(client, { ...task, iid: 999999 }, [])).rejects.toThrow('not found');
  });

  test('bounds patches, retains failure evidence, and reports omitted patches and failed log reads', async () => {
    const client = new GitLabClient();
    const mr = { ...await client.getMergeRequest(901, 77), sha: 'a'.repeat(40), pipeline: {
      id: 30103, project_id: 902, status: 'failed' as const, web_url: '', ref: 'fix', sha: 'a'.repeat(40)
    } };
    client.getMergeRequest = async () => mr;
    client.getMergeRequestDiffs = async () => Array.from({ length: 11 }, (_, i) => ({
      old_path: `file${i}`, new_path: `file${i}`, diff: 'x'.repeat(15_000), collapsed: i === 1
    }));
    const getJobs = client.getPipelineJobs.bind(client);
    client.getPipelineJobs = async (project, pipeline, force) => {
      expect(project).toBe(902); // Fork/source pipeline namespace, not the MR's target project.
      return getJobs(project, pipeline, force);
    };
    const brief = await buildTaskBriefing(client, task, []);
    const detail: any = brief.merge_requests[0];
    expect(detail.diffs).toHaveLength(10);
    expect(detail.diffs.reduce((n: number, d: any) => n + d.diff.length, 0)).toBeLessThanOrEqual(12_000);
    expect(detail.diffs[0].truncated).toBe(true);
    expect(brief.omissions.some((s) => s.includes('first 10 files'))).toBe(true);
    expect(detail.failures[0].error_line).toContain('deadlock');
    client.getJobFailure = async () => { throw new Error('log access denied'); };
    const missing = await buildTaskBriefing(client, task, []);
    expect(missing.errors.some((e) => e.message === 'log access denied')).toBe(true);
  });

  test('resolves related MRs using their own projects and prefers open work', async () => {
    const client = new GitLabClient();
    const item = (await client.getWorkItems(901))[0];
    const mr = await client.getMergeRequest(901, 77);
    const rows = Array.from({ length: 5 }, (_, i) => ({ ...mr, project_id: 902, iid: i + 1,
      state: i === 0 ? 'merged' as const : 'opened' as const, updated_at: `2026-10-${10 + i}` }));
    client.getIssueMergeRequests = async () => rows;
    const seen: number[] = [];
    client.getMergeRequest = async (project, iid) => {
      expect(project).toBe(902);
      seen.push(iid);
      return { ...rows.find((m) => m.iid === iid)!, pipeline: undefined };
    };
    client.getMergeRequestDiffs = async () => [];
    const result = await buildTaskBriefing(client, { project_id: 901, kind: 'work_item', iid: item.iid }, []);
    expect(seen).toEqual([5, 4, 3]);
    expect(result.omissions.some((s) => s.includes('first 3'))).toBe(true);
  });
});

describe('handoffs over MCP', () => {
  test('attributes writes, keeps history, and isolates profiles, projects and task kinds', async () => {
    const args = { project: 901, kind: 'merge_request', iid: 77 };
    const first = await invoke('save_handoff', { ...args, handoff: checkpoint });
    expect(first.error).toBe(false);
    expect(first.data.author).toEqual({ id: 'agent-test-id', name: 'test-agent' });
    await invoke('save_handoff', { ...args, handoff: { ...checkpoint, summary: 'Second checkpoint' } });
    const listed = await invoke('list_handoffs', args);
    expect(listed.data[0].summary).toBe('Second checkpoint');
    expect(listed.data[1].id).toBe(first.data.id);
    expect((await invoke('list_handoffs', args, 'other-profile')).data).toEqual([]);
    expect(vault.getAgentHandoffs(null, { ...task, project_id: 902 })).toEqual([]);
    expect(vault.getAgentHandoffs(null, { ...task, kind: 'work_item' })).toEqual([]);
    const other = vault.getAgentHandoffs(null, task);
    other[0].summary = 'mutated';
    expect(vault.getAgentHandoffs(null, task)[0].summary).toBe('Second checkpoint');
    const brief = await invoke('get_task_briefing', args);
    expect(brief.data.handoffs[0].summary).toBe('Second checkpoint');
    expect(brief.data.handoffs[0].matches_head).toBeNull();
  });

  test('rejects nonexistent tasks, forged metadata and invalid limits without saving', async () => {
    const args = { project: 901, kind: 'merge_request', iid: 77 };
    expect((await invoke('save_handoff', { ...args, iid: 999999, handoff: checkpoint })).error).toBe(true);
    expect((await invoke('save_handoff', { ...args, handoff: { ...checkpoint, author: { name: 'forged' } } })).error).toBe(true);
    expect((await invoke('list_handoffs', { ...args, limit: 21 })).error).toBe(true);
    expect((await invoke('get_task_briefing', { ...args, iid: -1 })).error).toBe(true);
  });

  test('retains the latest 20 checkpoints and flags a changed MR head', async () => {
    for (let i = 0; i < 25; i++) vault.saveAgentHandoff(null, task, { ...checkpoint, summary: `Checkpoint ${i}`, head_sha: 'a'.repeat(40) }, { id: null, name: 'test' });
    const records = vault.getAgentHandoffs(null, task, 20);
    expect(records).toHaveLength(20);
    expect(records[0].summary).toBe('Checkpoint 24');
    expect(records[19].summary).toBe('Checkpoint 5');
    const client = new GitLabClient();
    const mr = await client.getMergeRequest(901, 77);
    client.getMergeRequest = async () => ({ ...mr, sha: 'b'.repeat(40) });
    const brief = await buildTaskBriefing(client, task, records.slice(0, 3));
    expect(brief.handoffs.every((h) => h.matches_head === false)).toBe(true);
  });
});

test('encrypted handoffs survive a fresh process and lock; profiles stay isolated', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lazylab-handoff-restart-'));
  const module = new URL('../server/vault.ts', import.meta.url).href;
  const setup = `import { vault } from ${JSON.stringify(module)};
    await vault.initialize('tester', 'long-enough-password');
    const a = vault.upsertProfile({name:'A',host:'https://a.example',token:'fake'});
    const b = vault.upsertProfile({name:'B',host:'https://b.example',token:'fake'});
    const task = ${JSON.stringify(task)};
    vault.saveAgentHandoff(a.id, task, {status:'done',summary:'private-checkpoint-marker'}, {id:'one',name:'Agent One'});
    vault.saveAgentHandoff(b.id, task, {status:'done',summary:'Other host'}, {id:'two',name:'Agent Two'});
    vault.lock();
    try { vault.getAgentHandoffs(a.id, task); process.exit(3); } catch {}
    console.log(JSON.stringify({a:a.id,b:b.id}));`;
  try {
    const saved = Bun.spawnSync([process.execPath, '--eval', setup], { env: { ...process.env, LAZYLAB_DATA_DIR: dir } });
    expect(saved.exitCode).toBe(0);
    const profiles = JSON.parse(saved.stdout.toString());
    expect(readFileSync(path.join(dir, 'vault.json'), 'utf8')).not.toContain('private-checkpoint-marker');
    const read = `import { vault } from ${JSON.stringify(module)};
      if (!await vault.verifyAndUnlock('tester','long-enough-password')) process.exit(2);
      const task = ${JSON.stringify(task)};
      console.log(JSON.stringify([vault.getAgentHandoffs(${JSON.stringify(profiles.a)},task),vault.getAgentHandoffs(${JSON.stringify(profiles.b)},task),vault.getAgentHandoffs(null,task)]));`;
    const loaded = Bun.spawnSync([process.execPath, '--eval', read], { env: { ...process.env, LAZYLAB_DATA_DIR: dir } });
    expect(loaded.exitCode).toBe(0);
    const [a, b, demoRecords] = JSON.parse(loaded.stdout.toString());
    expect(a[0].summary).toBe('private-checkpoint-marker');
    expect(b[0].summary).toBe('Other host');
    expect(demoRecords).toEqual([]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('vaults without handoffs migrate on unlock and failed writes do not create phantom checkpoints', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lazylab-handoff-legacy-'));
  const module = new URL('../server/vault.ts', import.meta.url).href;
  const script = `import { vault } from ${JSON.stringify(module)};
    import { mkdirSync, rmSync } from 'fs';
    await vault.initialize('tester','long-enough-password',{agentHandoffs:undefined});
    vault.lock();
    await vault.verifyAndUnlock('tester','long-enough-password');
    const task = ${JSON.stringify(task)};
    if (vault.getAgentHandoffs(null,task).length !== 0) process.exit(2);
    const tmp = ${JSON.stringify(path.join(dir, 'vault.json.'))} + process.pid + '.tmp';
    mkdirSync(tmp);
    let failed = false;
    try { vault.saveAgentHandoff(null,task,{status:'done',summary:'must not appear'},{id:null,name:'agent'}); }
    catch { failed = true; }
    rmSync(tmp,{recursive:true});
    if (!failed || vault.getAgentHandoffs(null,task).length) process.exit(3);
    vault.saveAgentHandoff(null,task,{status:'done',summary:'saved'},{id:null,name:'agent'});
    const profile = vault.upsertProfile({name:'A',host:'https://a.example',token:'fake'});
    vault.saveAgentHandoff(profile.id,task,{status:'done',summary:'old host'},{id:null,name:'agent'});
    vault.upsertProfile({id:profile.id,name:'A',host:'https://b.example'});
    if (vault.getAgentHandoffs(profile.id,task).length) process.exit(4);
    vault.deleteProfile(profile.id);
    try { vault.saveAgentHandoff(profile.id,task,{status:'done',summary:'orphan'},{id:null,name:'agent'}); process.exit(5); } catch {}
    console.log('ok');`;
  try {
    const result = Bun.spawnSync([process.execPath, '--eval', script], { env: { ...process.env, LAZYLAB_DATA_DIR: dir } });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe('ok');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('briefings use documented GitLab read endpoints, recent notes and the source pipeline project', async () => {
  const calls: string[] = [];
  const user = { id: 1, username: 'dev', name: 'Dev' };
  const mr = { id: 2, iid: 2, project_id: 90, title: 'Fix expiry', author: user, labels: [], state: 'opened',
    source_branch: 'fix-expiry', target_branch: 'main', sha: 'b'.repeat(40), updated_at: '2026-10-20',
    head_pipeline: { id: 30, project_id: 91, status: 'failed', ref: 'fix-expiry', sha: 'b'.repeat(40) } };
  const gitlab = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    const u = new URL(req.url);
    calls.push(u.pathname + u.search);
    expect(req.method).toBe('GET');
    expect(req.headers.get('PRIVATE-TOKEN')).toBe('fake-test-token');
    const p = u.pathname.replace('/api/v4', '');
    if (p === '/projects/9/issues/1') return Response.json({ id: 1, iid: 1, project_id: 9, title: 'Expire cache',
      description: '### Acceptance criteria\n- [ ] Expire stale entries', author: user, labels: [], assignees: [], state: 'opened' });
    if (p.endsWith('/notes')) {
      expect(u.searchParams.get('sort')).toBe('desc');
      expect(u.searchParams.get('per_page')).toBe('100');
      return Response.json(Array.from({ length: 25 }, (_, i) => ({ id: 25 - i, body: `Note ${25 - i}`, author: user, system: false, created_at: `2026-10-${25 - i}` })));
    }
    if (p.endsWith('/related_merge_requests')) return Response.json([mr]);
    if (p === '/projects/90/merge_requests/2') return Response.json(mr);
    if (p.endsWith('/diffs')) {
      expect(u.searchParams.get('per_page')).toBe('11');
      return Response.json([{ old_path: 'cache.ts', new_path: 'cache.ts', diff: '+ expiry check' }]);
    }
    if (p === '/projects/91/pipelines/30/jobs') return Response.json([{ id: 7, name: 'test', stage: 'test', status: 'failed' }]);
    if (p === '/projects/91/jobs/7') return Response.json({ id: 7, name: 'test', stage: 'test', status: 'failed' });
    if (p === '/projects/91/jobs/7/trace') return new Response('FAIL cache expiry\nERROR: Job failed: exit code 1');
    return Response.json({ message: `Unexpected ${p}` }, { status: 404 });
  } });
  try {
    const client = new GitLabClient(`http://127.0.0.1:${gitlab.port}`, 'fake-test-token');
    const result = await buildTaskBriefing(client, { project_id: 9, kind: 'work_item', iid: 1 }, []);
    expect(result.demo).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.comments).toHaveLength(20);
    expect(result.comments![0].body).toBe('Note 6');
    expect(result.acceptance_criteria[0].text).toBe('Expire stale entries');
    expect((result.merge_requests[0] as any).failures[0].exit_code).toBe(1);
    expect(calls.some((c) => c.includes('/projects/91/pipelines/30/jobs'))).toBe(true);
    expect(calls.some((c) => c.includes('/related_merge_requests?'))).toBe(true);
  } finally { gitlab.stop(true); }
});

describe('authenticated HTTP and CLI', () => {
  let server: Server;
  let url: string;
  let token: string;
  beforeAll(async () => {
    token = vault.createAgentToken('cli-handoff-test').token;
    const app = express();
    app.use(express.json());
    app.use('/mcp', createMcpRouter(() => demo));
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    url = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(() => server.close());
  const cli = async (...args: string[]) => {
    const process = Bun.spawn([Bun.which('bun')!, 'cli/lazy.ts', ...args], {
      env: { ...globalThis.process.env, LAZYLAB_URL: url, LAZYLAB_TOKEN: token }, stdout: 'pipe', stderr: 'pipe'
    });
    const [stdout, stderr, exit] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
    return { stdout, stderr, exit };
  };

  test('rejects missing credentials and wrong-origin requests', async () => {
    expect((await fetch(`${url}/mcp`, { method: 'POST' })).status).toBe(401);
    expect((await fetch(`${url}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: 'https://elsewhere.example' } })).status).toBe(403);
  });

  test('saves a JSON checkpoint and resumes through both JSON and readable CLI briefings', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lazylab-handoff-cli-'));
    try {
      const file = path.join(dir, 'handoff.json');
      writeFileSync(file, JSON.stringify(checkpoint));
      const saved = await cli('handoff', 'save', 'mr', '77', '--project', '901', '--file', file, '--json');
      expect(saved.stderr).toBe('');
      expect(saved.exit).toBe(0);
      expect(JSON.parse(saved.stdout).author.name).toBe('cli-handoff-test');
      const listed = await cli('handoff', 'list', 'mr', '77', '--project', '901', '--limit', '1', '--json');
      expect(JSON.parse(listed.stdout)[0].summary).toBe(checkpoint.summary);
      const brief = await cli('brief', 'mr', '77', '--project', '901', '--json');
      expect(brief.exit).toBe(0);
      expect(JSON.parse(brief.stdout).handoffs[0].summary).toBe(checkpoint.summary);
      const readable = await cli('brief', 'mr', '77', '--project', '901');
      expect(readable.exit).toBe(0);
      expect(readable.stdout).toContain('Handoffs (agent reported)');
      expect(readable.stdout).toContain('Use the existing cache');
      writeFileSync(file, '{invalid json');
      expect((await cli('handoff', 'save', 'mr', '77', '--project', '901', '--file', file)).exit).toBe(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('parses explicit issue and MR references and rejects ambiguous kinds', () => {
    expect(parseTask('issue', '#42')).toEqual({ kind: 'work_item', iid: 42 });
    expect(parseTask('mr', '!7')).toEqual({ kind: 'merge_request', iid: 7 });
    expect(() => parseTask('pipeline', '1')).toThrow('Task must');
    expect(() => parseTask('mr', '-1')).toThrow('positive integer');
  });
});
