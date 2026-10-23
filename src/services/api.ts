import {
  AppStatus,
  AggregateResponse,
  GitLabLabel,
  GitLabMergeRequest,
  GitLabPipeline,
  GitLabProject,
  GitLabRunner,
  GitLabWorkItem,
  GitLabJob,
  GitLabMilestone,
  GitLabNote,
  SubTask,
  WorkItemType,
  GitLabPackage,
  GitLabTag,
  GitLabRelease,
  JobTrace,
  JobFailure,
  FailureExcerpt,
  GitLabBranch,
  DeclaredVariable,
  PipelineVariableInput,
  RunnerJob,
  CiConfig,
  CiLintResult,
  GitLabVariable,
  GitLabBadge,
  GitLabPagesInfo,
  MetricsSummary,
  RequestBudget
} from '../types/gitlab';
import { Inbox } from '../types/inbox';
import { Note, NoteFilter, NoteInput, NoteMigrateOptions, NoteNamespace } from '../types/notes';
import { NotifyChannelInfo, NotifyChannelInput, NotifyRules, NotifyState, WatchKind, WatchView } from '../types/notify';
import { AgentTokenSettings, DeviceSession, SessionState, TokenOverview, VaultEntryKind, VaultSummary } from '../types/vault';

const post = (body?: unknown): RequestInit => ({ method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {})
    }
  });

  if (res.status === 401 && !endpoint.startsWith('/session/')) {
    window.dispatchEvent(new CustomEvent('lazylab:unauthorized'));
  }

  const data = await res.json();
  if (!res.ok || data.success === false) {
    // The body stays reachable for responses that carry data on failure (token rotation).
    throw Object.assign(new Error(data.error || `HTTP error ${res.status}`), { data });
  }
  const aggregateKind = endpoint.split('?')[0].slice(1);
  if (['work_items', 'merge_requests', 'pipelines', 'milestones', 'labels', 'packages'].includes(aggregateKind) && (!options?.method || options.method === 'GET')) {
    window.dispatchEvent(new CustomEvent('lazylab:aggregate', { detail: { kind: aggregateKind, coverage: data.coverage, errors: data.errors || [] } }));
  }
  return data;
}

