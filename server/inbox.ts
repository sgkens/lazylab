/**
 * "My work" inbox: one list of what needs the current user, across every member project.
 *
 * Live mode uses the GitLab endpoints that are scoped to the current user:
 *   /merge_requests?scope=created_by_me | reviewer_username=<me>, /issues?scope=assigned_to_me, /todos.
 * Demo mode derives the same shape from the demo dataset.
 */
import { cacheDb } from './cacheDb.js';
import { mapLimit } from './concurrency.js';
import { GitLabClient, GitLabMergeRequest, GitLabUser, GitLabWorkItem, mapMergeRequest, mapWorkItem } from './gitlabClient.js';

export type InboxBucket = 'action' | 'waiting' | 'assigned';

export interface InboxTodo {
  id: number;
  action_name: string;
  body?: string;
  author?: { name: string; username: string };
}

export interface InboxItem {
  key: string;
  kind: 'merge_request' | 'issue' | 'todo';
  bucket: InboxBucket;
  /** Short reason the item is in the inbox, e.g. "Pipeline failed". */
  reason: string;
  title: string;
  web_url: string;
  project_id: number;
  iid: number;
  reference?: string;
  updated_at: string;
  author?: { name: string; username: string };
  merge_request?: GitLabMergeRequest;
  issue?: GitLabWorkItem;
  /** Pending GitLab To-Dos that point at this item. */
  todos: InboxTodo[];
}

export interface Inbox {
  user: { username: string; name: string } | null;
  generatedAt: number;
  items: InboxItem[];
  counts: Record<InboxBucket, number>;
  /** Sources that failed; the rest of the inbox is still returned. */
  errors: string[];
}

const DETAIL_LIMIT = 20;
const CACHE_KEY = 'inbox:me';
const CACHE_TTL_MS = 30_000;

// ---- classification (pure, unit tested) ------------------------------------

/** Where one of my own open MRs stands. */
export function classifyAuthoredMr(mr: GitLabMergeRequest): { bucket: InboxBucket; reason: string } {
  if (mr.has_conflicts) return { bucket: 'action', reason: 'Merge conflicts' };
  const pipeline = mr.pipeline?.status;
  if (pipeline === 'failed') return { bucket: 'action', reason: 'Pipeline failed' };
  if (mr.draft) return { bucket: 'waiting', reason: 'Draft' };
  if (mr.detailed_merge_status === 'mergeable') return { bucket: 'action', reason: 'Ready to merge' };
  if (mr.detailed_merge_status === 'need_rebase') return { bucket: 'action', reason: 'Needs rebase' };
  if (mr.detailed_merge_status === 'discussions_not_resolved') return { bucket: 'action', reason: 'Unresolved threads' };
  if (pipeline === 'running' || pipeline === 'pending' || mr.detailed_merge_status === 'ci_still_running') {
    return { bucket: 'waiting', reason: 'Pipeline running' };
  }
  if (mr.detailed_merge_status === 'not_approved') return { bucket: 'waiting', reason: 'Waiting for approval' };
  return { bucket: 'waiting', reason: 'Waiting for review' };
}

const TODO_REASONS: Record<string, { bucket: InboxBucket; reason: string }> = {
  review_requested: { bucket: 'action', reason: 'Review requested' },
  approval_required: { bucket: 'action', reason: 'Approval required' },
  mentioned: { bucket: 'action', reason: 'Mentioned' },
  directly_addressed: { bucket: 'action', reason: 'Mentioned' },
  build_failed: { bucket: 'action', reason: 'Pipeline failed' },
  unmergeable: { bucket: 'action', reason: 'Cannot be merged' },
  merge_train_removed: { bucket: 'action', reason: 'Removed from merge train' },
  assigned: { bucket: 'assigned', reason: 'Assigned' },
  marked: { bucket: 'assigned', reason: 'Marked as To-Do' }
};

export function classifyTodo(actionName: string): { bucket: InboxBucket; reason: string } {
  return TODO_REASONS[actionName] ?? { bucket: 'assigned', reason: actionName.replace(/_/g, ' ') };
}

const BUCKET_ORDER: Record<InboxBucket, number> = { action: 0, waiting: 1, assigned: 2 };

