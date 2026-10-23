import { beforeAll, describe, expect, test } from 'bun:test';
import { GitLabClient, GitLabRunner } from '../server/gitlabClient.ts';
import { Inbox, InboxItem } from '../server/inbox.ts';
import { LazyNotification } from '../server/notify.ts';
import { vault } from '../server/vault.ts';
import { watchManager } from '../server/watch.ts';

const demo = new GitLabClient();
const received: LazyNotification[] = [];

beforeAll(async () => {
  if (!vault.isInitialized()) await vault.initialize('tester', 'correct horse battery');
  // Session tests can trigger the router's background inbox refresh in the shared process.
  // Keep automatic MR watches from racing this suite's explicitly created watches.
  watchManager.stop();
  vault.updateNotify((n) => {
    n.watches = [];
    n.rules.myMrPipelines = false;
  });
  watchManager.attach(() => demo);
  watchManager.on('notification', (n) => received.push(n));
});

const runner = (status: GitLabRunner['status']): GitLabRunner => ({
  id: 7,
  description: 'desktop-docker',
  active: true,
  paused: false,
  is_shared: false,
  runner_type: 'project_type',
  status,
  tag_list: []
});

const reviewItem = (sha: string): InboxItem =>
  ({
    key: 'mr:1:2',
    kind: 'merge_request',
    bucket: 'action',
    reason: 'Review requested',
    title: 'Add cache',
    web_url: 'u',
    project_id: 1,
    iid: 2,
    updated_at: '',
    author: { name: 'O', username: 'other' },
    merge_request: { author: { username: 'other' }, sha } as any,
    todos: []
  }) as InboxItem;

const inbox = (items: InboxItem[]): Inbox => ({
  user: { username: 'me', name: 'Me' },
  generatedAt: Date.now(),
  items,
  counts: { action: items.length, waiting: 0, assigned: 0 },
  errors: []
});

describe('watchManager', () => {
  test('a watch on a finished demo pipeline notifies immediately and is removed', async () => {
    received.length = 0;
    await watchManager.addWatch({ kind: 'pipeline', project_id: 901, target_id: 30101, source: 'manual' });
    expect(received.map((n) => n.title)).toEqual(['Pipeline #30101 passed']);
    expect(watchManager.listWatches()).toHaveLength(0);
  });

  test('a failed pipeline notification names the failing job and its error line', async () => {
    received.length = 0;
    await watchManager.addWatch({ kind: 'pipeline', project_id: 902, target_id: 30103, source: 'manual' });
    expect(received).toHaveLength(1);
    const n = received[0];
    expect(n.level).toBe('failure');
    expect(n.body).toContain('unit:concurrency: ');
    expect(n.body).toContain('deadlock detected');
    expect(n.failedJob).toEqual({ projectId: 902, jobId: 7021, name: 'unit:concurrency' });
  });

  test('a watch on a running pipeline stays, is de-duplicated and persisted in the vault', async () => {
    received.length = 0;
    const a = await watchManager.addWatch({ kind: 'pipeline', project_id: 901, target_id: 30102, source: 'manual' });
    const b = await watchManager.addWatch({ kind: 'pipeline', project_id: 901, target_id: 30102, source: 'agent' });
    expect(a.id).toBe(b.id);
    expect(a.status).toBe('running');
    expect(received).toHaveLength(0);
    expect(vault.getNotify().watches.map((w) => w.target_id)).toEqual([30102]);
    watchManager.removeWatch(a.id);
    expect(vault.getNotify().watches).toHaveLength(0);
  });

  test('runner rule: silent baseline, then offline and back online', () => {
    received.length = 0;
    watchManager.stop();
    watchManager.onRunners([runner('online')]);
    expect(received).toHaveLength(0);
    watchManager.onRunners([runner('offline')]);
    watchManager.onRunners([runner('online')]);
    expect(received.map((n) => [n.level, n.title])).toEqual([
      ['failure', 'Runner offline'],
      ['success', 'Runner back online']
    ]);
  });

  test('review rules: new request and new commits, after a silent baseline', async () => {
    received.length = 0;
    watchManager.stop();
    await watchManager.onInbox(inbox([]));
    await watchManager.onInbox(inbox([reviewItem('aaa')]));
    await watchManager.onInbox(inbox([reviewItem('aaa')]));
    await watchManager.onInbox(inbox([reviewItem('bbb')]));
    expect(received.map((n) => n.title)).toEqual(['Review requested', 'New commits on an MR you review']);
  });

  test('rules can be switched off', async () => {
    received.length = 0;
    vault.updateNotify((n) => {
      n.rules.runnerOffline = false;
    });
    watchManager.stop();
    watchManager.onRunners([runner('online')]);
    watchManager.onRunners([runner('offline')]);
    expect(received).toHaveLength(0);
  });
});
