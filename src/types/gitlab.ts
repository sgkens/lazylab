export type WorkItemType = 'Issue' | 'Task' | 'Incident' | 'Requirement' | 'Objective' | 'Key Result';

export interface GitLabUser {
  id: number;
  username: string;
  name: string;
  avatar_url: string;
  web_url: string;
  is_admin?: boolean;
}

export interface GitLabProject {
  id: number;
  name: string;
  name_with_namespace: string;
  path: string;
  path_with_namespace: string;
  /** Present in list responses (`simple=true`); `kind` is "group" or "user". */
  namespace?: { id: number; name: string; path: string; kind: 'group' | 'user'; full_path: string };
  default_branch: string;
  visibility: 'private' | 'internal' | 'public';
  web_url: string;
  avatar_url: string | null;
  star_count: number;
  open_issues_count: number;
  description?: string;
  topics?: string[];
  tag_list?: string[];
}

export interface SubTask {
  id: number;
  title: string;
  completed: boolean;
  parent_iid: number;
}

export interface GitLabNote {
  id: number;
  body: string;
  author: GitLabUser;
  created_at: string;
  system: boolean;
  attachment?: {
    name: string;
    url: string;
    size?: number;
    type?: string;
  };
}

export interface GitLabMilestone {
  id: number;
  iid: number;
  project_id: number;
  project_name?: string;
  title: string;
  description?: string;
  state: 'active' | 'closed';
  due_date: string | null;
  start_date: string | null;
  web_url: string;
  open_issues_count?: number;
  closed_issues_count?: number;
  completion_percentage?: number;
}

export interface GitLabWorkItem {
  id: number;
  iid: number;
  project_id: number;
  project_name?: string;
  title: string;
  description: string;
  state: 'opened' | 'closed';
  work_item_type: WorkItemType;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  labels: string[];
  milestone: { id: number; title: string } | null;
  assignees: { id: number; name: string; username: string; avatar_url: string }[];
  author: { id: number; name: string; username: string; avatar_url: string };
  user_notes_count: number;
  upvotes: number;
  web_url: string;
  /** Full reference, e.g. `group/project#7`. Live mode only. */
  reference?: string;
  weight?: number;
  subtasks?: SubTask[];
}

export interface GitLabMergeRequest {
  id: number;
  iid: number;
  project_id: number;
  project_name?: string;
  title: string;
  description: string;
  state: 'opened' | 'closed' | 'merged' | 'locked';
  draft: boolean;
  work_in_progress: boolean;
  merge_status: string;
  detailed_merge_status?: string;
  source_branch: string;
  target_branch: string;
  author: { id: number; name: string; username: string; avatar_url: string };
  assignees: { id: number; name: string; username: string; avatar_url: string }[];
  reviewers: { id: number; name: string; username: string; avatar_url: string }[];
  labels: string[];
  pipeline?: {
    id: number;
    status: 'success' | 'running' | 'failed' | 'pending' | 'canceled' | 'skipped' | 'manual';
    web_url: string;
    ref: string;
    sha: string;
  };
  has_conflicts: boolean;
  web_url: string;
  /** Full reference, e.g. `group/project!12`. Live mode only. */
  reference?: string;
  /** Head commit of the source branch. */
  sha?: string;
  created_at: string;
  updated_at: string;
  approved?: boolean;
  approvals_required?: number;
  user_notes_count?: number;
  changes_count?: string;
  diff_stats?: { file: string; additions: number; deletions: number }[];
}

export interface GitLabPipeline {
  id: number;
  project_id: number;
  project_name?: string;
  status: 'success' | 'running' | 'failed' | 'pending' | 'canceled' | 'skipped' | 'manual';
  ref: string;
  sha: string;
  web_url: string;
  created_at: string;
  updated_at: string;
  duration?: number;
  user?: { name: string; username: string; avatar_url: string };
  stages?: string[];
}

