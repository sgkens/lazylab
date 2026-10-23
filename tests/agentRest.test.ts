// Agent REST routes (/api/agent/*) over HTTP with bearer tokens, against demo data.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import express from 'express';
import type { Server } from 'http';
import { apiGuard } from '../server/session.ts';
import { vault } from '../server/vault.ts';

let server: Server;
let base: string;
let token: string;

beforeAll(async () => {
  if (!vault.isInitialized()) await vault.initialize('tester', 'correct horse battery');
  // Imported after the vault is unlocked so the router's unlock hook (auto-fetch timers) does not fire here.
  const { apiRouter } = await import('../server/apiRouter.ts');
  token = vault.createAgentToken('rest-test').token;
  const app = express();
  app.use(express.json());
  app.use('/api', apiGuard);
  app.use('/api', apiRouter);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as any).port}/api/agent`;
});
afterAll(() => server.close());

const call = async (method: string, url: string, body?: unknown, bearer = token) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
};

describe('projectId is required (GL-21)', () => {
  const routes: [string, string, unknown?][] = [
    ['GET', '/work-items'],
    ['GET', '/work-items/1'],
    ['POST', '/work-items', { title: 'No project' }],
    ['PATCH', '/work-items/1', { state_event: 'close' }],
    ['PUT', '/work-items/1', { title: 'x' }],
    ['GET', '/merge-requests'],
    ['GET', '/merge-requests/1'],
    ['POST', '/merge-requests', { title: 'No project', source_branch: 'feature' }],
    ['PATCH', '/merge-requests/1', { state_event: 'close' }],
    ['POST', '/pipelines', { ref: 'main' }],
    ['GET', '/pipelines/1/failures'],
    ['GET', '/jobs/1/failure']
  ];

  for (const [method, url, body] of routes) {
    test(`${method} ${url} without projectId answers 400`, async () => {
      const res = await call(method, url, body);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('projectId is required');
    });
  }

  test('rejects a projectId that is not a positive integer', async () => {
    for (const bad of ['abc', '-3', '0', '1.5', '0x10', '1&projectId=2']) {
      const res = await call('GET', `/work-items?projectId=${bad}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('positive integer');
    }
    expect((await call('POST', '/work-items', { title: 'x', projectId: 'group/project' })).status).toBe(400);
  });

  test('a write without a body is a 400, not a crash', async () => {
    const res = await fetch(`${base}/work-items/1`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(400);
  });

  test('works with an explicit projectId', async () => {
    const list = await call('GET', '/work-items?projectId=901');
    expect(list.status).toBe(200);
    expect(list.body.projectId).toBe(901);
    const created = await call('POST', '/work-items', { projectId: 901, title: '[test] Explicit project' });
    expect(created.status).toBe(201);
    expect(created.body.workItem.project_id).toBe(901);
  });

  test('missing or bad tokens never reach a route', async () => {
    expect((await call('GET', '/work-items?projectId=901', undefined, '')).status).toBe(401);
    expect((await call('GET', '/work-items?projectId=901', undefined, 'llab_wrong')).status).toBe(401);
  });
});
