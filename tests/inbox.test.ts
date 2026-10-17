import { describe, expect, test } from 'bun:test';
import { GitLabClient, GitLabMergeRequest, GitLabUser, GitLabWorkItem } from '../server/gitlabClient.ts';
import { assembleInbox, classifyAuthoredMr, classifyTodo, getInbox } from '../server/inbox.ts';

const me: GitLabUser = { id: 1, username: 'me', name: 'Me', avatar_url: '', web_url: '' };
const other = { id: 2, name: 'Other', username: 'other', avatar_url: '' };

function mr(overrides: Partial<GitLabMergeRequest> = {}): GitLabMergeRequest {
  return {
    id: 100,
    iid: 1,
    project_id: 10,
    title: 'Change',
    description: '',
    state: 'opened',
    draft: false,
    work_in_progress: false,
    merge_status: 'can_be_merged',
    detailed_merge_status: 'not_approved',
    source_branch: 'feature',
    target_branch: 'main',
    author: { ...me, avatar_url: '' },
    assignees: [],
    reviewers: [],
    labels: [],
    has_conflicts: false,
    web_url: 'https://gitlab.example/p/-/merge_requests/1',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
    ...overrides
  };
}

function issue(overrides: Partial<GitLabWorkItem> = {}): GitLabWorkItem {
  return {
    id: 200,
    iid: 7,
    project_id: 10,
    title: 'Bug',
    description: '',
    state: 'opened',
    work_item_type: 'Issue',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    closed_at: null,
    labels: [],
    milestone: null,
    assignees: [{ ...me, avatar_url: '' }],
    author: other,
    user_notes_count: 0,
    upvotes: 0,
    web_url: 'https://gitlab.example/p/-/issues/7',
    ...overrides
  };
}

const pipeline = (status: any) => ({ id: 1, status, web_url: '', ref: 'feature', sha: 'abc' });

describe('classifyAuthoredMr', () => {
  test.each([
    [{ has_conflicts: true, pipeline: pipeline('failed') }, 'action', 'Merge conflicts'],
    [{ pipeline: pipeline('failed') }, 'action', 'Pipeline failed'],
    [{ draft: true, detailed_merge_status: 'mergeable' }, 'waiting', 'Draft'],
    [{ detailed_merge_status: 'mergeable' }, 'action', 'Ready to merge'],
    [{ detailed_merge_status: 'need_rebase' }, 'action', 'Needs rebase'],
    [{ pipeline: pipeline('running') }, 'waiting', 'Pipeline running'],
    [{ detailed_merge_status: 'not_approved' }, 'waiting', 'Waiting for approval'],
    [{ detailed_merge_status: 'checking' }, 'waiting', 'Waiting for review']
  ] as const)('%o -> %s / %s', (overrides, bucket, reason) => {
    expect(classifyAuthoredMr(mr(overrides as any))).toEqual({ bucket, reason });
  });
});

describe('classifyTodo', () => {
  test('known and unknown action names', () => {
    expect(classifyTodo('review_requested')).toEqual({ bucket: 'action', reason: 'Review requested' });
    expect(classifyTodo('assigned').bucket).toBe('assigned');
    expect(classifyTodo('member_access_requested')).toEqual({ bucket: 'assigned', reason: 'member access requested' });
  });
});

describe('assembleInbox', () => {
  test('dedupes To-Dos onto existing items and promotes the bucket', () => {
    const items = assembleInbox({
      me,
      authored: [],
      reviewing: [],
      assignedIssues: [issue()],
      todos: [
        {
          id: 9,
          action_name: 'mentioned',
          target_type: 'Issue',
          target: { iid: 7, title: 'Bug' },
          project: { id: 10 },
          author: other,
          created_at: '2026-10-03T00:00:00Z'
        }
      ]
    });
    expect(items).toHaveLength(1);
    expect(items[0].bucket).toBe('action');
    expect(items[0].reason).toBe('Mentioned');
    expect(items[0].todos.map((t) => t.id)).toEqual([9]);
  });

  test('skips review requests on my own MRs and sorts action first', () => {
    const items = assembleInbox({
      me,
      authored: [mr({ iid: 1, detailed_merge_status: 'not_approved', updated_at: '2026-10-05T00:00:00Z' })],
      reviewing: [
        mr({ iid: 1 }),
        mr({ iid: 2, author: other, updated_at: '2026-10-01T00:00:00Z' })
      ],
      assignedIssues: [],
      todos: []
    });
    expect(items.map((i) => [i.iid, i.bucket, i.reason])).toEqual([
      [2, 'action', 'Review requested'],
      [1, 'waiting', 'Waiting for approval']
    ]);
  });

  test('keeps To-Dos without a matching item as their own entries', () => {
    const items = assembleInbox({
      me,
      authored: [],
      reviewing: [],
      assignedIssues: [],
      todos: [
        {
          id: 3,
          action_name: 'build_failed',
          target_type: 'MergeRequest',
          target: { iid: 4, title: 'Other MR', web_url: 'u' },
          project: { id: 11 },
          created_at: '2026-10-03T00:00:00Z'
        }
      ]
    });
    expect(items[0]).toMatchObject({ key: 'mr:11:4', kind: 'merge_request', bucket: 'action', reason: 'Pipeline failed' });
  });
});

describe('getInbox (demo mode)', () => {
  test('returns items for the demo user without errors', async () => {
    const inbox = await getInbox(new GitLabClient());
    expect(inbox.errors).toEqual([]);
    expect(inbox.user?.username).toBeTruthy();
    expect(inbox.items.length).toBeGreaterThan(0);
    const total = inbox.counts.action + inbox.counts.waiting + inbox.counts.assigned;
    expect(total).toBe(inbox.items.length);
  });
});
