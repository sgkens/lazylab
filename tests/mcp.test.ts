import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GitLabClient } from '../server/gitlabClient.ts';
import { handleMessage, listTools, resolveProject, SUPPORTED_PROTOCOL_VERSIONS, TOOLS, validateArgs } from '../server/mcp.ts';
import { vault } from '../server/vault.ts';
import { watchManager } from '../server/watch.ts';

const demo = new GitLabClient();
const ctx = () => ({ client: demo });
const call = (name: string, args: unknown, id = 1) =>
  handleMessage({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, ctx);
const payload = (res: any) => JSON.parse(res.result.content[0].text);

beforeAll(async () => {
  if (!vault.isInitialized()) await vault.initialize('tester', 'correct horse battery');
  watchManager.attach(() => demo);
});

// The watch manager is a process-wide singleton shared with other test files.
afterAll(() => {
  for (const w of watchManager.listWatches()) watchManager.removeWatch(w.id);
});

describe('protocol', () => {
  test('initialize negotiates a supported version and falls back to the latest', async () => {
    const old = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, ctx);
    expect((old as any).result.protocolVersion).toBe('2025-03-26');
    expect((old as any).result.capabilities.tools).toBeDefined();
    expect((old as any).result.serverInfo.name).toBe('lazylab');
    const unknown = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, ctx);
    expect((unknown as any).result.protocolVersion).toBe(SUPPORTED_PROTOCOL_VERSIONS[0]);
  });

  test('notifications and client responses get no reply', async () => {
    expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx)).toBeNull();
    expect(await handleMessage({ jsonrpc: '2.0', id: 5, result: {} }, ctx)).toBeNull();
  });

  test('ping, unknown method and invalid requests', async () => {
    expect(await handleMessage({ jsonrpc: '2.0', id: 'a', method: 'ping' }, ctx)).toEqual({ jsonrpc: '2.0', id: 'a', result: {} });
    expect((await handleMessage({ jsonrpc: '2.0', id: 3, method: 'resources/list' }, ctx))!.error!.code).toBe(-32601);
    expect((await handleMessage({ id: 4, method: 'ping' }, ctx))!.error!.code).toBe(-32600);
  });

  test('tools/list carries schemas and read-only hints', () => {
    const tools = listTools();
    expect(tools.map((t) => t.name)).toContain('get_pipeline_failures');
    const failures = tools.find((t) => t.name === 'get_pipeline_failures')!;
    expect(failures.annotations.readOnlyHint).toBe(true);
    expect(failures.inputSchema.required).toEqual(['project', 'pipeline_id']);
    const run = tools.find((t) => t.name === 'run_pipeline')!;
    expect(run.annotations.readOnlyHint).toBe(false);
    expect(run.annotations.idempotentHint).toBe(false);
    expect(new Set(listTools(true).map((t) => t.name)).size).toBe(TOOLS.length);
  });

  test('unknown tool is a protocol error; bad arguments are a tool error', async () => {
    expect((await call('nope', {}))!.error!.code).toBe(-32602);
    const bad = (await call('get_job_failure', { project: 902 })) as any;
    expect(bad.result.isError).toBe(true);
    expect(bad.result.content[0].text).toBe('job_id is required');
  });
});

describe('validateArgs', () => {
  const schema = TOOLS.find((t) => t.name === 'list_merge_requests')!.inputSchema;
  test('accepts ids and paths for project, checks enums and unknown keys', () => {
    expect(validateArgs(schema, { project: 1 })).toBeNull();
    expect(validateArgs(schema, { project: 'group/app', state: 'merged' })).toBeNull();
    expect(validateArgs(schema, { project: 1, state: 'draft' })).toContain('one of');
    expect(validateArgs(schema, { project: 1.5 })).toContain('integer or a string');
    expect(validateArgs(schema, { project: 1, extra: true })).toBe('unknown argument "extra"');
    expect(validateArgs(schema, [])).toBe('arguments must be an object');
  });

  test('checks nested array items', () => {
    const run = TOOLS.find((t) => t.name === 'run_pipeline')!.inputSchema;
    expect(validateArgs(run, { project: 1, ref: 'main', variables: [{ key: 'A', value: '1' }] })).toBeNull();
    expect(validateArgs(run, { project: 1, ref: 'main', variables: [{ key: 'A' }] })).toContain('variables');
  });
});

describe('tools against demo data', () => {
  test('resolveProject accepts ids, numeric strings and paths', async () => {
    expect(await resolveProject(demo, 902)).toBe(902);
    expect(await resolveProject(demo, '902')).toBe(902);
    expect(await resolveProject(demo, 'platform/gitlab-orchestrator')).toBe(901);
    await expect(resolveProject(demo, 'missing/project')).rejects.toThrow('not found');
  });

  test('get_pipeline_failures returns the error line and log excerpt', async () => {
    const res = (await call('get_pipeline_failures', { project: 902, pipeline_id: 30103 })) as any;
    expect(res.result.isError).toBe(false);
    const [f] = payload(res);
    expect(f.job).toBe('unit:concurrency');
    expect(f.error_line).toContain('deadlock detected');
    expect(f.exit_code).toBe(1);
    expect(f.log).toContain('ERROR: Job failed');
  });

  test('list_projects filters by search and get_work_item returns a slim record', async () => {
    const projects = payload(await call('list_projects', { search: 'orchestrator' }));
    expect(projects).toHaveLength(1);
    expect(projects[0].path).toBe('platform/gitlab-orchestrator');
    const items = payload(await call('list_work_items', { project: 901, state: 'all' }));
    expect(items.length).toBeGreaterThan(0);
    const one = payload(await call('get_work_item', { project: 901, iid: items[0].iid }));
    expect(one.iid).toBe(items[0].iid);
    expect(one).toHaveProperty('comments');
    expect(one).not.toHaveProperty('avatar_url');
  });

  test('run_pipeline starts and watches a pipeline; invalid variables are a tool error', async () => {
    const res = payload(await call('run_pipeline', { project: 'platform/gitlab-orchestrator', ref: 'main' }));
    expect(res.status).toBe('pending');
    expect(res.watched).toBe(true);
    expect(watchManager.listWatches().some((w) => w.target_id === res.id && w.source === 'agent')).toBe(true);
    const bad = (await call('run_pipeline', { project: 901, ref: 'main', variables: [{ key: 'BAD-KEY', value: 'x' }] })) as any;
    expect(bad.result.isError).toBe(true);
  });

  test('a GitLab error becomes a tool error, not a protocol error', async () => {
    const res = (await call('get_merge_request', { project: 901, iid: 99999 })) as any;
    expect(res.error).toBeUndefined();
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain('not found');
  });
});
