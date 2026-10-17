import { GitLabMergeRequest, GitLabWorkItem } from './gitlab';

// Mirrors server/inbox.ts.
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
  todos: InboxTodo[];
}

export interface Inbox {
  user: { username: string; name: string } | null;
  generatedAt: number;
  items: InboxItem[];
  counts: Record<InboxBucket, number>;
  errors: string[];
}
