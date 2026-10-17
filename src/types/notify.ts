// Mirrors server/notify.ts, server/watch.ts and the public shape from server/notifyRouter.ts.
export type NotifyLevel = 'success' | 'failure' | 'info';
export type WatchKind = 'pipeline' | 'job' | 'merge_request';

export interface LazyNotification {
  id: string;
  title: string;
  body: string;
  url?: string;
  level: NotifyLevel;
  source: string;
  failedJob?: { projectId: number; jobId: number; name: string };
  createdAt: number;
  read: boolean;
}

export interface WatchView {
  id: string;
  kind: WatchKind;
  project_id: number;
  target_id: number;
  label: string;
  web_url: string;
  source: 'manual' | 'auto' | 'agent';
  createdAt: string;
  status?: string;
  checkedAt?: number;
  error?: string;
}

export type NotifyChannelType = 'ntfy' | 'gotify' | 'webhook';

export interface NotifyChannelInfo {
  id: string;
  type: NotifyChannelType;
  name: string;
  urlHint: string;
  topic?: string;
  tokenHint?: string;
  format?: 'json' | 'slack' | 'discord';
  events: 'all' | 'failures';
  enabled: boolean;
  createdAt: string;
  lastDeliveredAt?: number;
  lastError?: string;
}

export interface NotifyRules {
  myMrPipelines: boolean;
  reviewRequests: boolean;
  reReview: boolean;
  runnerOffline: boolean;
  tokenExpiry: boolean;
}

export interface NotifyState {
  rules: NotifyRules;
  channels: NotifyChannelInfo[];
  watches: WatchView[];
  notifications: LazyNotification[];
  unread: number;
}

export interface NotifyChannelInput {
  type: NotifyChannelType;
  name: string;
  url: string;
  topic?: string;
  token?: string;
  format?: 'json' | 'slack' | 'discord';
  events: 'all' | 'failures';
  enabled?: boolean;
}