export interface GitLabJob {
  id: number;
  name: string;
  stage: string;
  status: 'success' | 'running' | 'failed' | 'pending' | 'canceled' | 'skipped' | 'manual' | 'created';
  duration?: number;
  started_at?: string;
  finished_at?: string;
  pipeline_id: number;
  project_id: number;
  runner?: { id: number; description: string; active: boolean; is_shared: boolean };
  web_url?: string;
}

export interface GitLabRunner {
  id: number;
  description: string;
  ip_address?: string;
  active: boolean;
  paused: boolean;
  is_shared: boolean;
  runner_type: 'instance_type' | 'group_type' | 'project_type';
  status: 'online' | 'offline' | 'paused' | 'not_connected';
  tag_list: string[];
  contacted_at?: string;
  architecture?: string;
  platform?: string;
  version?: string;
  project_ids?: number[];
  run_untagged?: boolean;
  locked?: boolean;
}

export interface GitLabLabel {
  id: number;
  name: string;
  color: string;
  description?: string;
  text_color?: string;
  open_issues_count?: number;
  closed_issues_count?: number;
  open_merge_requests_count?: number;
}

export interface WalStats {
  totalEntries: number;
  walEntriesCount: number;
  walSizeBytes: number;
  lastCheckpoint: number;
  recentLogs: {
    id: number;
    operation: string;
    key: string;
    category: string;
    timestamp: number;
    details?: string;
  }[];
}

export interface ApiMetricBucket {
  timestamp: number;
  label: string;
  apiHits: number;
  cacheHits: number;
  rateLimitRemaining: number;
  usagePercent: number;
}

export interface GitLabRateLimitInfo {
  limit: number;
  remaining: number;
  observed: number;
  resetAt: number;
  resetSeconds: number;
  lastUpdated: number;
}

export interface MetricsSummary {
  totalApiHits: number;
  totalCacheHits: number;
  cacheHitRatio: number;
  rateLimit: GitLabRateLimitInfo;
  buckets: ApiMetricBucket[];
  recentCalls: {
    id: string;
    endpoint: string;
    type: 'cache_hit' | 'api_call';
    status: number;
    durationMs: number;
    timestamp: number;
  }[];
}

export interface AppStatus {
  host: string;
  hasToken: boolean;
  profileName?: string | null;
  isDemo: boolean;
  user: GitLabUser | null;
  autoFetchIntervalSec: number;
  lastSyncTime: number;
  walStats: WalStats;
  metrics?: MetricsSummary;
}

// 1. Packages & Registry
export type PackageType = 'npm' | 'maven' | 'pypi' | 'composer' | 'nuget' | 'helm' | 'terraform_module' | 'generic' | 'container';

export interface GitLabPackageFile {
  id: number;
  package_id: number;
  file_name: string;
  size: number;
  file_md5?: string;
  file_sha256?: string;
  created_at: string;
  download_path?: string;
}

export interface GitLabPackage {
  id: number;
  name: string;
  version: string;
  package_type: PackageType;
  status: 'default' | 'hidden' | 'processing' | 'error';
  created_at: string;
  project_id: number;
  project_name?: string;
  tags?: string[];
  pipeline_id?: number;
  package_files?: GitLabPackageFile[];
  install_command?: string;
  web_path?: string;
}

// 2. Tags & Releases
export interface GitLabTag {
  name: string;
  message?: string;
  target: string; // commit sha
  commit: {
    id: string;
    short_id: string;
    title: string;
    created_at: string;
    author_name: string;
  };
  release?: {
    tag_name: string;
    description: string;
  };
  protected?: boolean;
}

export interface GitLabReleaseAsset {
  count: number;
  sources: { format: string; url: string }[];
  links: { id: number; name: string; url: string; link_type?: string }[];
}