/** Merges MR, issue and To-Do sources into one de-duplicated, sorted list. */
export function assembleInbox(input: {
  me: GitLabUser;
  authored: GitLabMergeRequest[];
  reviewing: GitLabMergeRequest[];
  assignedIssues: GitLabWorkItem[];
  todos: any[];
}): InboxItem[] {
  const items = new Map<string, InboxItem>();

  const fromMr = (mr: GitLabMergeRequest, bucket: InboxBucket, reason: string): InboxItem => ({
    key: `mr:${mr.project_id}:${mr.iid}`,
    kind: 'merge_request',
    bucket,
    reason,
    title: mr.title,
    web_url: mr.web_url,
    project_id: mr.project_id,
    iid: mr.iid,
    reference: mr.reference,
    updated_at: mr.updated_at,
    author: { name: mr.author.name, username: mr.author.username },
    merge_request: mr,
    todos: []
  });

  for (const mr of input.authored) {
    const { bucket, reason } = classifyAuthoredMr(mr);
    items.set(`mr:${mr.project_id}:${mr.iid}`, fromMr(mr, bucket, reason));
  }
  for (const mr of input.reviewing) {
    const key = `mr:${mr.project_id}:${mr.iid}`;
    if (items.has(key) || mr.author.username === input.me.username) continue;
    items.set(key, fromMr(mr, mr.draft ? 'waiting' : 'action', mr.draft ? 'Review requested (draft)' : 'Review requested'));
  }
  for (const issue of input.assignedIssues) {
    const key = `issue:${issue.project_id}:${issue.iid}`;
    items.set(key, {
      key,
      kind: 'issue',
      bucket: 'assigned',
      reason: 'Assigned',
      title: issue.title,
      web_url: issue.web_url,
      project_id: issue.project_id,
      iid: issue.iid,
      reference: issue.reference,
      updated_at: issue.updated_at,
      author: { name: issue.author.name, username: issue.author.username },
      issue,
      todos: []
    });
  }

  for (const t of input.todos) {
    const todo: InboxTodo = {
      id: t.id,
      action_name: t.action_name,
      body: t.body,
      author: t.author ? { name: t.author.name, username: t.author.username } : undefined
    };
    const kindKey = t.target_type === 'MergeRequest' ? 'mr' : t.target_type === 'Issue' ? 'issue' : 'todo';
    const iid = t.target?.iid ?? 0;
    const projectId = t.project?.id ?? t.target?.project_id ?? 0;
    const key = kindKey === 'todo' ? `todo:${t.id}` : `${kindKey}:${projectId}:${iid}`;
    const { bucket, reason } = classifyTodo(t.action_name);

    const existing = items.get(key);
    if (existing) {
      existing.todos.push(todo);
      // A To-Do that asks for action promotes an item that was only "assigned" or "waiting".
      if (BUCKET_ORDER[bucket] < BUCKET_ORDER[existing.bucket]) {
        existing.bucket = bucket;
        existing.reason = reason;
      }
      continue;
    }
    items.set(key, {
      key,
      kind: kindKey === 'mr' ? 'merge_request' : kindKey === 'issue' ? 'issue' : 'todo',
      bucket,
      reason,
      title: t.target?.title ?? t.body ?? t.action_name,
      web_url: t.target_url ?? t.target?.web_url ?? '',
      project_id: projectId,
      iid,
      reference: t.target?.references?.full,
      updated_at: t.updated_at ?? t.created_at,
      author: todo.author,
      todos: [todo]
    });
  }

  return [...items.values()].sort(
    (a, b) => BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] || b.updated_at.localeCompare(a.updated_at)
  );
}

function countBuckets(items: InboxItem[]): Record<InboxBucket, number> {
  const counts: Record<InboxBucket, number> = { action: 0, waiting: 0, assigned: 0 };
  for (const item of items) counts[item.bucket]++;
  return counts;
}

// ---- data sources -----------------------------------------------------------

async function loadLive(client: GitLabClient, me: GitLabUser) {
  const errors: string[] = [];
  const settle = async <T>(label: string, run: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await run();
    } catch (err: any) {
      errors.push(`${label}: ${err.message}`);
      return fallback;
    }
  };

  const [authoredList, reviewing, assignedIssues, todos] = await Promise.all([
    settle('My merge requests', async () =>
      (await client.apiGet<any[]>('/merge_requests?scope=created_by_me&state=opened&per_page=50')).map(mapMergeRequest), []),
    settle('Review requests', async () =>
      (await client.apiGet<any[]>(
        `/merge_requests?scope=all&state=opened&reviewer_username=${encodeURIComponent(me.username)}&per_page=50`
      )).map(mapMergeRequest), []),
    settle('Assigned issues', async () =>
      (await client.apiGet<any[]>('/issues?scope=assigned_to_me&state=opened&per_page=50')).map(mapWorkItem), []),
    settle('To-Dos', () => client.apiGet<any[]>('/todos?state=pending&per_page=50'), [])
  ]);

  // List responses carry no pipeline; fetch the single MR for my own (usually few) open MRs.
  const detailed = await mapLimit(authoredList.slice(0, DETAIL_LIMIT), 4, async (mr) =>
    mapMergeRequest(await client.apiGet<any>(`/projects/${mr.project_id}/merge_requests/${mr.iid}`))
  );
  const authored = authoredList.map((mr, i) => {
    const d = detailed[i];
    return d && d.status === 'fulfilled' ? d.value : mr;
  });

  return { authored, reviewing, assignedIssues, todos, errors };
}

async function loadDemo(client: GitLabClient, me: GitLabUser) {
  const [mrs, issues] = await Promise.all([
    client.getMergeRequests(undefined, 'opened'),
    client.getWorkItems(undefined, 'opened')
  ]);
  return {
    authored: mrs.filter((m) => m.author.username === me.username),
    reviewing: mrs.filter((m) => m.reviewers.some((r) => r.username === me.username)),
    assignedIssues: issues.filter((i) => i.assignees.some((a) => a.username === me.username)),
    todos: [] as any[],
    errors: [] as string[]
  };
}

export async function getInbox(client: GitLabClient, force = false): Promise<Inbox> {
  if (!force && !client.isDemo()) {
    const cached = cacheDb.get<Inbox>(CACHE_KEY);
    if (cached) return cached.data;
  }

  let me: GitLabUser;
  try {
    me = await client.getCurrentUser();
  } catch (err: any) {
    return { user: null, generatedAt: Date.now(), items: [], counts: countBuckets([]), errors: [`Current user: ${err.message}`] };
  }

  const sources = client.isDemo() ? await loadDemo(client, me) : await loadLive(client, me);
  const items = assembleInbox({ me, ...sources });
  const inbox: Inbox = {
    user: { username: me.username, name: me.name },
    generatedAt: Date.now(),
    items,
    counts: countBuckets(items),
    errors: sources.errors
  };
  if (!client.isDemo() && sources.errors.length === 0) {
    cacheDb.set(CACHE_KEY, 'inbox', null, inbox, undefined, CACHE_TTL_MS);
  }
  return inbox;
}