export const sessionApi = {
  state: () => request<SessionState>('/session/state'),
  recoveryStatus: () => request<{ configured: boolean; createdAt: string | null }>('/session/recovery'),
  createRecoveryKey: (currentPassword: string) => request<{ recoveryKey: string }>('/session/recovery', post({ currentPassword })),
  removeRecoveryKey: (currentPassword: string) => request('/session/recovery/remove', post({ currentPassword })),
  recover: (recoveryKey: string, newPassword: string) => request('/session/recover', post({ recoveryKey, newPassword })),
  backup: (currentPassword: string) => request<{ backup: unknown }>('/session/backup', post({ currentPassword })),
  restore: (payload: { backup: unknown; credential: { password?: string; recoveryKey?: string; newPassword?: string }; currentPassword?: string; setupCode?: string; replaceNewer?: boolean }) => request('/session/restore', post(payload)),
  setup: (payload: { setupCode: string; username: string; password: string; gitlabHost?: string; gitlabToken?: string }) =>
    request<{ success: boolean }>('/session/setup', post(payload)),
  login: (username: string, password: string) => request<{ success: boolean }>('/session/login', post({ username, password })),
  logout: () => request<{ success: boolean }>('/session/logout', post()),
  lock: () => request<{ success: boolean }>('/session/lock', post()),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ success: boolean }>('/session/password', post({ currentPassword, newPassword })),
  devices: () => request<{ success: boolean; devices: DeviceSession[] }>('/session/devices'),
  revokeDevice: (id: string) =>
    request<{ success: boolean; self: boolean }>(`/session/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })
};

export const vaultApi = {
  summary: () => request<VaultSummary>('/vault/summary'),
  reveal: (kind: 'profile' | VaultEntryKind, id: string) => request<{ success: boolean; value: string }>('/vault/reveal', post({ kind, id })),

  addProfile: (payload: { name?: string; host: string; token: string; activate?: boolean }) => request<VaultSummary>('/vault/profiles', post(payload)),
  updateProfile: (id: string, payload: { name: string; host: string; token?: string }) =>
    request<VaultSummary>(`/vault/profiles/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  activateProfile: (id: string) => request<VaultSummary>(`/vault/profiles/${id}/activate`, post()),
  deactivateProfile: () => request<VaultSummary>('/vault/profiles/deactivate', post()),
  deleteProfile: (id: string) => request<VaultSummary>(`/vault/profiles/${id}`, { method: 'DELETE' }),

  addEntry: (payload: { kind: VaultEntryKind; name: string; value: string; note?: string }) => request<VaultSummary>('/vault/entries', post(payload)),
  updateEntry: (id: string, payload: { name?: string; value?: string; note?: string }) =>
    request<VaultSummary>(`/vault/entries/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteEntry: (id: string) => request<VaultSummary>(`/vault/entries/${id}`, { method: 'DELETE' }),
  pushCiSecret: (
    id: string,
    payload: { scope_type: 'project' | 'group'; scope_id: number; key: string; environment_scope?: string; masked?: boolean; protected?: boolean }
  ) => request<VaultSummary>(`/vault/entries/${id}/push`, post(payload)),

  createAgentToken: (name: string, settings: AgentTokenSettings) =>
    request<{ success: boolean; token: string }>('/vault/agent-tokens', post({ name, ...settings })),
  updateAgentToken: (id: string, settings: AgentTokenSettings) =>
    request<{ success: boolean }>(`/vault/agent-tokens/${id}`, { method: 'PATCH', body: JSON.stringify(settings) }),
  deleteAgentToken: (id: string) => request<{ success: boolean }>(`/vault/agent-tokens/${id}`, { method: 'DELETE' }),

  tokenExpiry: (force = false) => request<{ success: boolean } & TokenOverview>(`/tokens/expiry${force ? '?force=true' : ''}`),
  rotatePersonalToken: (profileId: string, expiresAt: string) =>
    request<{ success: boolean; expires_at: string | null; overview: TokenOverview | null }>(
      `/tokens/personal/${profileId}/rotate`,
      post({ expiresAt })
    )
};

export const api = {
  getStatus: () => request<AppStatus>('/status'),

  getInbox: (force = false) =>
    request<{ success: boolean; inbox: Inbox }>(`/inbox${force ? '?force=true' : ''}`),

  updateAutoFetch: (intervalSec: number) =>
    request<{ success: boolean; autoFetchIntervalSec: number }>('/config/autofetch', {
      method: 'POST',
      body: JSON.stringify({ intervalSec })
    }),

  updateWatchPoll: (intervalSec: number) =>
    request<{ success: boolean; watchPollSec: number }>('/config/watch-poll', {
      method: 'POST',
      body: JSON.stringify({ intervalSec })
    }),

  updateRequestBudget: (budget: RequestBudget) =>
    request<{ success: boolean; budget: RequestBudget }>('/config/request-budget', {
      method: 'POST',
      body: JSON.stringify(budget)
    }),

  triggerSync: () => request<{ success: boolean; lastSyncTime: number; walStats: any }>('/sync/refresh', { method: 'POST' }),

  getProjects: (force = false) =>
    request<{ success: boolean; projects: GitLabProject[] }>(`/projects${force ? '?force=true' : ''}`),

  // Milestones
  getMilestones: (projectId?: number, force = false) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', String(projectId));
    if (force) params.set('force', 'true');
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<AggregateResponse & { success: boolean; milestones: GitLabMilestone[] }>(`/milestones${qs}`);
  },

  createMilestone: (payload: { projectId: number; title: string; description?: string; due_date?: string; start_date?: string }) =>
    request<{ success: boolean; milestone: GitLabMilestone }>('/milestones', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),

  // Work Items & Sub-tasks
  getWorkItems: (projectId?: number, state: 'opened' | 'closed' | 'all' = 'all', force = false) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', String(projectId));
    if (state !== 'all') params.set('state', state);
    if (force) params.set('force', 'true');
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<AggregateResponse & { success: boolean; workItems: GitLabWorkItem[] }>(`/work_items${qs}`);
  },

  createWorkItem: (payload: {
    projectId: number;
    title: string;
    description?: string;
    issue_type?: WorkItemType;
    labels?: string[];
    assignee_ids?: number[];
    weight?: number;
    milestone_id?: number;
  }) =>
    request<{ success: boolean; workItem: GitLabWorkItem }>('/work_items', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),

  updateWorkItem: (iid: number, payload: {
    projectId: number;
    title?: string;
    description?: string;
    state_event?: 'close' | 'reopen';
    labels?: string[];
    add_labels?: string[];
    remove_labels?: string[];
    milestone_id?: number | null;
  }) =>
    request<{ success: boolean; workItem: GitLabWorkItem }>(`/work_items/${iid}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    }),

  addSubTask: (projectId: number, issueIid: number, title: string) =>
    request<{ success: boolean; subtask: SubTask; workItem: GitLabWorkItem }>(`/work_items/${issueIid}/subtasks`, {
      method: 'POST',
      body: JSON.stringify({ projectId, title })
    }),

  toggleSubTask: (projectId: number, issueIid: number, subtaskId: number, completed: boolean) =>
    request<{ success: boolean; subtasks: SubTask[]; workItem: GitLabWorkItem }>(`/work_items/${issueIid}/subtasks/${subtaskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ projectId, completed })
    }),

  // Notes & Comments
  getWorkItemNotes: (projectId: number, issueIid: number) =>
    request<{ success: boolean; notes: GitLabNote[] }>(`/work_items/${issueIid}/notes?projectId=${projectId}`),

  createWorkItemNote: (projectId: number, issueIid: number, body: string, attachment?: { name: string; url: string; size?: number }) =>
    request<{ success: boolean; note: GitLabNote }>(`/work_items/${issueIid}/notes`, {
      method: 'POST',
      body: JSON.stringify({ projectId, body, attachment })
    }),

  getMergeRequestNotes: (projectId: number, mrIid: number) =>
    request<{ success: boolean; notes: GitLabNote[] }>(`/merge_requests/${mrIid}/notes?projectId=${projectId}`),

  createMergeRequestNote: (projectId: number, mrIid: number, body: string, attachment?: { name: string; url: string; size?: number }) =>
    request<{ success: boolean; note: GitLabNote }>(`/merge_requests/${mrIid}/notes`, {
      method: 'POST',
      body: JSON.stringify({ projectId, body, attachment })
    }),

  // Merge Requests
  getMergeRequests: (projectId?: number, state: 'opened' | 'closed' | 'merged' | 'all' = 'all', force = false) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', String(projectId));
    if (state !== 'all') params.set('state', state);
    if (force) params.set('force', 'true');
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<AggregateResponse & { success: boolean; mergeRequests: GitLabMergeRequest[] }>(`/merge_requests${qs}`);
  },

  updateMergeRequest: (iid: number, payload: {
    projectId: number;
    title?: string;
    description?: string;
    draft?: boolean;
    labels?: string[];
    state_event?: 'close' | 'reopen';
  }) =>
    request<{ success: boolean; mergeRequest: GitLabMergeRequest }>(`/merge_requests/${iid}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    }),

  approveMergeRequest: (projectId: number, mrIid: number) =>
    request<{ success: boolean; result: any }>(`/merge_requests/${mrIid}/approve`, {
      method: 'POST',
      body: JSON.stringify({ projectId })
    }),

  unapproveMergeRequest: (projectId: number, mrIid: number) =>
    request<{ success: boolean; result: any }>(`/merge_requests/${mrIid}/unapprove`, {
      method: 'POST',
      body: JSON.stringify({ projectId })
    }),

  mergeMergeRequest: (iid: number, projectId: number, options: {
    shouldRemoveSourceBranch?: boolean;
    squash?: boolean;
    squashCommitMessage?: string;
    commitMessage?: string;
  } = {}) =>
    request<{ success: boolean; result: any }>(`/merge_requests/${iid}/merge`, {
      method: 'POST',
      body: JSON.stringify({ projectId, ...options })
    }),

  // Pipelines
  getPipelines: (projectId?: number, force = false) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', String(projectId));
    if (force) params.set('force', 'true');
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<AggregateResponse & { success: boolean; pipelines: GitLabPipeline[] }>(`/pipelines${qs}`);
  },

  getPipelineJobs: (projectId: number, pipelineId: number) =>
    request<{ success: boolean; stages: string[]; jobs: GitLabJob[] }>(`/pipelines/${pipelineId}/jobs?projectId=${projectId}`),

  retryPipeline: (pipelineId: number, projectId: number) =>
    request<{ success: boolean; result: any }>(`/pipelines/${pipelineId}/retry`, {
      method: 'POST',
      body: JSON.stringify({ projectId })
    }),

  cancelPipeline: (pipelineId: number, projectId: number) =>
    request<{ success: boolean; result: any }>(`/pipelines/${pipelineId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ projectId })
    }),

  retryJob: (jobId: number, projectId: number, watch = true) =>
    request<{ success: boolean; job: { id: number; name: string; status: string; web_url?: string }; watch: WatchView | null }>(
      `/jobs/${jobId}/retry`,
      post({ projectId, watch })
    ),

  uploadFile: async (projectId: number, file: File) => {
    const res = await fetch(`/api/projects/${projectId}/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
      body: file
    });
    const data = await res.json().catch(() => ({ success: false, error: res.status === 413 ? 'File is larger than 10 MB' : `HTTP ${res.status}` }));
    if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
    return data as { success: true; markdown: string; url: string };
  },

  getJobFailure: (projectId: number, jobId: number) =>
    request<{ success: boolean; failure: JobFailure }>(`/projects/${projectId}/jobs/${jobId}/failure`),

  getPipelineFailures: (projectId: number, pipelineId: number) =>
    request<{ success: boolean; failures: JobFailure[] }>(`/projects/${projectId}/pipelines/${pipelineId}/failures`),

  getBranches: (projectId: number, search = '') =>
    request<{ success: boolean; branches: GitLabBranch[] }>(
      `/projects/${projectId}/branches${search ? `?search=${encodeURIComponent(search)}` : ''}`
    ),

  getDeclaredVariables: (projectId: number, ref: string) =>
    request<{ success: boolean; variables: DeclaredVariable[] }>(
      `/projects/${projectId}/pipeline-variables?ref=${encodeURIComponent(ref)}`
    ),

  runPipeline: (projectId: number, ref: string, variables: PipelineVariableInput[], watch: boolean) =>
    request<{ success: boolean; pipeline: GitLabPipeline; watch: WatchView | null }>(
      `/projects/${projectId}/pipelines`,
      post({ ref, variables, watch })
    ),

  playJob: (jobId: number, projectId: number) =>
    request<{ success: boolean; result: any }>(`/jobs/${jobId}/play`, {
      method: 'POST',
      body: JSON.stringify({ projectId })
    }),

  // Runners
  getRunners: (force = false) =>
    request<{ success: boolean; runners: GitLabRunner[] }>(`/runners${force ? '?force=true' : ''}`),

  toggleRunner: (runnerId: number, paused: boolean) =>
    request<{ success: boolean; result: any }>(`/runners/${runnerId}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ paused })
    }),

  registerRunner: (payload: {
    description: string;
    tagList?: string[];
    runUntagged?: boolean;
    locked?: boolean;
    projectId?: number;
  }) =>
    request<{ success: boolean; runner: GitLabRunner; registrationToken: string; registerCommand: string }>('/runners/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),

  assignRunner: (runnerId: number, projectId: number) =>
    request<{ success: boolean; result: any }>(`/runners/${runnerId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ projectId })
    }),

  unassignRunner: (runnerId: number, projectId: number) =>
    request<{ success: boolean; result: any }>(`/runners/${runnerId}/unassign`, {
      method: 'POST',
      body: JSON.stringify({ projectId })
    }),

  stopRunner: (runnerId: number) =>
    request<{ success: boolean; result: any }>(`/runners/${runnerId}`, {
      method: 'DELETE'
    }),

  // Labels
  getLabels: (projectId?: number, force = false) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', String(projectId));
    if (force) params.set('force', 'true');
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<AggregateResponse & { success: boolean; labels: GitLabLabel[] }>(`/labels${qs}`);
  },

  createLabel: (projectId: number, name: string, color: string, description?: string) =>
    request<{ success: boolean; label: GitLabLabel }>('/labels', {
      method: 'POST',
      body: JSON.stringify({ projectId, name, color, description })
    }),

  // API & Cache Metrics
  getMetrics: () => request<{ success: boolean; metrics: import('../types/gitlab').MetricsSummary }>('/metrics'),

  resetMetrics: () =>
    request<{ success: boolean; metrics: MetricsSummary }>('/metrics/reset', {
      method: 'POST'
    }),

  // Packages
  getPackages: (projectId?: number, packageType?: string, force = false) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', String(projectId));
    if (packageType && packageType !== 'all') params.set('packageType', packageType);
    if (force) params.set('force', 'true');
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<AggregateResponse & { success: boolean; packages: GitLabPackage[] }>(`/packages${qs}`);
  },

  getPackageDetails: (projectId: number, packageId: number) =>
    request<{ success: boolean; package: GitLabPackage }>(`/projects/${projectId}/packages/${packageId}`),

  // Tags & Releases
  getTags: (projectId: number, force = false) =>
    request<{ success: boolean; tags: GitLabTag[] }>(`/projects/${projectId}/tags${force ? '?force=true' : ''}`),

  createTag: (projectId: number, tag_name: string, ref: string, message?: string) =>
    request<{ success: boolean; tag: GitLabTag }>(`/projects/${projectId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tag_name, ref, message })
    }),

  getReleases: (projectId: number, force = false) =>
    request<{ success: boolean; releases: GitLabRelease[] }>(`/projects/${projectId}/releases${force ? '?force=true' : ''}`),

  getReleaseNotes: (projectId: number, to: string, from?: string) =>
    request<{
      success: boolean;
      notes: { from: string | null; to: string; markdown: string; bump: 'major' | 'minor' | 'patch' | null; nextVersion: string | null; commitCount: number };
    }>(`/projects/${projectId}/release-notes?to=${encodeURIComponent(to)}${from ? `&from=${encodeURIComponent(from)}` : ''}`),

  createRelease: (projectId: number, payload: { tag_name: string; name: string; description: string; ref?: string }) =>
    request<{ success: boolean; release: GitLabRelease }>(`/projects/${projectId}/releases`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }),

  // Job Trace & Runner Jobs
  getJobTrace: (projectId: number, jobId: number) =>
    request<{ success: boolean; trace: JobTrace; failure: FailureExcerpt | null }>(`/projects/${projectId}/jobs/${jobId}/trace`),

  getRunnerJobs: (runnerId: number) =>
    request<{ success: boolean; jobs: RunnerJob[] }>(`/runners/${runnerId}/jobs`),

  // CI/CD Pipeline Editor & Visualizer
  getCiConfig: (projectId: number, ref?: string) =>
    request<{ success: boolean; config: CiConfig }>(`/projects/${projectId}/ci-config${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`),

  saveCiConfig: (projectId: number, content: string, commit_message: string, branch = 'main') =>
    request<{ success: boolean; branch: string; commit_id: string }>(`/projects/${projectId}/ci-config`, {
      method: 'POST',
      body: JSON.stringify({ content, commit_message, branch })
    }),

  lintCiConfig: (content: string, projectId?: number, remote = false) =>
    request<{ success: boolean; lint: CiLintResult }>('/ci-lint', post({ content, projectId, remote })),

  // CI/CD Variables
  getVariables: (scope: 'project' | 'group' | 'instance', id?: number) => {
    const params = new URLSearchParams();
    params.set('scope', scope);
    if (id) params.set('id', String(id));
    return request<{ success: boolean; variables: GitLabVariable[] }>(`/variables?${params.toString()}`);
  },

  getVariableValue: (scope: 'project' | 'group' | 'instance', id: number, key: string, environmentScope = '*') => {
    const params = new URLSearchParams({ scope, id: String(id), key, environment_scope: environmentScope });
    return request<{ success: boolean; value: string }>(`/variables/value?${params.toString()}`);
  },

  saveVariable: (payload: GitLabVariable) =>
    request<{ success: boolean; variable: GitLabVariable }>('/variables', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),

  deleteVariable: (scope: 'project' | 'group', scope_id: number, key: string) => {
    const params = new URLSearchParams({ scope, scope_id: String(scope_id), key });
    return request<{ success: boolean }>(`/variables?${params.toString()}`, {
      method: 'DELETE'
    });
  },

  // Badges
  getBadges: (kind: 'project' | 'group', id: number) =>
    request<{ success: boolean; badges: GitLabBadge[] }>(`/badges?kind=${kind}&id=${id}`),

  createBadge: (payload: { name: string; link_url: string; image_url: string; kind: 'project' | 'group'; project_id?: number; group_id?: number }) =>
    request<{ success: boolean; badge: GitLabBadge }>('/badges', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),

  deleteBadge: (kind: 'project' | 'group', id: number, badgeId: number) =>
    request<{ success: boolean }>(`/badges/${badgeId}?kind=${kind}&id=${id}`, {
      method: 'DELETE'
    }),

  setupPipelineBadges: (projectId: number, options: {
    targets: Array<'main' | 'develop' | 'tags'>;
    includePipeline?: boolean;
    includeCoverage?: boolean;
    includeRelease?: boolean;
    style?: 'flat' | 'flat-square' | 'plastic' | 'for-the-badge';
    replaceExisting?: boolean;
  }) =>
    request<{ success: boolean; count: number; badges: GitLabBadge[] }>(`/projects/${projectId}/badges/pipeline-setup`, {
      method: 'POST',
      body: JSON.stringify(options)
    }),

  // Repository Settings & Avatar
  updateProjectSettings: (projectId: number, payload: { description?: string; topics?: string[]; visibility?: string; default_branch?: string }) =>
    request<{ success: boolean; project: GitLabProject }>(`/projects/${projectId}/settings`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),

  updateProjectAvatar: (projectId: number, avatar: string) =>
    request<{ success: boolean; avatar_url: string }>(`/projects/${projectId}/avatar`, {
      method: 'POST',
      body: JSON.stringify({ avatar })
    }),

  // GitLab Pages
  getPagesInfo: (projectId: number) =>
    request<{ success: boolean; pages: GitLabPagesInfo }>(`/projects/${projectId}/pages`),

  updatePagesSettings: (projectId: number, settings: { https_only?: boolean }) =>
    request<{ success: boolean; pages: GitLabPagesInfo }>(`/projects/${projectId}/pages`, {
      method: 'PATCH',
      body: JSON.stringify(settings)
    }),

  subscribeEvents: (onEvent: (event: string, data: any) => void) => {
    try {
      const es = new EventSource('/api/events');
      es.onmessage = (e) => {
        try {
          const parsed = JSON.parse(e.data);
          onEvent('message', parsed);
        } catch {}
      };
      es.addEventListener('metrics_updated', (e: any) => {
        try {
          onEvent('metrics_updated', JSON.parse(e.data));
        } catch {}
      });
      es.addEventListener('notification', (e: any) => {
        try {
          onEvent('notification', JSON.parse(e.data));
        } catch {}
      });
      es.addEventListener('watches_changed', (e: any) => {
        try {
          onEvent('watches_changed', JSON.parse(e.data));
        } catch {}
      });
      es.addEventListener('inbox_updated', (e: any) => {
        try {
          onEvent('inbox_updated', JSON.parse(e.data));
        } catch {}
      });
      es.addEventListener('sync_completed', (e: any) => {
        try {
          onEvent('sync_completed', JSON.parse(e.data));
        } catch {}
      });
      es.addEventListener('work_item_updated', (e: any) => {
        try {
          onEvent('work_item_updated', JSON.parse(e.data));
        } catch {}
      });
      es.addEventListener('pipeline_updated', (e: any) => {
        try {
          onEvent('pipeline_updated', JSON.parse(e.data));
        } catch {}
      });
      es.addEventListener('merge_request_updated', (e: any) => {
        try {
          onEvent('merge_request_updated', JSON.parse(e.data));
        } catch {}
      });
      es.addEventListener('merge_request_merged', (e: any) => {
        try {
          onEvent('merge_request_merged', JSON.parse(e.data));
        } catch {}
      });
      es.addEventListener('runner_registered', (e: any) => {
        try {
          onEvent('runner_registered', JSON.parse(e.data));
        } catch {}
      });
      es.addEventListener('runner_updated', (e: any) => {
        try {
          onEvent('runner_updated', JSON.parse(e.data));
        } catch {}
      });
      es.addEventListener('runner_stopped', (e: any) => {
        try {
          onEvent('runner_stopped', JSON.parse(e.data));
        } catch {}
      });
      es.addEventListener('note_created', (e: any) => {
        try {
          onEvent('note_created', JSON.parse(e.data));
        } catch {}
      });
      return () => es.close();
    } catch {
      return () => {};
    }
  }
};

const put = (body: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(body) });

export const notifyApi = {
  state: () => request<{ success: boolean } & NotifyState>('/notify/state'),
  addWatch: (kind: WatchKind, projectId: number, targetId: number) =>
    request<{ success: boolean; watch: WatchView }>('/notify/watches', post({ kind, projectId, targetId })),
  removeWatch: (id: string) => request<{ success: boolean }>(`/notify/watches/${id}`, { method: 'DELETE' }),
  updateRules: (rules: Partial<NotifyRules>) =>
    request<{ success: boolean; rules: NotifyRules }>('/notify/rules', put(rules)),
  addChannel: (input: NotifyChannelInput) =>
    request<{ success: boolean; channel: NotifyChannelInfo }>('/notify/channels', post(input)),
  updateChannel: (id: string, patch: Partial<NotifyChannelInput>) =>
    request<{ success: boolean; channel: NotifyChannelInfo }>(`/notify/channels/${id}`, put(patch)),
  deleteChannel: (id: string) => request<{ success: boolean }>(`/notify/channels/${id}`, { method: 'DELETE' }),
  testChannel: (id: string) => request<{ success: boolean }>(`/notify/channels/${id}/test`, post()),
  markRead: () => request<{ success: boolean }>('/notify/notifications/read', post()),
  clearNotifications: () => request<{ success: boolean }>('/notify/notifications', { method: 'DELETE' })
};

type NoteResponse = { success: boolean; note: Note };

export const notesApi = {
  list: (filter: NoteFilter = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filter)) if (value) params.set(key, value);
    const qs = params.toString();
    return request<{ success: boolean; namespace: NoteNamespace; tags: string[]; notes: Note[] }>(`/notes${qs ? `?${qs}` : ''}`);
  },
  create: (input: NoteInput) => request<NoteResponse>('/notes', post(input)),
  update: (id: string, patch: NoteInput) =>
    request<NoteResponse>(`/notes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id: string) => request<{ success: boolean }>(`/notes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addComment: (id: string, body: string) => request<NoteResponse>(`/notes/${encodeURIComponent(id)}/comments`, post({ body })),
  updateComment: (id: string, commentId: string, body: string) =>
    request<NoteResponse>(`/notes/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ body })
    }),
  deleteComment: (id: string, commentId: string) =>
    request<NoteResponse>(`/notes/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' }),
  migrate: (id: string, options: NoteMigrateOptions) =>
    request<{ success: boolean; work_item: { project_id: number; iid: number; web_url: string }; note: Note | null; deleted: boolean }>(
      `/notes/${encodeURIComponent(id)}/migrate`,
      post(options)
    ),
  /** Binary response, so it bypasses request(): returns the ZIP and the server's file name. */
  exportZip: async (): Promise<{ blob: Blob; filename: string }> => {
    const res = await fetch('/api/notes/export');
    if (res.status === 401) window.dispatchEvent(new CustomEvent('lazylab:unauthorized'));
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP error ${res.status}`);
    }
    const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
    return { blob: await res.blob(), filename: match?.[1] ?? 'lazylab-notes.zip' };
  }
};