export interface GitLabRelease {
  name: string;
  tag_name: string;
  description: string;
  created_at: string;
  released_at: string;
  author?: GitLabUser;
  commit_path?: string;
  upcoming_release?: boolean;
  assets?: GitLabReleaseAsset;
  _links?: {
    self: string;
    opened_issues_url?: string;
    closed_issues_url?: string;
    merged_merge_requests_url?: string;
  };
}

// 3. Job Trace & Runner Jobs
export interface JobTrace {
  job_id: number;
  project_id: number;
  job_name: string;
  stage: string;
  status: string;
  duration?: number;
  trace: string;
  failure_reason?: string;
  web_url?: string;
  runner?: {
    id: number;
    description: string;
    ip_address?: string;
  };
  artifacts?: { filename: string; size: number }[];
}

export interface ExcerptLine {
  n: number;
  text: string;
  hl: boolean;
}

export interface FailureExcerpt {
  section: string | null;
  sectionHeader: string | null;
  lines: ExcerptLine[];
  errorLine: string | null;
  exitCode: number | null;
  failureReason: string | null;
  failureHint: string | null;
  retryable: boolean;
  totalLines: number;
}

export interface JobFailure {
  job_id: number;
  project_id: number;
  pipeline_id?: number;
  job_name: string;
  stage: string;
  status: string;
  web_url?: string;
  excerpt: FailureExcerpt;
}

export interface GitLabBranch {
  name: string;
  default: boolean;
  protected: boolean;
  commit_sha?: string;
  committed_date?: string;
}

export interface DeclaredVariable {
  key: string;
  value: string;
  description?: string;
  options?: string[];
}

export interface PipelineVariableInput {
  key: string;
  value: string;
  variable_type?: 'env_var' | 'file';
}

export interface RunnerJob {
  id: number;
  name: string;
  stage: string;
  status: 'running' | 'success' | 'failed' | 'canceled';
  project_id: number;
  project_name?: string;
  created_at: string;
  duration?: number;
}

// 4. CI/CD Pipeline Editor & Visualizer
export interface CiConfig {
  projectId: number;
  content: string;
  branch: string;
  updated_at?: string;
  last_commit_id?: string;
  missing?: boolean;
}

export interface CiLintResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stages: string[];
  jobs: {
    name: string;
    stage: string;
    needs?: string[];
    script?: string[];
    tags?: string[];
    when?: string;
    allow_failure?: boolean;
  }[];
  source?: 'gitlab' | 'local';
}

// 5. CI/CD Variables
export interface GitLabVariable {
  key: string;
  value: string;
  variable_type: 'env_var' | 'file';
  protected: boolean;
  masked: boolean;
  raw?: boolean;
  environment_scope: string;
  scope_type: 'project' | 'group' | 'instance';
  scope_id: number;
  scope_name?: string;
  /** Masked values are left out of list responses; fetch one with api.getVariableValue. */
  value_hidden?: boolean;
}

// 6. Badges
export interface GitLabBadge {
  id: number;
  name: string;
  link_url: string;
  image_url: string;
  rendered_link_url?: string;
  rendered_image_url?: string;
  kind: 'project' | 'group';
  project_id?: number;
  group_id?: number;
}

export interface PipelineBadgeSetupOptions {
  targets: Array<'main' | 'develop' | 'tags'>;
  includePipeline: boolean;
  includeCoverage: boolean;
  includeRelease: boolean;
  style?: 'flat' | 'flat-square' | 'plastic' | 'for-the-badge';
  replaceExisting?: boolean;
}

// 7. GitLab Pages
export interface GitLabPagesDomain {
  domain: string;
  auto_ssl_enabled: boolean;
  certificate_expiration?: string;
  verified: boolean;
}

export interface GitLabPagesInfo {
  is_enabled: boolean;
  url: string;
  status: 'deployed' | 'running' | 'failed' | 'not_configured';
  deployed_at?: string;
  size_bytes?: number;
  https_only: boolean;
  access_control: boolean;
  domains: GitLabPagesDomain[];
  deploy_job_id?: number;
  pipeline_id?: number;
}

