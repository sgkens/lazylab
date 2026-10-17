import { cacheDb } from './cacheDb.js';
import { metricsManager } from './metricsManager.js';
import { parseGitLabCiYaml } from './yamlParser.js';
import { mapLimit } from './concurrency.js';
import { extractFailure, FailureExcerpt } from './triage.js';
import { buildReleaseNotes, CommitLike, ReleaseNotes } from './releaseNotes.js';

// GitLab has no instance-wide list endpoint for milestones, pipelines, labels or packages,
// so "all projects" views fan out over the most recently active member projects.
const AGGREGATE_PROJECT_LIMIT = 15;
const AGGREGATE_CONCURRENCY = 4;
const MAX_TRACE_CHARS = 2_000_000;
const MAX_PIPELINE_FAILURES = 5;

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
  work_item_type: 'Issue' | 'Task' | 'Incident' | 'Requirement' | 'Objective' | 'Key Result';
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
  allow_failure?: boolean;
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

export interface GitLabTag {
  name: string;
  message?: string;
  target: string;
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
}

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

export interface PipelineVariableInput {
  key: string;
  value: string;
  variable_type?: 'env_var' | 'file';
}

/** A variable declared in .gitlab-ci.yml, used to prefill the run-pipeline form. */
export interface DeclaredVariable {
  key: string;
  value: string;
  description?: string;
  options?: string[];
}

export interface GitLabBranch {
  name: string;
  default: boolean;
  protected: boolean;
  commit_sha?: string;
  committed_date?: string;
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

export interface CiConfig {
  projectId: number;
  content: string;
  branch: string;
  updated_at?: string;
  last_commit_id?: string;
  /** The ref has no .gitlab-ci.yml yet. */
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
  /** Who decided validity: GitLab's linter or the local parser. */
  source?: 'gitlab' | 'local';
}

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
}

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

// In-memory demo data
const DEMO_USER: GitLabUser = {
  id: 101,
  username: 'alex.dev',
  name: 'Alex Vance',
  avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=128&q=80',
  web_url: 'https://gitlab.com/alex.dev'
};

const DEMO_PROJECTS: GitLabProject[] = [
  {
    id: 901,
    name: 'gitlab-orchestrator',
    name_with_namespace: 'Platform Engineering / gitlab-orchestrator',
    path: 'gitlab-orchestrator',
    path_with_namespace: 'platform/gitlab-orchestrator',
    namespace: { id: 101, name: 'Platform Engineering', path: 'platform', kind: 'group', full_path: 'platform' },
    default_branch: 'main',
    visibility: 'private',
    web_url: 'https://gitlab.com/platform/gitlab-orchestrator',
    avatar_url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=128&q=80',
    star_count: 14,
    open_issues_count: 8,
    description: 'Centralized orchestrator for GitLab work items, runners fleet lifecycle, and SQLite WAL cache acceleration.',
    topics: ['ci-cd', 'orchestration', 'runners', 'wal-cache', 'typescript'],
    tag_list: ['production', 'critical']
  },
  {
    id: 902,
    name: 'k8s-operator',
    name_with_namespace: 'Infrastructure / k8s-operator',
    path: 'k8s-operator',
    path_with_namespace: 'infra/k8s-operator',
    namespace: { id: 102, name: 'Infrastructure', path: 'infra', kind: 'group', full_path: 'infra' },
    default_branch: 'master',
    visibility: 'internal',
    web_url: 'https://gitlab.com/infra/k8s-operator',
    avatar_url: 'https://images.unsplash.com/photo-1629654297299-c8506221ca97?w=128&q=80',
    star_count: 32,
    open_issues_count: 5,
    description: 'Custom Kubernetes CRD operator managing spot preemption and runner daemon pods.',
    topics: ['kubernetes', 'golang', 'crd', 'runners'],
    tag_list: ['infrastructure', 'operator']
  },
  {
    id: 903,
    name: 'api-gateway',
    name_with_namespace: 'Core Services / api-gateway',
    path: 'api-gateway',
    path_with_namespace: 'services/api-gateway',
    namespace: { id: 103, name: 'Core Services', path: 'services', kind: 'group', full_path: 'services' },
    default_branch: 'main',
    visibility: 'private',
    web_url: 'https://gitlab.com/services/api-gateway',
    avatar_url: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=128&q=80',
    star_count: 27,
    open_issues_count: 4,
    description: 'High-throughput Envoy ingress proxy and authentication gateway for microservices.',
    topics: ['gateway', 'envoy', 'rate-limit', 'oauth'],
    tag_list: ['backend', 'security']
  }
];

let DEMO_MILESTONES: GitLabMilestone[] = [
  {
    id: 10,
    iid: 1,
    project_id: 901,
    project_name: 'gitlab-orchestrator',
    title: 'Sprint 28 - Hardening',
    description: 'Stabilize runner autoscaling, finalize WAL SQLite caching, and resolve edge latency.',
    state: 'active',
    due_date: '2026-11-01',
    start_date: '2026-10-15',
    web_url: 'https://gitlab.com/platform/gitlab-orchestrator/-/milestones/1',
    open_issues_count: 6,
    closed_issues_count: 14,
    completion_percentage: 70
  },
  {
    id: 11,
    iid: 2,
    project_id: 902,
    project_name: 'k8s-operator',
    title: 'Release v2.4 - Zero Downtime',
    description: 'Dynamic webhook validation, dual-stack IPv6, and failover health checks.',
    state: 'active',
    due_date: '2026-11-15',
    start_date: '2026-10-01',
    web_url: 'https://gitlab.com/infra/k8s-operator/-/milestones/2',
    open_issues_count: 3,
    closed_issues_count: 9,
    completion_percentage: 75
  },
  {
    id: 12,
    iid: 3,
    project_id: 903,
    project_name: 'api-gateway',
    title: 'Q4 Performance',
    description: 'Sub-5ms proxy routing SLA, connection pool sharding, and memory compaction.',
    state: 'active',
    due_date: '2026-12-31',
    start_date: '2026-10-01',
    web_url: 'https://gitlab.com/services/api-gateway/-/milestones/3',
    open_issues_count: 4,
    closed_issues_count: 8,
    completion_percentage: 66
  }
];

let DEMO_WORK_ITEMS: GitLabWorkItem[] = [
  {
    id: 5001,
    iid: 42,
    project_id: 901,
    project_name: 'gitlab-orchestrator',
    title: 'Migrate CI runner fleet to auto-scaled ephemeral executors',
    description: `### Objective
Transition our fixed EC2 runner fleet to spot-based ephemeral Pod executors using the Kubernetes GitLab Runner operator.

#### Acceptance Criteria
- [x] Configure Helm chart values with \`concurrent: 30\`
- [x] Integrate IAM OIDC role for AWS EKS
- [ ] Implement grace period for preemption termination signals
- [ ] Validate 99.9% queue SLA under 50 simultaneous pipelines

\`\`\`yaml
runners:
  config: |
    [[runners]]
      [runners.kubernetes]
        namespace = "gitlab-runners"
        image = "ubuntu:24.04"
        cpu_limit = "4"
        memory_limit = "8Gi"
\`\`\`
`,
    state: 'opened',
    work_item_type: 'Issue',
    created_at: new Date(Date.now() - 3600000 * 24 * 3).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 4).toISOString(),
    closed_at: null,
    labels: ['ci/cd', 'infrastructure', 'p1-high'],
    milestone: { id: 10, title: 'Sprint 28 - Hardening' },
    assignees: [DEMO_USER],
    author: DEMO_USER,
    user_notes_count: 2,
    upvotes: 4,
    web_url: 'https://gitlab.com/platform/gitlab-orchestrator/-/issues/42',
    weight: 5,
    subtasks: [
      { id: 1, title: 'Configure Helm chart values for spot preemption', completed: true, parent_iid: 42 },
      { id: 2, title: 'Deploy test runner pool to staging cluster', completed: true, parent_iid: 42 },
      { id: 3, title: 'Benchmark parallel build queue response latency', completed: false, parent_iid: 42 },
      { id: 4, title: 'Set up Prometheus alerts for pod eviction timeout', completed: false, parent_iid: 42 }
    ]
  },
  {
    id: 5002,
    iid: 43,
    project_id: 901,
    project_name: 'gitlab-orchestrator',
    title: 'Configure Work Items GraphQL subscription for real-time task sync',
    description: `Implement WebSocket client listener on ActionCable to capture instant state transitions when work item type changes from Task to Issue.

* Supports real-time broadcast
* Low latency delta update`,
    state: 'opened',
    work_item_type: 'Task',
    created_at: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 6).toISOString(),
    closed_at: null,
    labels: ['frontend', 'performance'],
    milestone: { id: 10, title: 'Sprint 28 - Hardening' },
    assignees: [DEMO_USER],
    author: DEMO_USER,
    user_notes_count: 1,
    upvotes: 2,
    web_url: 'https://gitlab.com/platform/gitlab-orchestrator/-/issues/43',
    weight: 3,
    subtasks: [
      { id: 5, title: 'Establish SSE fallback for non-cable endpoints', completed: true, parent_iid: 43 },
      { id: 6, title: 'Bind work_item_updated reducer in store', completed: true, parent_iid: 43 }
    ]
  },
  {
    id: 5003,
    iid: 19,
    project_id: 902,
    project_name: 'k8s-operator',
    title: 'CRD admission webhook timeout during ingress controller rollout',
    description: `Investigating high latency in webhook validation under high concurrency. Added tracing middleware to isolate TLS handshake lag.`,
    state: 'opened',
    work_item_type: 'Incident',
    created_at: new Date(Date.now() - 3600000 * 12).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 1).toISOString(),
    closed_at: null,
    labels: ['incident/active', 'kubernetes', 'p0-urgent'],
    milestone: { id: 11, title: 'Release v2.4 - Zero Downtime' },
    assignees: [DEMO_USER],
    author: DEMO_USER,
    user_notes_count: 3,
    upvotes: 7,
    web_url: 'https://gitlab.com/infra/k8s-operator/-/issues/19',
    weight: 8,
    subtasks: [
      { id: 7, title: 'Profile webhook admission controller latency', completed: true, parent_iid: 19 },
      { id: 8, title: 'Increase failurePolicy threshold temporarily', completed: false, parent_iid: 19 }
    ]
  },
  {
    id: 5004,
    iid: 12,
    project_id: 903,
    project_name: 'api-gateway',
    title: 'Achieve sub-5ms p99 proxy latency for internal service mesh',
    description: `Objective to streamline Envoy configuration and optimize connection pooling buffers across all ingress nodes.`,
    state: 'opened',
    work_item_type: 'Objective',
    created_at: new Date(Date.now() - 3600000 * 24 * 7).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 18).toISOString(),
    closed_at: null,
    labels: ['performance', 'okr-q4'],
    milestone: { id: 12, title: 'Q4 Performance' },
    assignees: [DEMO_USER],
    author: DEMO_USER,
    user_notes_count: 0,
    upvotes: 6,
    web_url: 'https://gitlab.com/services/api-gateway/-/issues/12',
    weight: 4,
    subtasks: []
  },
  {
    id: 5005,
    iid: 38,
    project_id: 901,
    project_name: 'gitlab-orchestrator',
    title: 'Resolve JWT token expiry race on concurrent GitLab API calls',
    description: `Cached refresh token invalidated prematurely during heavy parallel fetch workers.`,
    state: 'closed',
    work_item_type: 'Issue',
    created_at: new Date(Date.now() - 3600000 * 24 * 10).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
    closed_at: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
    labels: ['auth', 'bug'],
    milestone: { id: 10, title: 'Sprint 28 - Hardening' },
    assignees: [DEMO_USER],
    author: DEMO_USER,
    user_notes_count: 2,
    upvotes: 3,
    web_url: 'https://gitlab.com/platform/gitlab-orchestrator/-/issues/38',
    weight: 2,
    subtasks: []
  }
];

let DEMO_NOTES: Record<string, GitLabNote[]> = {
  'work_item:901:42': [
    {
      id: 9001,
      body: 'Verified EKS Karpenter provider module. Autoscaling latency dropped from 90s to 18s for container startup.',
      author: { id: 102, username: 'sara.lead', name: 'Sara Chen', avatar_url: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=128&q=80', web_url: '' },
      created_at: new Date(Date.now() - 3600000 * 20).toISOString(),
      system: false
    },
    {
      id: 9002,
      body: 'Attached performance profiling trace from staging benchmark run.',
      author: DEMO_USER,
      created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
      system: false,
      attachment: {
        name: 'karpenter-latency-trace.png',
        url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&q=80',
        size: 142000,
        type: 'image/png'
      }
    }
  ],
  'work_item:902:19': [
    {
      id: 9003,
      body: 'Alert triggered by Prometheus: admission-webhook latency exceeded 800ms threshold during cluster rollouts.',
      author: DEMO_USER,
      created_at: new Date(Date.now() - 3600000 * 11).toISOString(),
      system: false
    }
  ],
  'mr:901:77': [
    {
      id: 9004,
      body: 'Code review completed. Architecture looks clean with WAL append log. Approved for merge into main.',
      author: { id: 102, username: 'sara.lead', name: 'Sara Chen', avatar_url: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=128&q=80', web_url: '' },
      created_at: new Date(Date.now() - 3600000 * 8).toISOString(),
      system: false
    }
  ]
};

let DEMO_MRS: GitLabMergeRequest[] = [
  {
    id: 8001,
    iid: 77,
    project_id: 901,
    project_name: 'gitlab-orchestrator',
    title: 'feat: add WAL SQLite backend caching with auto-revalidation',
    description: `Introduces a high throughput Write-Ahead-Log sqlite cache for fast project, issue and pipeline reads.

- Sub-millisecond queries
- Disk WAL append log
- Auto-sync interval worker`,
    state: 'opened',
    draft: false,
    work_in_progress: false,
    merge_status: 'can_be_merged',
    detailed_merge_status: 'mergeable',
    source_branch: 'feat/wal-cache-engine',
    target_branch: 'main',
    author: DEMO_USER,
    assignees: [DEMO_USER],
    reviewers: [
      { id: 102, username: 'sara.lead', name: 'Sara Chen', avatar_url: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=128&q=80' }
    ],
    labels: ['feature', 'reviewed', 'ci/cd'],
    pipeline: {
      id: 30101,
      status: 'success',
      web_url: 'https://gitlab.com/platform/gitlab-orchestrator/-/pipelines/30101',
      ref: 'feat/wal-cache-engine',
      sha: '7a9c8f1e'
    },
    has_conflicts: false,
    web_url: 'https://gitlab.com/platform/gitlab-orchestrator/-/merge_requests/77',
    created_at: new Date(Date.now() - 3600000 * 16).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 1).toISOString(),
    approved: true,
    approvals_required: 1,
    user_notes_count: 1,
    changes_count: '6',
    diff_stats: [
      { file: 'server/cacheDb.ts', additions: 184, deletions: 12 },
      { file: 'server/apiRouter.ts', additions: 92, deletions: 8 },
      { file: 'src/services/api.ts', additions: 45, deletions: 4 }
    ]
  },
  {
    id: 8002,
    iid: 78,
    project_id: 901,
    project_name: 'gitlab-orchestrator',
    title: 'Draft: refactor pipeline DAG visualizer with stage parallel nodes',
    description: 'Work in progress: rendering graph nodes with live status indicators and interactive job triggers.',
    state: 'opened',
    draft: true,
    work_in_progress: true,
    merge_status: 'can_be_merged',
    detailed_merge_status: 'draft_status',
    source_branch: 'refactor/pipeline-visualizer',
    target_branch: 'main',
    author: DEMO_USER,
    assignees: [DEMO_USER],
    reviewers: [],
    labels: ['wip', 'frontend'],
    pipeline: {
      id: 30102,
      status: 'running',
      web_url: 'https://gitlab.com/platform/gitlab-orchestrator/-/pipelines/30102',
      ref: 'refactor/pipeline-visualizer',
      sha: '8f4b2a3d'
    },
    has_conflicts: false,
    web_url: 'https://gitlab.com/platform/gitlab-orchestrator/-/merge_requests/78',
    created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    approved: false,
    approvals_required: 1,
    user_notes_count: 0,
    changes_count: '3',
    diff_stats: [
      { file: 'src/components/PipelinesView.tsx', additions: 88, deletions: 14 }
    ]
  },
  {
    id: 8003,
    iid: 31,
    project_id: 902,
    project_name: 'k8s-operator',
    title: 'fix(webhook): resolve dead-lock during simultaneous pod eviction',
    description: 'Ensures mutation lock uses atomic compare-and-swap instead of mutex semaphore.',
    state: 'opened',
    draft: false,
    work_in_progress: false,
    merge_status: 'can_be_merged',
    detailed_merge_status: 'mergeable',
    source_branch: 'fix/eviction-deadlock',
    target_branch: 'master',
    author: DEMO_USER,
    assignees: [DEMO_USER],
    reviewers: [],
    labels: ['bugfix', 'critical'],
    pipeline: {
      id: 30103,
      status: 'failed',
      web_url: 'https://gitlab.com/infra/k8s-operator/-/pipelines/30103',
      ref: 'fix/eviction-deadlock',
      sha: '99e2a14c'
    },
    has_conflicts: false,
    web_url: 'https://gitlab.com/infra/k8s-operator/-/merge_requests/31',
    created_at: new Date(Date.now() - 3600000 * 20).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 5).toISOString(),
    approved: false,
    approvals_required: 1,
    user_notes_count: 0,
    changes_count: '2',
    diff_stats: [
      { file: 'controllers/admission.go', additions: 34, deletions: 9 }
    ]
  }
];

let DEMO_PIPELINES: GitLabPipeline[] = [
  {
    id: 30101,
    project_id: 901,
    project_name: 'gitlab-orchestrator',
    status: 'success',
    ref: 'feat/wal-cache-engine',
    sha: '7a9c8f1e29b48c02',
    web_url: 'https://gitlab.com/platform/gitlab-orchestrator/-/pipelines/30101',
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 1.8).toISOString(),
    duration: 342,
    user: { name: 'Alex Vance', username: 'alex.dev', avatar_url: DEMO_USER.avatar_url },
    stages: ['prepare', 'build', 'test', 'security', 'deploy']
  },
  {
    id: 30102,
    project_id: 901,
    project_name: 'gitlab-orchestrator',
    status: 'running',
    ref: 'refactor/pipeline-visualizer',
    sha: '8f4b2a3d90e1f822',
    web_url: 'https://gitlab.com/platform/gitlab-orchestrator/-/pipelines/30102',
    created_at: new Date(Date.now() - 3600000 * 0.4).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 0.1).toISOString(),
    duration: 185,
    user: { name: 'Alex Vance', username: 'alex.dev', avatar_url: DEMO_USER.avatar_url },
    stages: ['prepare', 'build', 'test', 'deploy']
  },
  {
    id: 30103,
    project_id: 902,
    project_name: 'k8s-operator',
    status: 'failed',
    ref: 'fix/eviction-deadlock',
    sha: '99e2a14c11b0e5aa',
    web_url: 'https://gitlab.com/infra/k8s-operator/-/pipelines/30103',
    created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 4.9).toISOString(),
    duration: 128,
    user: { name: 'Alex Vance', username: 'alex.dev', avatar_url: DEMO_USER.avatar_url },
    stages: ['lint', 'unit-test', 'e2e-cluster']
  },
  {
    id: 30104,
    project_id: 903,
    project_name: 'api-gateway',
    status: 'success',
    ref: 'main',
    sha: '55d8a94b301cfa99',
    web_url: 'https://gitlab.com/services/api-gateway/-/pipelines/30104',
    created_at: new Date(Date.now() - 3600000 * 18).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 17.8).toISOString(),
    duration: 410,
    user: { name: 'Sara Chen', username: 'sara.lead', avatar_url: '' },
    stages: ['build', 'test', 'deploy']
  }
];

let DEMO_JOBS: Record<number, GitLabJob[]> = {
  30101: [
    { id: 7001, name: 'lint:eslint', stage: 'prepare', status: 'success', duration: 32, pipeline_id: 30101, project_id: 901 },
    { id: 7002, name: 'deps:audit', stage: 'prepare', status: 'success', duration: 18, pipeline_id: 30101, project_id: 901 },
    { id: 7003, name: 'compile:bundle', stage: 'build', status: 'success', duration: 65, pipeline_id: 30101, project_id: 901 },
    { id: 7004, name: 'docker:image', stage: 'build', status: 'success', duration: 110, pipeline_id: 30101, project_id: 901 },
    { id: 7005, name: 'test:unit', stage: 'test', status: 'success', duration: 44, pipeline_id: 30101, project_id: 901 },
    { id: 7006, name: 'test:integration', stage: 'test', status: 'success', duration: 75, pipeline_id: 30101, project_id: 901 },
    { id: 7007, name: 'sast:semgrep', stage: 'security', status: 'success', duration: 39, pipeline_id: 30101, project_id: 901 },
    { id: 7008, name: 'deploy:staging', stage: 'deploy', status: 'success', duration: 52, pipeline_id: 30101, project_id: 901 },
    { id: 7009, name: 'deploy:prod-manual', stage: 'deploy', status: 'manual', pipeline_id: 30101, project_id: 901 }
  ],
  30102: [
    { id: 7010, name: 'lint:eslint', stage: 'prepare', status: 'success', duration: 28, pipeline_id: 30102, project_id: 901 },
    { id: 7011, name: 'compile:bundle', stage: 'build', status: 'success', duration: 60, pipeline_id: 30102, project_id: 901 },
    { id: 7012, name: 'test:unit', stage: 'test', status: 'running', duration: 45, pipeline_id: 30102, project_id: 901 },
    { id: 7013, name: 'deploy:preview', stage: 'deploy', status: 'pending', pipeline_id: 30102, project_id: 901 }
  ],
  30103: [
    { id: 7020, name: 'lint:golangci', stage: 'lint', status: 'success', duration: 40, pipeline_id: 30103, project_id: 902 },
    { id: 7021, name: 'unit:concurrency', stage: 'unit-test', status: 'failed', duration: 62, pipeline_id: 30103, project_id: 902 },
    { id: 7022, name: 'e2e:minikube', stage: 'e2e-cluster', status: 'skipped', pipeline_id: 30103, project_id: 902 }
  ]
};

let DEMO_RUNNERS: GitLabRunner[] = [
  {
    id: 1001,
    description: 'runner-spot-k8s-pool-01',
    ip_address: '10.240.12.8',
    active: true,
    paused: false,
    is_shared: true,
    runner_type: 'instance_type',
    status: 'online',
    tag_list: ['docker', 'linux', 'amd64', 'k8s'],
    contacted_at: new Date(Date.now() - 15000).toISOString(),
    architecture: 'x86_64',
    platform: 'linux',
    version: '17.4.0',
    project_ids: [901, 902, 903],
    run_untagged: true,
    locked: false
  },
  {
    id: 1002,
    description: 'runner-dedicated-gpu-cuda',
    ip_address: '10.240.15.22',
    active: true,
    paused: false,
    is_shared: false,
    runner_type: 'group_type',
    status: 'online',
    tag_list: ['gpu', 'cuda12', 'high-mem'],
    contacted_at: new Date(Date.now() - 45000).toISOString(),
    architecture: 'x86_64',
    platform: 'linux',
    version: '17.3.2',
    project_ids: [901],
    run_untagged: false,
    locked: true
  },
  {
    id: 1003,
    description: 'runner-arm64-graviton3-builder',
    ip_address: '10.240.18.99',
    active: false,
    paused: true,
    is_shared: false,
    runner_type: 'project_type',
    status: 'paused',
    tag_list: ['arm64', 'aarch64', 'graviton3'],
    contacted_at: new Date(Date.now() - 3600000 * 3).toISOString(),
    architecture: 'arm64',
    platform: 'linux',
    version: '17.4.1',
    project_ids: [901, 902],
    run_untagged: false,
    locked: false
  }
];

let DEMO_LABELS: GitLabLabel[] = [
  { id: 201, name: 'ci/cd', color: '#10B981', description: 'Continuous integration and pipeline triggers', open_issues_count: 4, open_merge_requests_count: 2 },
  { id: 202, name: 'infrastructure', color: '#6366F1', description: 'Cloud infrastructure and Kubernetes operations', open_issues_count: 3, open_merge_requests_count: 1 },
  { id: 203, name: 'p0-urgent', color: '#EF4444', description: 'Highest severity blocker requiring immediate triage', open_issues_count: 1, open_merge_requests_count: 0 },
  { id: 204, name: 'p1-high', color: '#F59E0B', description: 'High priority scheduled for current cycle', open_issues_count: 5, open_merge_requests_count: 3 },
  { id: 205, name: 'performance', color: '#06B6D4', description: 'Latency, throughput, and memory optimization', open_issues_count: 2, open_merge_requests_count: 1 },
  { id: 206, name: 'frontend', color: '#EC4899', description: 'Web UI, styling, and design system components', open_issues_count: 4, open_merge_requests_count: 2 },
  { id: 207, name: 'bugfix', color: '#DC2626', description: 'Defect fixes and test regressions', open_issues_count: 3, open_merge_requests_count: 2 }
];

let DEMO_PACKAGES: GitLabPackage[] = [
  {
    id: 601,
    name: '@labwi/cache-engine',
    version: '2.4.1',
    package_type: 'npm',
    status: 'default',
    created_at: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
    project_id: 901,
    project_name: 'gitlab-orchestrator',
    tags: ['latest', 'stable'],
    pipeline_id: 30101,
    install_command: 'npm install @labwi/cache-engine@2.4.1',
    web_path: '/platform/gitlab-orchestrator/-/packages/601',
    package_files: [
      {
        id: 1101,
        package_id: 601,
        file_name: 'cache-engine-2.4.1.tgz',
        size: 1428590,
        file_sha256: '9f83a042ba3b6107df6c21a436e2f183204780d603a9f02931d8e1782e448b1d',
        file_md5: '7d6928e19e0839a9c0f924b17e42d991',
        created_at: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
        download_path: '/api/v4/projects/901/packages/generic/cache-engine/2.4.1/cache-engine-2.4.1.tgz'
      }
    ]
  },
  {
    id: 602,
    name: 'com.platform:auth-orchestrator',
    version: '1.10.0',
    package_type: 'maven',
    status: 'default',
    created_at: new Date(Date.now() - 3600000 * 24 * 6).toISOString(),
    project_id: 901,
    project_name: 'gitlab-orchestrator',
    tags: ['release'],
    pipeline_id: 30101,
    install_command: '<dependency>\n  <groupId>com.platform</groupId>\n  <artifactId>auth-orchestrator</artifactId>\n  <version>1.10.0</version>\n</dependency>',
    web_path: '/platform/gitlab-orchestrator/-/packages/602',
    package_files: [
      {
        id: 1102,
        package_id: 602,
        file_name: 'auth-orchestrator-1.10.0.jar',
        size: 19124000,
        file_sha256: '44a7b02919c08d17a4128f9c19b02441920ae1908ef90214a4b08f87b89e902a',
        created_at: new Date(Date.now() - 3600000 * 24 * 6).toISOString(),
        download_path: '/api/v4/projects/901/packages/maven/com/platform/auth-orchestrator/1.10.0/auth-orchestrator-1.10.0.jar'
      },
      {
        id: 1103,
        package_id: 602,
        file_name: 'auth-orchestrator-1.10.0.pom',
        size: 4210,
        file_sha256: '38a901ff02a944bb01c8901239aa80174bb09e128919024abef8919248bb019e',
        created_at: new Date(Date.now() - 3600000 * 24 * 6).toISOString(),
        download_path: '/api/v4/projects/901/packages/maven/com/platform/auth-orchestrator/1.10.0/auth-orchestrator-1.10.0.pom'
      }
    ]
  },
  {
    id: 603,
    name: 'gitlab-wal-analyzer',
    version: '0.8.2',
    package_type: 'pypi',
    status: 'default',
    created_at: new Date(Date.now() - 3600000 * 24 * 10).toISOString(),
    project_id: 902,
    project_name: 'k8s-operator',
    tags: ['py3', 'wheel'],
    install_command: 'pip install gitlab-wal-analyzer==0.8.2',
    web_path: '/infra/k8s-operator/-/packages/603',
    package_files: [
      {
        id: 1104,
        package_id: 603,
        file_name: 'gitlab_wal_analyzer-0.8.2-py3-none-any.whl',
        size: 348120,
        file_sha256: '55bc901a8f9024c180ef924819aa018e47bf099182049182390aef902418e90a',
        created_at: new Date(Date.now() - 3600000 * 24 * 10).toISOString()
      }
    ]
  },
  {
    id: 604,
    name: 'registry.gitlab.com/platform/gitlab-orchestrator/app',
    version: 'v2.4.1',
    package_type: 'container',
    status: 'default',
    created_at: new Date(Date.now() - 3600000 * 18).toISOString(),
    project_id: 901,
    project_name: 'gitlab-orchestrator',
    tags: ['latest', 'v2.4.1', 'amd64'],
    install_command: 'docker pull registry.gitlab.com/platform/gitlab-orchestrator/app:v2.4.1',
    web_path: '/platform/gitlab-orchestrator/container_registry',
    package_files: [
      {
        id: 1105,
        package_id: 604,
        file_name: 'manifest.json',
        size: 89400000,
        file_sha256: '883901afe890124890abcef09182490182409812409182490182490182490182',
        created_at: new Date(Date.now() - 3600000 * 18).toISOString()
      }
    ]
  },
  {
    id: 605,
    name: 'deploy-k8s-artifacts',
    version: '2026.10',
    package_type: 'generic',
    status: 'default',
    created_at: new Date(Date.now() - 3600000 * 24 * 3).toISOString(),
    project_id: 901,
    project_name: 'gitlab-orchestrator',
    tags: ['manifests'],
    install_command: 'curl --header "JOB-TOKEN: $CI_JOB_TOKEN" "https://gitlab.com/api/v4/projects/901/packages/generic/deploy-k8s-artifacts/2026.10/deploy-manifests.tar.gz" -o deploy.tar.gz',
    web_path: '/platform/gitlab-orchestrator/-/packages/605',
    package_files: [
      {
        id: 1106,
        package_id: 605,
        file_name: 'deploy-manifests.tar.gz',
        size: 5410900,
        file_sha256: '1249081249081290841209841209841029841029841209841209841209841029',
        created_at: new Date(Date.now() - 3600000 * 24 * 3).toISOString()
      }
    ]
  }
];

let DEMO_TAGS: GitLabTag[] = [
  {
    name: 'v2.4.0',
    message: 'Release 2.4.0 with SQLite WAL cache & Work Items support',
    target: '7a9c8f1e29b48c02',
    commit: {
      id: '7a9c8f1e29b48c02',
      short_id: '7a9c8f1e',
      title: 'feat: implement SQLite WAL caching for GitLab items',
      created_at: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
      author_name: 'Alex Vance'
    },
    release: {
      tag_name: 'v2.4.0',
      description: 'Production-ready SQLite WAL cache and real-time synchronizer.'
    },
    protected: true
  },
  {
    name: 'v2.3.9',
    message: 'Hotfix token refresh race condition and SSE reconnection backoff',
    target: '8f4b2a3d90e1f822',
    commit: {
      id: '8f4b2a3d90e1f822',
      short_id: '8f4b2a3d',
      title: 'fix: debounce token renewal mutex',
      created_at: new Date(Date.now() - 3600000 * 24 * 5).toISOString(),
      author_name: 'Alex Vance'
    },
    protected: false
  },
  {
    name: 'v2.3.0',
    message: 'Milestones, sub-tasks, and runners fleet management release',
    target: '55d8a94b301cfa99',
    commit: {
      id: '55d8a94b301cfa99',
      short_id: '55d8a94b',
      title: 'feat: runners fleet management and runner registration',
      created_at: new Date(Date.now() - 3600000 * 24 * 12).toISOString(),
      author_name: 'Sara Chen'
    },
    release: {
      tag_name: 'v2.3.0',
      description: 'Fleet runners control and project assignment.'
    },
    protected: true
  }
];

let DEMO_RELEASES: GitLabRelease[] = [
  {
    name: 'Release v2.4.0 - Zero Downtime & WAL Caching',
    tag_name: 'v2.4.0',
    description: `### Highlights in v2.4.0
- **Direct SQLite WAL Caching**: Sub-millisecond reads from cache with background sync daemon.
- **GitLab Work Items Support**: Unified Issue, Task, and Incident workflows with Markdown editor.
- **Runners Fleet Hub**: Direct assign, pause, resume, and runner registration.
- **API Telemetry**: Visualizer for GitLab 2000 req/min quota headroom and cache hit ratios.

### Downloads & Binaries
\`\`\`bash
curl -LO https://gitlab.com/platform/gitlab-orchestrator/-/releases/v2.4.0/downloads/labwi-linux-amd64
chmod +x labwi-linux-amd64
\`\`\`
`,
    created_at: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
    released_at: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
    author: DEMO_USER,
    commit_path: '/platform/gitlab-orchestrator/-/commit/7a9c8f1e29b48c02',
    upcoming_release: false,
    assets: {
      count: 4,
      sources: [
        { format: 'tar.gz', url: 'https://gitlab.com/platform/gitlab-orchestrator/-/archive/v2.4.0/gitlab-orchestrator-v2.4.0.tar.gz' },
        { format: 'zip', url: 'https://gitlab.com/platform/gitlab-orchestrator/-/archive/v2.4.0/gitlab-orchestrator-v2.4.0.zip' }
      ],
      links: [
        { id: 1, name: 'labwi-linux-amd64', url: 'https://gitlab.com/platform/gitlab-orchestrator/bin/v2.4.0/labwi-linux-amd64', link_type: 'package' },
        { id: 2, name: 'labwi-darwin-arm64', url: 'https://gitlab.com/platform/gitlab-orchestrator/bin/v2.4.0/labwi-darwin-arm64', link_type: 'package' }
      ]
    }
  },
  {
    name: 'Release v2.3.0 - Fleet Management',
    tag_name: 'v2.3.0',
    description: `Initial support for GitLab CI/CD runner fleet operations, registration tokens, and auto-assignment.`,
    created_at: new Date(Date.now() - 3600000 * 24 * 12).toISOString(),
    released_at: new Date(Date.now() - 3600000 * 24 * 12).toISOString(),
    author: { id: 102, username: 'sara.lead', name: 'Sara Chen', avatar_url: '', web_url: '' },
    commit_path: '/platform/gitlab-orchestrator/-/commit/55d8a94b301cfa99',
    upcoming_release: false,
    assets: {
      count: 2,
      sources: [
        { format: 'tar.gz', url: 'https://gitlab.com/platform/gitlab-orchestrator/-/archive/v2.3.0/gitlab-orchestrator-v2.3.0.tar.gz' },
        { format: 'zip', url: 'https://gitlab.com/platform/gitlab-orchestrator/-/archive/v2.3.0/gitlab-orchestrator-v2.3.0.zip' }
      ],
      links: []
    }
  }
];

let DEMO_JOB_TRACES: Record<number, JobTrace> = {
  7003: {
    job_id: 7003,
    project_id: 901,
    job_name: 'compile:bundle',
    stage: 'build',
    status: 'success',
    duration: 65,
    runner: { id: 1001, description: 'runner-spot-k8s-pool-01', ip_address: '10.240.12.8' },
    artifacts: [{ filename: 'dist/index.js', size: 1248000 }, { filename: 'dist/index.css', size: 84000 }],
    trace: `\x1b[36mRunning with gitlab-runner 17.4.0 (5b91a70)\x1b[0m
\x1b[36m  on runner-spot-k8s-pool-01 4d7a8b1c, system ID: s_8f1b2c3d\x1b[0m
\x1b[34;1mResolving secrets\x1b[0;m
\x1b[32mPreparing environment\x1b[0m
Running on runner-spot-k8s-pool-01-pod-99x2...
\x1b[32mGetting source from Git repository\x1b[0m
Fetching changes with git depth set to 20...
Initialized empty Git repository in /builds/platform/gitlab-orchestrator/.git/
Created fresh repository.
Checking out 7a9c8f1e as detached HEAD (ref: feat/wal-cache-engine)...
Skipping Git submodules setup
\x1b[32mExecuting "step_script" stage of the job script\x1b[0m
\x1b[34m$ node -v && npm -v\x1b[0m
v22.14.0
10.9.2
\x1b[34m$ npm ci --prefer-offline\x1b[0m
added 342 packages in 8.2s
\x1b[34m$ npm run build\x1b[0m
> gitlab-orchestrator@2.4.0 build
> vite build && esbuild server.ts --bundle --platform=node --outdir=dist

\x1b[32m✓\x1b[0m 184 modules transformed.
dist/index.html                   0.82 kB │ gzip:  0.42 kB
dist/assets/index-D5f2q1.css     41.12 kB │ gzip:  7.84 kB
dist/assets/index-B7x91k.js     388.94 kB │ gzip: 112.45 kB
\x1b[32m✓ built in 712ms\x1b[0m
dist/server.js                   42.10 kB
\x1b[32mJob succeeded: build artifact created in 65s\x1b[0m`
  },
  7012: {
    job_id: 7012,
    project_id: 901,
    job_name: 'test:unit',
    stage: 'test',
    status: 'running',
    duration: 45,
    runner: { id: 1001, description: 'runner-spot-k8s-pool-01', ip_address: '10.240.12.8' },
    trace: `\x1b[36mRunning with gitlab-runner 17.4.0 (5b91a70)\x1b[0m
\x1b[36m  on runner-spot-k8s-pool-01 4d7a8b1c\x1b[0m
\x1b[32mPreparing environment\x1b[0m
Using Docker executor with image node:22-alpine...
Pulling docker image node:22-alpine ...
Using docker image sha256:49c0...
\x1b[32mGetting source from Git repository\x1b[0m
Checking out 8f4b2a3d as ref refactor/pipeline-visualizer...
\x1b[34m$ npm test -- --coverage\x1b[0m
PASS tests/cacheDb.test.ts (2.4s)
  ✓ SQLite WAL initialization creates wal journal
  ✓ write batch logs WAL entries and updates in-memory index
  ✓ checkpoint trims flushed entries from wal log table
PASS tests/gitlabClient.test.ts (3.1s)
  ✓ requests respect rate-limit headers
  ✓ cache fallback activates on 304 Not Modified
  ✓ metrics manager tracks API hits and quota countdown
RUNS tests/visualizerDag.test.ts ...
[Live stdout streaming from runner...]`
  },
  7021: {
    job_id: 7021,
    project_id: 902,
    job_name: 'unit:concurrency',
    stage: 'unit-test',
    status: 'failed',
    failure_reason: 'script_failure',
    web_url: 'https://gitlab.com/infra/k8s-operator/-/jobs/7021',
    duration: 62,
    runner: { id: 1003, description: 'runner-arm64-graviton3-builder', ip_address: '10.240.18.99' },
    trace: `\x1b[36mRunning with gitlab-runner 17.4.1 on runner-arm64-graviton3-builder\x1b[0m
\x1b[32mChecking out 99e2a14c on fix/eviction-deadlock...\x1b[0m
\x1b[34m$ go version\x1b[0m
go version go1.23.2 linux/arm64
\x1b[34m$ go test -race -v -timeout 60s ./controllers/...\x1b[0m
=== RUN   TestPodEvictionAdmissionWebhook
=== RUN   TestPodEvictionAdmissionWebhook/Concurrent100Nodes
    admission_test.go:88: fatal: deadlock detected on controller semaphore mutex
    goroutine 42 [chan receive, 52 seconds]:
    controllers.(*AdmissionController).Reconcile(0x1400018a00, ...)
        controllers/admission.go:142 +0x21c
    runtime/debug.Stack()
        runtime/debug/stack.go:26 +0x64
FAIL    controllers (61.8s)
\x1b[31;1mERROR: Job failed: exit code 1\x1b[0;m`
  }
};

let DEMO_RUNNER_JOBS: Record<number, RunnerJob[]> = {
  1001: [
    {
      id: 7012,
      name: 'test:unit',
      stage: 'test',
      status: 'running',
      project_id: 901,
      project_name: 'gitlab-orchestrator',
      created_at: new Date(Date.now() - 45000).toISOString(),
      duration: 45
    },
    {
      id: 7003,
      name: 'compile:bundle',
      stage: 'build',
      status: 'success',
      project_id: 901,
      project_name: 'gitlab-orchestrator',
      created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
      duration: 65
    },
    {
      id: 7005,
      name: 'test:unit',
      stage: 'test',
      status: 'success',
      project_id: 901,
      project_name: 'gitlab-orchestrator',
      created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
      duration: 44
    }
  ],
  1002: [
    {
      id: 7004,
      name: 'docker:image',
      stage: 'build',
      status: 'success',
      project_id: 901,
      project_name: 'gitlab-orchestrator',
      created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
      duration: 110
    }
  ],
  1003: [
    {
      id: 7021,
      name: 'unit:concurrency',
      stage: 'unit-test',
      status: 'failed',
      project_id: 902,
      project_name: 'k8s-operator',
      created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
      duration: 62
    }
  ]
};

let DEMO_CI_CONFIGS: Record<number, string> = {
  901: `stages:
  - prepare
  - build
  - test
  - security
  - deploy

default:
  image: node:22-alpine
  cache:
    key: \${CI_COMMIT_REF_SLUG}
    paths:
      - node_modules/
      - .npm/

lint:eslint:
  stage: prepare
  script:
    - npm ci --prefer-offline
    - npm run lint
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

compile:bundle:
  stage: build
  needs: ["lint:eslint"]
  script:
    - npm run build
  artifacts:
    paths:
      - dist/
    expire_in: 1 week

docker:image:
  stage: build
  image: docker:27-dind
  services:
    - docker:27-dind
  script:
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA

test:unit:
  stage: test
  needs: ["compile:bundle"]
  script:
    - npm test -- --coverage
  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage/cobertura-coverage.xml

sast:semgrep:
  stage: security
  image: returntocorp/semgrep
  script:
    - semgrep scan --config auto --error
  allow_failure: true

deploy:staging:
  stage: deploy
  environment:
    name: staging
    url: https://staging.orchestrator.platform.io
  script:
    - ./scripts/deploy-k8s.sh staging
  rules:
    - if: $CI_COMMIT_BRANCH == "main"

deploy:prod-manual:
  stage: deploy
  environment:
    name: production
    url: https://orchestrator.platform.io
  script:
    - ./scripts/deploy-k8s.sh production
  when: manual
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
`,
  902: `stages:
  - lint
  - unit-test
  - e2e-cluster

default:
  image: golang:1.23-alpine

lint:golangci:
  stage: lint
  script:
    - golangci-lint run ./...

unit:concurrency:
  stage: unit-test
  needs: ["lint:golangci"]
  script:
    - go test -v -race -timeout 90s ./...

e2e:minikube:
  stage: e2e-cluster
  needs: ["unit:concurrency"]
  script:
    - ./scripts/run-e2e.sh
`,
  903: `stages:
  - build
  - test
  - deploy

build:gateway:
  stage: build
  script:
    - cargo build --release

test:gateway:
  stage: test
  needs: ["build:gateway"]
  script:
    - cargo test --all

deploy:mesh:
  stage: deploy
  script:
    - ./deploy.sh
  when: manual
`
};

let DEMO_VARIABLES: GitLabVariable[] = [
  // Project 901 Variables
  {
    key: 'AWS_DEFAULT_REGION',
    value: 'us-east-1',
    variable_type: 'env_var',
    protected: false,
    masked: false,
    environment_scope: '*',
    scope_type: 'project',
    scope_id: 901,
    scope_name: 'gitlab-orchestrator'
  },
  {
    key: 'KUBE_NAMESPACE',
    value: 'prod-orchestrator',
    variable_type: 'env_var',
    protected: true,
    masked: false,
    environment_scope: 'production',
    scope_type: 'project',
    scope_id: 901,
    scope_name: 'gitlab-orchestrator'
  },
  {
    key: 'DATABASE_URL',
    value: 'postgres://labwi:s3cret_pr0d@db.internal:5432/labwi_prod',
    variable_type: 'env_var',
    protected: true,
    masked: true,
    environment_scope: 'production',
    scope_type: 'project',
    scope_id: 901,
    scope_name: 'gitlab-orchestrator'
  },
  {
    key: 'SENTRY_DSN',
    value: 'https://o123456.ingest.sentry.io/api/9876543',
    variable_type: 'env_var',
    protected: false,
    masked: true,
    environment_scope: '*',
    scope_type: 'project',
    scope_id: 901,
    scope_name: 'gitlab-orchestrator'
  },
  {
    key: 'SSH_DEPLOY_KEY',
    value: '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAABlwAAAAdzc2gtcn\n... [RSA 4096 Deploy Key]',
    variable_type: 'file',
    protected: true,
    masked: false,
    environment_scope: 'production',
    scope_type: 'project',
    scope_id: 901,
    scope_name: 'gitlab-orchestrator'
  },
  // Group 101 Variables (Namespace: platform)
  {
    key: 'NPM_TOKEN',
    value: 'npm_glp_8f9210aa39cb701b',
    variable_type: 'env_var',
    protected: true,
    masked: true,
    environment_scope: '*',
    scope_type: 'group',
    scope_id: 101,
    scope_name: 'platform (Group)'
  },
  {
    key: 'REGISTRY_PASSWORD',
    value: 'glpat-k3y99x02fa09bb',
    variable_type: 'env_var',
    protected: true,
    masked: true,
    environment_scope: '*',
    scope_type: 'group',
    scope_id: 101,
    scope_name: 'platform (Group)'
  },
  {
    key: 'SONAR_HOST_URL',
    value: 'https://sonar.company.internal',
    variable_type: 'env_var',
    protected: false,
    masked: false,
    environment_scope: '*',
    scope_type: 'group',
    scope_id: 101,
    scope_name: 'platform (Group)'
  },
  {
    key: 'GLOBAL_SLACK_WEBHOOK',
    value: 'https://hooks.slack.com/services/T001/B002/987123abcdef',
    variable_type: 'env_var',
    protected: false,
    masked: true,
    environment_scope: '*',
    scope_type: 'group',
    scope_id: 101,
    scope_name: 'platform (Group)'
  }
];

let DEMO_BADGES: GitLabBadge[] = [
  // Project Badges (901)
  {
    id: 401,
    name: 'Pipeline Status',
    link_url: 'https://gitlab.com/platform/gitlab-orchestrator/-/pipelines',
    image_url: 'https://gitlab.com/platform/gitlab-orchestrator/badges/main/pipeline.svg',
    rendered_image_url: 'https://img.shields.io/badge/pipeline-passed-brightgreen.svg',
    kind: 'project',
    project_id: 901
  },
  {
    id: 402,
    name: 'Code Coverage',
    link_url: 'https://gitlab.com/platform/gitlab-orchestrator/-/pipelines',
    image_url: 'https://img.shields.io/badge/coverage-96.4%25-brightgreen.svg',
    rendered_image_url: 'https://img.shields.io/badge/coverage-96.4%25-brightgreen.svg',
    kind: 'project',
    project_id: 901
  },
  {
    id: 403,
    name: 'Latest Release',
    link_url: 'https://gitlab.com/platform/gitlab-orchestrator/-/releases',
    image_url: 'https://img.shields.io/badge/release-v2.4.0-blue.svg',
    rendered_image_url: 'https://img.shields.io/badge/release-v2.4.0-blue.svg',
    kind: 'project',
    project_id: 901
  },
  // Group Badges (101)
  {
    id: 404,
    name: 'Security Compliance',
    link_url: 'https://gitlab.com/groups/platform',
    image_url: 'https://img.shields.io/badge/compliance-ISO27001-green.svg',
    rendered_image_url: 'https://img.shields.io/badge/compliance-ISO27001-green.svg',
    kind: 'group',
    group_id: 101
  },
  {
    id: 405,
    name: 'Global Runners Fleet SLA',
    link_url: 'https://gitlab.com/groups/platform/-/runners',
    image_url: 'https://img.shields.io/badge/fleet_uptime-99.99%25-success.svg',
    rendered_image_url: 'https://img.shields.io/badge/fleet_uptime-99.99%25-success.svg',
    kind: 'group',
    group_id: 101
  }
];

let DEMO_PAGES: Record<number, GitLabPagesInfo> = {
  901: {
    is_enabled: true,
    url: 'https://platform.gitlab.io/gitlab-orchestrator',
    status: 'deployed',
    deployed_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    size_bytes: 14820000,
    https_only: true,
    access_control: false,
    domains: [
      {
        domain: 'docs.orchestrator.platform.io',
        auto_ssl_enabled: true,
        certificate_expiration: new Date(Date.now() + 3600000 * 24 * 74).toISOString(),
        verified: true
      }
    ],
    deploy_job_id: 7008,
    pipeline_id: 30101
  },
  902: {
    is_enabled: true,
    url: 'https://infra.gitlab.io/k8s-operator',
    status: 'deployed',
    deployed_at: new Date(Date.now() - 3600000 * 24).toISOString(),
    size_bytes: 4200000,
    https_only: true,
    access_control: false,
    domains: []
  },
  903: {
    is_enabled: false,
    url: '',
    status: 'not_configured',
    https_only: false,
    access_control: false,
    domains: []
  }
};

/** Normalises a GitLab REST merge request (list or single) to the UI shape. */
export function mapMergeRequest(m: any): GitLabMergeRequest {
  return {
    id: m.id,
    iid: m.iid,
    project_id: m.project_id,
    title: m.title,
    description: m.description || '',
    state: m.state,
    draft: Boolean(m.draft || m.work_in_progress),
    work_in_progress: Boolean(m.work_in_progress || m.draft),
    merge_status: m.merge_status,
    detailed_merge_status: m.detailed_merge_status,
    source_branch: m.source_branch,
    target_branch: m.target_branch,
    author: {
      id: m.author.id,
      name: m.author.name,
      username: m.author.username,
      avatar_url: m.author.avatar_url
    },
    assignees: (m.assignees || []).map((a: any) => ({
      id: a.id,
      name: a.name,
      username: a.username,
      avatar_url: a.avatar_url
    })),
    reviewers: (m.reviewers || []).map((r: any) => ({
      id: r.id,
      name: r.name,
      username: r.username,
      avatar_url: r.avatar_url
    })),
    labels: m.labels || [],
    // List responses carry no pipeline; single-MR responses carry head_pipeline (preferred) and pipeline.
    pipeline: (m.head_pipeline || m.pipeline) ? {
      id: (m.head_pipeline || m.pipeline).id,
      status: (m.head_pipeline || m.pipeline).status,
      web_url: (m.head_pipeline || m.pipeline).web_url,
      ref: (m.head_pipeline || m.pipeline).ref,
      sha: (m.head_pipeline || m.pipeline).sha
    } : undefined,
    reference: m.references?.full,
    sha: m.sha,
    has_conflicts: Boolean(m.has_conflicts),
    web_url: m.web_url,
    created_at: m.created_at,
    updated_at: m.updated_at,
    user_notes_count: m.user_notes_count || 0,
    changes_count: m.changes_count || '1',
    approved: Boolean(m.approved_by && m.approved_by.length > 0)
  };
}

/** Normalises a GitLab REST issue to a work item; checkbox lines in the description become subtasks. */
export function mapWorkItem(item: any): GitLabWorkItem {
  // Parse checkboxes in description into subtasks
  const subtasks: SubTask[] = [];
  if (item.description) {
    const lines = item.description.split('\n');
    let subId = 1;
    for (const line of lines) {
      const match = line.match(/^[\s-]*\[([ xX])\]\s*(.+)$/);
      if (match) {
        subtasks.push({
          id: subId++,
          title: match[2].trim(),
          completed: match[1].toLowerCase() === 'x',
          parent_iid: item.iid
        });
      }
    }
  }

  return {
    id: item.id,
    iid: item.iid,
    project_id: item.project_id,
    title: item.title,
    description: item.description || '',
    state: item.state,
    work_item_type: item.issue_type ? (item.issue_type.charAt(0).toUpperCase() + item.issue_type.slice(1)) : 'Issue',
    created_at: item.created_at,
    updated_at: item.updated_at,
    closed_at: item.closed_at,
    labels: item.labels || [],
    milestone: item.milestone ? { id: item.milestone.id, title: item.milestone.title } : null,
    assignees: (item.assignees || []).map((a: any) => ({
      id: a.id,
      name: a.name,
      username: a.username,
      avatar_url: a.avatar_url
    })),
    author: {
      id: item.author.id,
      name: item.author.name,
      username: item.author.username,
      avatar_url: item.author.avatar_url
    },
    user_notes_count: item.user_notes_count || 0,
    upvotes: item.upvotes || 0,
    web_url: item.web_url,
    reference: item.references?.full,
    weight: item.weight,
    subtasks
  };
}

export class GitLabClient {
  private host: string;
  private token: string | null;
  private isDemoMode: boolean;

  constructor(host = 'https://gitlab.com', token: string | null = null) {
    this.host = host.replace(/\/+$/, '');
    this.token = token && token.trim().length > 0 ? token.trim() : null;
    this.isDemoMode = !this.token;
  }

  isDemo(): boolean {
    return this.isDemoMode;
  }

  getHost(): string {
    return this.host;
  }

  private async fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<{ data: T; etag?: string }> {
    if (this.isDemoMode) {
      metricsManager.recordCacheHit(`demo:${endpoint}`);
      throw new Error('Cannot execute remote fetch in demo mode');
    }

    const url = `${this.host}/api/v4${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
    const headers = new Headers(options.headers || {});
    headers.set('PRIVATE-TOKEN', this.token!);
    headers.set('Accept', 'application/json');

    const start = performance.now();
    const res = await fetch(url, { ...options, headers });
    const durationMs = performance.now() - start;
    metricsManager.recordApiHit(endpoint, res.status, durationMs, res.headers);

    if (!res.ok) {
      const errText = await res.text();
      let msg = `GitLab API Error (${res.status}): ${res.statusText}`;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.message || parsed.error) msg += ` - ${parsed.message || parsed.error}`;
      } catch {
        msg += ` - ${errText.slice(0, 150)}`;
      }
      throw new Error(msg);
    }

    const etag = res.headers.get('ETag') || undefined;
    const data = await res.json();
    return { data, etag };
  }

  /** Read-only GET for modules outside this class (inbox, agents). Throws in demo mode. */
  async apiGet<T>(endpoint: string): Promise<T> {
    const { data } = await this.fetchApi<T>(endpoint);
    return data;
  }

  /**
   * Runs a per-project list call over the most recently active member projects and merges the results.
   * Tags each row with `project_name`. Throws only when every project failed.
   */
  private async forRecentProjects<T extends { project_name?: string }>(
    fetchOne: (project: GitLabProject) => Promise<T[]>
  ): Promise<T[]> {
    const projects = (await this.getProjects()).slice(0, AGGREGATE_PROJECT_LIMIT);
    const results = await mapLimit(projects, AGGREGATE_CONCURRENCY, async (project) =>
      (await fetchOne(project)).map((row) => ({ ...row, project_name: row.project_name ?? project.name }))
    );
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failures.length > 0 && failures.length === results.length) throw failures[0].reason;
    return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  }

  // 1. Current user
  async getCurrentUser(): Promise<GitLabUser> {
    if (this.isDemoMode) return DEMO_USER;

    const cacheKey = `user:current`;
    const cached = cacheDb.get<GitLabUser>(cacheKey);
    if (cached) return cached.data;

    const { data } = await this.fetchApi<GitLabUser>('/user');
    cacheDb.set(cacheKey, 'user', null, data, undefined, 600000);
    return data;
  }

  // 2. Projects
  async getProjects(force = false): Promise<GitLabProject[]> {
    if (this.isDemoMode) return DEMO_PROJECTS;

    const cacheKey = `projects:list`;
    if (!force) {
      const cached = cacheDb.get<GitLabProject[]>(cacheKey);
      if (cached) return cached.data;
    }

    const { data, etag } = await this.fetchApi<GitLabProject[]>('/projects?membership=true&simple=true&per_page=50&order_by=last_activity_at');
    cacheDb.set(cacheKey, 'projects', null, data, etag, 180000);
    return data;
  }

  // 3. Milestones
  async getMilestones(projectId?: number, force = false): Promise<GitLabMilestone[]> {
    if (this.isDemoMode) {
      if (projectId) return DEMO_MILESTONES.filter(m => m.project_id === projectId);
      return DEMO_MILESTONES;
    }

    if (!projectId) {
      const all = await this.forRecentProjects((p) => this.getMilestones(p.id, force));
      return all.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
    }

    const cacheKey = `milestones:${projectId}`;
    if (!force) {
      const cached = cacheDb.get<GitLabMilestone[]>(cacheKey);
      if (cached) return cached.data;
    }

    const { data, etag } = await this.fetchApi<any[]>(`/projects/${projectId}/milestones?per_page=50&state=active`);
    // The milestone API returns no issue counts; issues_statistics gives them per milestone (one call each).
    const stats = await mapLimit(data, AGGREGATE_CONCURRENCY, async (m) => {
      const { data: s } = await this.fetchApi<any>(
        `/projects/${projectId}/issues_statistics?milestone=${encodeURIComponent(m.title)}`
      );
      return s?.statistics?.counts as { opened: number; closed: number } | undefined;
    });
    const list: GitLabMilestone[] = data.map((m, i) => {
      const counts = stats[i].status === 'fulfilled' ? stats[i].value : undefined;
      const total = counts ? counts.opened + counts.closed : 0;
      return {
        id: m.id,
        iid: m.iid,
        project_id: m.project_id || projectId,
        title: m.title,
        description: m.description,
        state: m.state,
        due_date: m.due_date,
        start_date: m.start_date,
        web_url: m.web_url,
        // Left undefined when unknown; the UI shows "n/a" rather than a made-up number.
        open_issues_count: counts?.opened,
        closed_issues_count: counts?.closed,
        completion_percentage: counts ? (total ? Math.round((counts.closed / total) * 100) : 0) : undefined
      };
    });
    cacheDb.set(cacheKey, 'milestones', String(projectId), list, etag, 120000);
    return list;
  }

  async createMilestone(projectId: number, payload: { title: string; description?: string; due_date?: string; start_date?: string }): Promise<GitLabMilestone> {
    if (this.isDemoMode) {
      const proj = DEMO_PROJECTS.find(p => p.id === projectId) || DEMO_PROJECTS[0];
      const newM: GitLabMilestone = {
        id: Math.floor(Date.now() / 1000),
        iid: DEMO_MILESTONES.length + 1,
        project_id: projectId,
        project_name: proj.name,
        title: payload.title,
        description: payload.description,
        state: 'active',
        due_date: payload.due_date || null,
        start_date: payload.start_date || null,
        web_url: `${proj.web_url}/-/milestones/${DEMO_MILESTONES.length + 1}`,
        open_issues_count: 0,
        closed_issues_count: 0,
        completion_percentage: 0
      };
      DEMO_MILESTONES.unshift(newM);
      cacheDb.logWal('CREATE_MILESTONE', String(newM.id), 'milestones', `Created milestone "${newM.title}"`);
      return newM;
    }

    const { data } = await this.fetchApi<any>(`/projects/${projectId}/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    cacheDb.clear('milestones');
    cacheDb.logWal('CREATE_MILESTONE', String(data.id), 'milestones', `Created milestone "${data.title}"`);
    return data;
  }

  // 4. Work-Items & Issues
  async getWorkItems(projectId?: number, state: 'opened' | 'closed' | 'all' = 'all', force = false): Promise<GitLabWorkItem[]> {
    if (this.isDemoMode) {
      let items = [...DEMO_WORK_ITEMS];
      if (projectId) items = items.filter(i => i.project_id === projectId);
      if (state !== 'all') items = items.filter(i => i.state === state);
      return items;
    }

    // `/issues?scope=all` would include every public project on gitlab.com; stay within member projects.
    if (!projectId) {
      const all = await this.forRecentProjects((p) => this.getWorkItems(p.id, state, force));
      return all.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 100);
    }

    const cacheKey = `work_items:${projectId}:${state}`;
    if (!force) {
      const cached = cacheDb.get<GitLabWorkItem[]>(cacheKey);
      if (cached) return cached.data;
    }

    let endpoint = `/projects/${projectId}/issues?per_page=50`;
    if (state !== 'all') endpoint += `&state=${state}`;

    const { data, etag } = await this.fetchApi<any[]>(endpoint);
    const items: GitLabWorkItem[] = data.map(mapWorkItem);

    cacheDb.set(cacheKey, 'work_items', String(projectId), items, etag, 60000);
    return items;
  }

  async createWorkItem(projectId: number, payload: {
    title: string;
    description?: string;
    issue_type?: string;
    labels?: string[];
    assignee_ids?: number[];
    weight?: number;
    milestone_id?: number;
  }): Promise<GitLabWorkItem> {
    if (this.isDemoMode) {
      const proj = DEMO_PROJECTS.find(p => p.id === projectId) || DEMO_PROJECTS[0];
      const m = payload.milestone_id ? DEMO_MILESTONES.find(mil => mil.id === payload.milestone_id) : null;
      const newItem: GitLabWorkItem = {
        id: Math.floor(Date.now() / 1000),
        iid: DEMO_WORK_ITEMS.length + 50,
        project_id: projectId,
        project_name: proj.name,
        title: payload.title,
        description: payload.description || '',
        state: 'opened',
        work_item_type: (payload.issue_type || 'Issue') as any,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        closed_at: null,
        labels: payload.labels || [],
        milestone: m ? { id: m.id, title: m.title } : null,
        assignees: [DEMO_USER],
        author: DEMO_USER,
        user_notes_count: 0,
        upvotes: 0,
        web_url: `${proj.web_url}/-/issues/${DEMO_WORK_ITEMS.length + 50}`,
        weight: payload.weight,
        subtasks: []
      };
      DEMO_WORK_ITEMS.unshift(newItem);
      cacheDb.logWal('CREATE_ITEM', String(newItem.id), 'work_items', `Created work item "${newItem.title}"`);
      return newItem;
    }

    const { data } = await this.fetchApi<any>(`/projects/${projectId}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: payload.title,
        description: payload.description,
        issue_type: (payload.issue_type || 'issue').toLowerCase(),
        labels: payload.labels?.join(','),
        assignee_ids: payload.assignee_ids,
        weight: payload.weight,
        milestone_id: payload.milestone_id
      })
    });

    cacheDb.clear('work_items');
    cacheDb.logWal('CREATE_ITEM', String(data.id), 'work_items', `Created issue #${data.iid}`);
    return mapWorkItem(data);
  }

  async updateWorkItem(projectId: number, issueIid: number, payload: {
    title?: string;
    description?: string;
    state_event?: 'close' | 'reopen';
    labels?: string[];
    add_labels?: string[];
    remove_labels?: string[];
    milestone_id?: number | null;
    assignee_ids?: number[];
  }): Promise<GitLabWorkItem> {
    if (this.isDemoMode) {
      const index = DEMO_WORK_ITEMS.findIndex(i => i.project_id === projectId && i.iid === issueIid);
      if (index === -1) throw new Error('Work item not found');

      const existing = DEMO_WORK_ITEMS[index];
      let newLabels = [...existing.labels];

      if (payload.labels) newLabels = payload.labels;
      if (payload.add_labels) {
        for (const l of payload.add_labels) if (!newLabels.includes(l)) newLabels.push(l);
      }
      if (payload.remove_labels) {
        newLabels = newLabels.filter(l => !payload.remove_labels!.includes(l));
      }

      let newMilestone = existing.milestone;
      if (payload.milestone_id !== undefined) {
        if (payload.milestone_id === null) {
          newMilestone = null;
        } else {
          const m = DEMO_MILESTONES.find(mil => mil.id === payload.milestone_id);
          newMilestone = m ? { id: m.id, title: m.title } : null;
        }
      }

      let newAssignees = existing.assignees;
      if (payload.assignee_ids !== undefined) {
        newAssignees = payload.assignee_ids.length > 0 ? [DEMO_USER] : [];
      }

      const updated: GitLabWorkItem = {
        ...existing,
        title: payload.title !== undefined ? payload.title : existing.title,
        description: payload.description !== undefined ? payload.description : existing.description,
        state: payload.state_event === 'close' ? 'closed' : payload.state_event === 'reopen' ? 'opened' : existing.state,
        closed_at: payload.state_event === 'close' ? new Date().toISOString() : payload.state_event === 'reopen' ? null : existing.closed_at,
        labels: newLabels,
        assignees: newAssignees,
        milestone: newMilestone,
        updated_at: new Date().toISOString()
      };
      DEMO_WORK_ITEMS[index] = updated;
      cacheDb.logWal('UPDATE_ITEM', String(updated.id), 'work_items', `Updated issue #${issueIid}`);
      return updated;
    }

    const bodyObj: any = {};
    if (payload.title !== undefined) bodyObj.title = payload.title;
    if (payload.description !== undefined) bodyObj.description = payload.description;
    if (payload.state_event) bodyObj.state_event = payload.state_event;
    if (payload.labels) bodyObj.labels = payload.labels.join(',');
    if (payload.add_labels) bodyObj.add_labels = payload.add_labels.join(',');
    if (payload.remove_labels) bodyObj.remove_labels = payload.remove_labels.join(',');
    if (payload.milestone_id !== undefined) bodyObj.milestone_id = payload.milestone_id ?? 0; // 0 unassigns
    if (payload.assignee_ids !== undefined) bodyObj.assignee_ids = payload.assignee_ids;

    const { data } = await this.fetchApi<any>(`/projects/${projectId}/issues/${issueIid}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj)
    });

    cacheDb.clear('work_items');
    cacheDb.logWal('UPDATE_ITEM', String(data.id), 'work_items', `Updated issue #${issueIid}`);
    return mapWorkItem(data);
  }

  // Subtasks helper
  async toggleSubTask(projectId: number, issueIid: number, subtaskId: number, completed: boolean): Promise<SubTask[]> {
    if (this.isDemoMode) {
      const item = DEMO_WORK_ITEMS.find(i => i.project_id === projectId && i.iid === issueIid);
      if (item && item.subtasks) {
        const sub = item.subtasks.find(s => s.id === subtaskId);
        if (sub) sub.completed = completed;
        cacheDb.logWal('TOGGLE_SUBTASK', `${issueIid}:${subtaskId}`, 'work_items', `Subtask ${completed ? 'completed' : 'uncompleted'}`);
        return item.subtasks;
      }
      return [];
    }

    // In remote GitLab, update description checklist line
    const item = await this.fetchApi<any>(`/projects/${projectId}/issues/${issueIid}`);
    let desc = item.data.description || '';
    let counter = 1;
    const lines = desc.split('\n').map((line: string) => {
      const match = line.match(/^([\s-]*\[)([ xX])(\]\s*.+)$/);
      if (match) {
        if (counter === subtaskId) {
          counter++;
          return `${match[1]}${completed ? 'x' : ' '}${match[3]}`;
        }
        counter++;
      }
      return line;
    });

    const newDesc = lines.join('\n');
    await this.updateWorkItem(projectId, issueIid, { description: newDesc });
    cacheDb.logWal('TOGGLE_SUBTASK', `${issueIid}:${subtaskId}`, 'work_items', `Subtask toggled`);
    return [];
  }

  async addSubTask(projectId: number, issueIid: number, title: string): Promise<SubTask> {
    if (this.isDemoMode) {
      const item = DEMO_WORK_ITEMS.find(i => i.project_id === projectId && i.iid === issueIid);
      if (!item) throw new Error(`Work item #${issueIid} not found`);
      {
        if (!item.subtasks) item.subtasks = [];
        const newSub: SubTask = {
          id: Math.floor(Date.now() / 1000),
          title,
          completed: false,
          parent_iid: issueIid
        };
        item.subtasks.push(newSub);
        cacheDb.logWal('ADD_SUBTASK', String(newSub.id), 'work_items', `Added subtask "${title}" to #${issueIid}`);
        return newSub;
      }
    }

    const item = await this.fetchApi<any>(`/projects/${projectId}/issues/${issueIid}`);
    const currentDesc = item.data.description || '';
    const newDesc = `${currentDesc}${currentDesc && !currentDesc.endsWith('\n') ? '\n' : ''}- [ ] ${title}`;
    await this.updateWorkItem(projectId, issueIid, { description: newDesc });
    // Live subtask ids are 1-based positions among checkbox lines (see mapWorkItem).
    return { id: mapWorkItem({ ...item.data, description: newDesc }).subtasks!.length, title, completed: false, parent_iid: issueIid };
  }

  // 5. Notes & Comments
  async getWorkItemNotes(projectId: number, issueIid: number): Promise<GitLabNote[]> {
    const key = `work_item:${projectId}:${issueIid}`;
    if (this.isDemoMode) {
      return DEMO_NOTES[key] || [];
    }

    const { data } = await this.fetchApi<any[]>(`/projects/${projectId}/issues/${issueIid}/notes?sort=asc`);
    return data.map((n) => ({
      id: n.id,
      body: n.body,
      author: {
        id: n.author.id,
        name: n.author.name,
        username: n.author.username,
        avatar_url: n.author.avatar_url,
        web_url: n.author.web_url
      },
      created_at: n.created_at,
      system: Boolean(n.system),
      attachment: n.attachment ? { name: n.attachment.filename || 'attachment', url: n.attachment.url } : undefined
    }));
  }

  async createWorkItemNote(projectId: number, issueIid: number, body: string, attachment?: { name: string; url: string; size?: number }): Promise<GitLabNote> {
    const key = `work_item:${projectId}:${issueIid}`;
    if (this.isDemoMode) {
      if (!DEMO_NOTES[key]) DEMO_NOTES[key] = [];
      const newNote: GitLabNote = {
        id: Math.floor(Date.now() / 1000),
        body,
        author: DEMO_USER,
        created_at: new Date().toISOString(),
        system: false,
        attachment
      };
      DEMO_NOTES[key].push(newNote);
      cacheDb.logWal('ADD_NOTE', String(newNote.id), 'notes', `Added comment on #${issueIid}`);
      return newNote;
    }

    let fullBody = body;
    if (attachment) {
      fullBody += `\n\n![${attachment.name}](${attachment.url})`;
    }

    const { data } = await this.fetchApi<any>(`/projects/${projectId}/issues/${issueIid}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: fullBody })
    });

    cacheDb.logWal('ADD_NOTE', String(data.id), 'notes', `Added comment on #${issueIid}`);
    return {
      id: data.id,
      body: data.body,
      author: data.author,
      created_at: data.created_at,
      system: Boolean(data.system),
      attachment
    };
  }

  async getMergeRequestNotes(projectId: number, mrIid: number): Promise<GitLabNote[]> {
    const key = `mr:${projectId}:${mrIid}`;
    if (this.isDemoMode) {
      return DEMO_NOTES[key] || [];
    }

    const { data } = await this.fetchApi<any[]>(`/projects/${projectId}/merge_requests/${mrIid}/notes?sort=asc`);
    return data.map((n) => ({
      id: n.id,
      body: n.body,
      author: {
        id: n.author.id,
        name: n.author.name,
        username: n.author.username,
        avatar_url: n.author.avatar_url,
        web_url: n.author.web_url
      },
      created_at: n.created_at,
      system: Boolean(n.system)
    }));
  }

  async createMergeRequestNote(projectId: number, mrIid: number, body: string, attachment?: { name: string; url: string; size?: number }): Promise<GitLabNote> {
    const key = `mr:${projectId}:${mrIid}`;
    if (this.isDemoMode) {
      if (!DEMO_NOTES[key]) DEMO_NOTES[key] = [];
      const newNote: GitLabNote = {
        id: Math.floor(Date.now() / 1000),
        body,
        author: DEMO_USER,
        created_at: new Date().toISOString(),
        system: false,
        attachment
      };
      DEMO_NOTES[key].push(newNote);
      cacheDb.logWal('ADD_MR_NOTE', String(newNote.id), 'notes', `Added comment on !${mrIid}`);
      return newNote;
    }

    let fullBody = body;
    if (attachment) {
      fullBody += `\n\n![${attachment.name}](${attachment.url})`;
    }

    const { data } = await this.fetchApi<any>(`/projects/${projectId}/merge_requests/${mrIid}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: fullBody })
    });

    cacheDb.logWal('ADD_MR_NOTE', String(data.id), 'notes', `Added comment on !${mrIid}`);
    return {
      id: data.id,
      body: data.body,
      author: data.author,
      created_at: data.created_at,
      system: Boolean(data.system),
      attachment
    };
  }

  // 6. Merge Requests
  async getMergeRequests(projectId?: number, state: 'opened' | 'closed' | 'merged' | 'all' = 'all', force = false): Promise<GitLabMergeRequest[]> {
    if (this.isDemoMode) {
      let mrs = [...DEMO_MRS];
      if (projectId) mrs = mrs.filter(m => m.project_id === projectId);
      if (state !== 'all') mrs = mrs.filter(m => m.state === state);
      return mrs;
    }

    if (!projectId) {
      const all = await this.forRecentProjects((p) => this.getMergeRequests(p.id, state, force));
      return all.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 100);
    }

    const cacheKey = `mrs:${projectId}:${state}`;
    if (!force) {
      const cached = cacheDb.get<GitLabMergeRequest[]>(cacheKey);
      if (cached) return cached.data;
    }

    let endpoint = `/projects/${projectId}/merge_requests?per_page=50`;

    if (state !== 'all') endpoint += `&state=${state}`;

    const { data, etag } = await this.fetchApi<any[]>(endpoint);
    const mrs: GitLabMergeRequest[] = data.map(mapMergeRequest);
    // List responses carry no approval data; one filtered call marks the MRs the user has approved.
    try {
      const me = await this.getCurrentUser();
      const { data: mine } = await this.fetchApi<any[]>(
        `/projects/${projectId}/merge_requests?per_page=100&state=opened&approved_by_usernames[]=${encodeURIComponent(me.username)}`
      );
      const approved = new Set(mine.map((m) => m.iid));
      for (const mr of mrs) mr.approved = approved.has(mr.iid);
    } catch {
      // leave approved as mapped
    }

    cacheDb.set(cacheKey, 'merge_requests', String(projectId), mrs, etag, 60000);
    return mrs;
  }

  async createMergeRequest(projectId: number, payload: {
    title: string;
    description?: string;
    source_branch: string;
    target_branch?: string;
    labels?: string[];
    assignee_ids?: number[];
  }): Promise<GitLabMergeRequest> {
    if (this.isDemoMode) {
      const projects = await this.getProjects();
      const proj = projects.find(p => p.id === projectId) || projects[0];
      const maxIid = Math.max(...DEMO_MRS.map(m => m.iid), 0) + 1;
      const maxId = Math.max(...DEMO_MRS.map(m => m.id), 0) + 1;
      const isDraft = payload.title.toLowerCase().startsWith('draft:');
      const newMR: GitLabMergeRequest = {
        id: maxId,
        iid: maxIid,
        project_id: projectId,
        project_name: proj?.name || 'GitLab Orchestrator',
        title: payload.title,
        description: payload.description || '',
        state: 'opened',
        draft: isDraft,
        work_in_progress: isDraft,
        merge_status: 'can_be_merged',
        detailed_merge_status: 'mergeable',
        source_branch: payload.source_branch,
        target_branch: payload.target_branch || 'main',
        author: DEMO_USER,
        assignees: (payload.assignee_ids && payload.assignee_ids.length > 0) ? [DEMO_USER] : [],
        reviewers: [],
        labels: payload.labels || [],
        pipeline: {
          id: Math.floor(Date.now() / 1000),
          status: 'running',
          web_url: `https://gitlab.com/${proj?.path_with_namespace || 'platform/gitlab-orchestrator'}/-/pipelines/999`,
          ref: payload.source_branch,
          sha: 'a1b2c3d4e5f6'
        },
        has_conflicts: false,
        web_url: `https://gitlab.com/${proj?.path_with_namespace || 'platform/gitlab-orchestrator'}/-/merge_requests/${maxIid}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        user_notes_count: 0,
        changes_count: '1',
        approved: false
      };
      DEMO_MRS.unshift(newMR);
      cacheDb.logWal('CREATE_MR', String(newMR.id), 'merge_requests', `Created MR !${maxIid}: ${payload.title}`);
      return newMR;
    }

    const bodyObj: any = {
      title: payload.title,
      source_branch: payload.source_branch,
      target_branch: payload.target_branch || 'main'
    };
    if (payload.description) bodyObj.description = payload.description;
    if (payload.labels) bodyObj.labels = payload.labels.join(',');
    if (payload.assignee_ids && payload.assignee_ids.length > 0) bodyObj.assignee_ids = payload.assignee_ids;

    const { data } = await this.fetchApi<any>(`/projects/${projectId}/merge_requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj)
    });

    cacheDb.clear('merge_requests');
    cacheDb.logWal('CREATE_MR', String(data.id), 'merge_requests', `Created MR !${data.iid}: ${payload.title}`);
    return data;
  }

  async updateMergeRequest(projectId: number, mrIid: number, payload: {
    title?: string;
    description?: string;
    labels?: string[];
    draft?: boolean;
    state_event?: 'close' | 'reopen';
  }): Promise<GitLabMergeRequest> {
    if (this.isDemoMode) {
      const idx = DEMO_MRS.findIndex(m => m.project_id === projectId && m.iid === mrIid);
      if (idx === -1) throw new Error('MR not found');
      const cur = DEMO_MRS[idx];

      let newTitle = payload.title !== undefined ? payload.title : cur.title;
      if (payload.draft !== undefined) {
        if (payload.draft && !newTitle.startsWith('Draft: ')) {
          newTitle = 'Draft: ' + newTitle;
        } else if (!payload.draft && newTitle.startsWith('Draft: ')) {
          newTitle = newTitle.replace(/^Draft:\s*/, '');
        }
      }

      const updated: GitLabMergeRequest = {
        ...cur,
        title: newTitle,
        description: payload.description !== undefined ? payload.description : cur.description,
        draft: payload.draft !== undefined ? payload.draft : cur.draft,
        state: payload.state_event === 'close' ? 'closed' : payload.state_event === 'reopen' ? 'opened' : cur.state,
        labels: payload.labels || cur.labels,
        updated_at: new Date().toISOString()
      };
      DEMO_MRS[idx] = updated;
      cacheDb.logWal('UPDATE_MR', String(updated.id), 'merge_requests', `Updated MR !${mrIid}`);
      return updated;
    }

    const bodyObj: any = {};
    if (payload.title !== undefined) bodyObj.title = payload.title;
    if (payload.description !== undefined) bodyObj.description = payload.description;
    if (payload.state_event) bodyObj.state_event = payload.state_event;
    if (payload.labels) bodyObj.labels = payload.labels.join(',');
    // The MR API has no draft flag: GitLab derives draft status from a "Draft:" title prefix.
    if (payload.draft !== undefined) {
      const base = bodyObj.title ?? (await this.getMergeRequest(projectId, mrIid)).title;
      const stripped = String(base).replace(/^\s*(\[draft\]|\(draft\)|draft:|draft\s*-|wip:)\s*/i, '');
      bodyObj.title = payload.draft ? `Draft: ${stripped}` : stripped;
    }

    const { data } = await this.fetchApi<any>(`/projects/${projectId}/merge_requests/${mrIid}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj)
    });

    cacheDb.clear('merge_requests');
    cacheDb.logWal('UPDATE_MR', String(data.id), 'merge_requests', `Updated MR !${mrIid}`);
    return mapMergeRequest(data);
  }

  async approveMergeRequest(projectId: number, mrIid: number): Promise<any> {
    if (this.isDemoMode) {
      const idx = DEMO_MRS.findIndex(m => m.project_id === projectId && m.iid === mrIid);
      if (idx !== -1) {
        DEMO_MRS[idx].approved = true;
      }
      cacheDb.logWal('APPROVE_MR', String(mrIid), 'merge_requests', `Approved MR !${mrIid}`);
      return { approved: true };
    }

    const { data } = await this.fetchApi<any>(`/projects/${projectId}/merge_requests/${mrIid}/approve`, {
      method: 'POST'
    });
    cacheDb.clear('merge_requests');
    cacheDb.logWal('APPROVE_MR', String(mrIid), 'merge_requests', `Approved MR !${mrIid}`);
    return data;
  }

  async unapproveMergeRequest(projectId: number, mrIid: number): Promise<any> {
    if (this.isDemoMode) {
      const idx = DEMO_MRS.findIndex(m => m.project_id === projectId && m.iid === mrIid);
      if (idx !== -1) {
        DEMO_MRS[idx].approved = false;
      }
      cacheDb.logWal('UNAPPROVE_MR', String(mrIid), 'merge_requests', `Unapproved MR !${mrIid}`);
      return { approved: false };
    }

    const { data } = await this.fetchApi<any>(`/projects/${projectId}/merge_requests/${mrIid}/unapprove`, {
      method: 'POST'
    });
    cacheDb.clear('merge_requests');
    cacheDb.logWal('UNAPPROVE_MR', String(mrIid), 'merge_requests', `Unapproved MR !${mrIid}`);
    return data;
  }

  async mergeMergeRequest(projectId: number, mrIid: number, options: {
    shouldRemoveSourceBranch?: boolean;
    squash?: boolean;
    squashCommitMessage?: string;
    commitMessage?: string;
  } = {}): Promise<any> {
    if (this.isDemoMode) {
      const idx = DEMO_MRS.findIndex(m => m.project_id === projectId && m.iid === mrIid);
      if (idx !== -1) {
        DEMO_MRS[idx].state = 'merged';
        DEMO_MRS[idx].updated_at = new Date().toISOString();
      }
      cacheDb.logWal('MERGE_MR', String(mrIid), 'merge_requests', `Merged MR !${mrIid}`);
      return { status: 'merged' };
    }

    const { data } = await this.fetchApi<any>(`/projects/${projectId}/merge_requests/${mrIid}/merge`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        should_remove_source_branch: Boolean(options.shouldRemoveSourceBranch),
        squash: Boolean(options.squash),
        squash_commit_message: options.squashCommitMessage,
        commit_message: options.commitMessage
      })
    });

    cacheDb.clear('merge_requests');
    cacheDb.logWal('MERGE_MR', String(mrIid), 'merge_requests', `Merged MR !${mrIid}`);
    return data;
  }

  // 7. Pipelines & Jobs
  async getPipelines(projectId?: number, force = false): Promise<GitLabPipeline[]> {
    if (this.isDemoMode) {
      if (projectId) return DEMO_PIPELINES.filter(p => p.project_id === projectId);
      return DEMO_PIPELINES;
    }

    if (!projectId) {
      const all = await this.forRecentProjects((p) => this.getPipelines(p.id, force));
      return all.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50);
    }

    const cacheKey = `pipelines:${projectId}`;
    if (!force) {
      const cached = cacheDb.get<GitLabPipeline[]>(cacheKey);
      if (cached) return cached.data;
    }

    const { data, etag } = await this.fetchApi<any[]>(`/projects/${projectId}/pipelines?per_page=30`);
    const pipelines: GitLabPipeline[] = data.map((p) => ({
      id: p.id,
      project_id: p.project_id || projectId,
      status: p.status,
      ref: p.ref,
      sha: p.sha,
      web_url: p.web_url,
      created_at: p.created_at,
      updated_at: p.updated_at,
      user: p.user ? { name: p.user.name, username: p.user.username, avatar_url: p.user.avatar_url } : undefined
    }));

    cacheDb.set(cacheKey, 'pipelines', String(projectId), pipelines, etag, 45000);
    return pipelines;
  }

  // Single-item reads used by watches. Never cached: the caller polls for a fresh status.
  async getPipeline(projectId: number, pipelineId: number): Promise<GitLabPipeline> {
    if (this.isDemoMode) {
      const p = DEMO_PIPELINES.find((x) => x.id === pipelineId && x.project_id === projectId);
      if (!p) throw new Error(`Pipeline ${pipelineId} not found`);
      return p;
    }
    const { data: p } = await this.fetchApi<any>(`/projects/${projectId}/pipelines/${pipelineId}`);
    return {
      id: p.id,
      project_id: p.project_id || projectId,
      status: p.status,
      ref: p.ref,
      sha: p.sha,
      web_url: p.web_url,
      created_at: p.created_at,
      updated_at: p.updated_at,
      duration: p.duration ?? undefined,
      user: p.user ? { name: p.user.name, username: p.user.username, avatar_url: p.user.avatar_url } : undefined
    };
  }

  async getJob(projectId: number, jobId: number): Promise<GitLabJob & { failure_reason?: string }> {
    if (this.isDemoMode) {
      const job = Object.values(DEMO_JOBS).flat().find((j) => j.id === jobId);
      if (!job) throw new Error(`Job ${jobId} not found`);
      return job;
    }
    const { data: j } = await this.fetchApi<any>(`/projects/${projectId}/jobs/${jobId}`);
    return {
      id: j.id,
      name: j.name,
      stage: j.stage,
      status: j.status,
      duration: j.duration ?? undefined,
      started_at: j.started_at,
      finished_at: j.finished_at,
      pipeline_id: j.pipeline?.id,
      project_id: projectId,
      web_url: j.web_url,
      failure_reason: j.failure_reason
    };
  }

  async getWorkItem(projectId: number, issueIid: number): Promise<GitLabWorkItem> {
    if (this.isDemoMode) {
      const item = DEMO_WORK_ITEMS.find((i) => i.project_id === projectId && i.iid === issueIid);
      if (!item) throw new Error(`Work item #${issueIid} not found`);
      return item;
    }
    const { data } = await this.fetchApi<any>(`/projects/${projectId}/issues/${issueIid}`);
    return mapWorkItem(data);
  }

  async getMergeRequest(projectId: number, mrIid: number): Promise<GitLabMergeRequest> {
    if (this.isDemoMode) {
      const mr = DEMO_MRS.find((m) => m.project_id === projectId && m.iid === mrIid);
      if (!mr) throw new Error(`Merge request !${mrIid} not found`);
      return mr;
    }
    const { data } = await this.fetchApi<any>(`/projects/${projectId}/merge_requests/${mrIid}`);
    return mapMergeRequest(data);
  }

  async getPipelineJobs(projectId: number, pipelineId: number, force = false): Promise<{ stages: string[]; jobs: GitLabJob[] }> {
    if (this.isDemoMode) {
      const jobs = DEMO_JOBS[pipelineId] || [];
      const stageSet = new Set<string>();
      jobs.forEach(j => stageSet.add(j.stage));
      return { stages: Array.from(stageSet), jobs };
    }

    const cacheKey = `jobs:${projectId}:${pipelineId}`;
    const cached = force ? null : cacheDb.get<{ stages: string[]; jobs: GitLabJob[] }>(cacheKey);
    if (cached) return cached.data;

    const { data } = await this.fetchApi<any[]>(`/projects/${projectId}/pipelines/${pipelineId}/jobs?per_page=100`);
    const jobs: GitLabJob[] = data.map((j) => ({
      id: j.id,
      name: j.name,
      stage: j.stage,
      status: j.status,
      duration: j.duration,
      started_at: j.started_at,
      finished_at: j.finished_at,
      pipeline_id: pipelineId,
      project_id: projectId,
      runner: j.runner ? {
        id: j.runner.id,
        description: j.runner.description,
        active: j.runner.active,
        is_shared: j.runner.is_shared
      } : undefined,
      web_url: j.web_url,
      allow_failure: Boolean(j.allow_failure)
    }));

    const stageSet = new Set<string>();
    jobs.forEach(j => stageSet.add(j.stage));
    const res = { stages: Array.from(stageSet), jobs };

    cacheDb.set(cacheKey, 'jobs', String(projectId), res, undefined, 30000);
    return res;
  }

  async retryPipeline(projectId: number, pipelineId: number): Promise<any> {
    if (this.isDemoMode) {
      const p = DEMO_PIPELINES.find(pipe => pipe.id === pipelineId);
      if (p) p.status = 'running';
      cacheDb.logWal('RETRY_PIPELINE', String(pipelineId), 'pipelines', `Retried pipeline #${pipelineId}`);
      return { status: 'running' };
    }

    const res = await this.fetchApi(`/projects/${projectId}/pipelines/${pipelineId}/retry`, { method: 'POST' });
    cacheDb.clear('pipelines');
    cacheDb.logWal('RETRY_PIPELINE', String(pipelineId), 'pipelines', `Retried pipeline #${pipelineId}`);
    return res.data;
  }

  async cancelPipeline(projectId: number, pipelineId: number): Promise<any> {
    if (this.isDemoMode) {
      const p = DEMO_PIPELINES.find(pipe => pipe.id === pipelineId);
      if (p) p.status = 'canceled';
      cacheDb.logWal('CANCEL_PIPELINE', String(pipelineId), 'pipelines', `Canceled pipeline #${pipelineId}`);
      return { status: 'canceled' };
    }

    const res = await this.fetchApi(`/projects/${projectId}/pipelines/${pipelineId}/cancel`, { method: 'POST' });
    cacheDb.clear('pipelines');
    cacheDb.logWal('CANCEL_PIPELINE', String(pipelineId), 'pipelines', `Canceled pipeline #${pipelineId}`);
    return res.data;
  }

  async playJob(projectId: number, jobId: number): Promise<any> {
    if (this.isDemoMode) {
      for (const list of Object.values(DEMO_JOBS)) {
        const found = list.find(j => j.id === jobId);
        if (found) {
          found.status = 'running';
          break;
        }
      }
      cacheDb.logWal('PLAY_JOB', String(jobId), 'jobs', `Manual job #${jobId} triggered`);
      return { status: 'running' };
    }

    const res = await this.fetchApi(`/projects/${projectId}/jobs/${jobId}/play`, { method: 'POST' });
    cacheDb.clear('jobs');
    cacheDb.logWal('PLAY_JOB', String(jobId), 'jobs', `Manual job #${jobId} triggered`);
    return res.data;
  }

  /** Retries a finished job. GitLab creates a new job; its id is returned. `play` only works on manual jobs. */
  async retryJob(projectId: number, jobId: number): Promise<{ id: number; name: string; status: string; web_url?: string }> {
    if (this.isDemoMode) {
      for (const list of Object.values(DEMO_JOBS)) {
        const found = list.find((j) => j.id === jobId);
        if (found) {
          found.status = 'running';
          cacheDb.logWal('RETRY_JOB', String(jobId), 'jobs', `Retried job #${jobId}`);
          return { id: found.id, name: found.name, status: 'running', web_url: found.web_url };
        }
      }
      throw new Error(`Job ${jobId} not found`);
    }
    const { data } = await this.fetchApi<any>(`/projects/${projectId}/jobs/${jobId}/retry`, { method: 'POST' });
    cacheDb.clear('jobs');
    cacheDb.logWal('RETRY_JOB', String(jobId), 'jobs', `Retried job #${jobId} as #${data.id}`);
    return { id: data.id, name: data.name, status: data.status, web_url: data.web_url };
  }

  // 8. Runners (Registration, Assignment, Stop/Pause)
  async getRunners(force = false): Promise<GitLabRunner[]> {
    if (this.isDemoMode) return DEMO_RUNNERS;

    const cacheKey = `runners:all`;
    if (!force) {
      const cached = cacheDb.get<GitLabRunner[]>(cacheKey);
      if (cached) return cached.data;
    }

    const { data, etag } = await this.fetchApi<any[]>('/runners?per_page=50');
    const runners: GitLabRunner[] = data.map((r) => ({
      id: r.id,
      description: r.description || `runner-${r.id}`,
      ip_address: r.ip_address,
      active: Boolean(r.active),
      paused: Boolean(r.paused),
      is_shared: Boolean(r.is_shared),
      runner_type: r.runner_type || 'project_type',
      status: r.status || (r.paused ? 'paused' : r.active ? 'online' : 'offline'),
      tag_list: r.tag_list || [],
      project_ids: r.project_ids || []
    }));

    cacheDb.set(cacheKey, 'runners', null, runners, etag, 60000);
    return runners;
  }

  async toggleRunner(runnerId: number, paused: boolean): Promise<any> {
    if (this.isDemoMode) {
      const r = DEMO_RUNNERS.find(run => run.id === runnerId);
      if (r) {
        r.paused = paused;
        r.active = !paused;
        r.status = paused ? 'paused' : 'online';
      }
      cacheDb.logWal('TOGGLE_RUNNER', String(runnerId), 'runners', `${paused ? 'Paused' : 'Resumed'} runner #${runnerId}`);
      return { paused, active: !paused };
    }

    const res = await this.fetchApi(`/runners/${runnerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused, active: !paused })
    });
    cacheDb.clear('runners');
    cacheDb.logWal('TOGGLE_RUNNER', String(runnerId), 'runners', `${paused ? 'Paused' : 'Resumed'} runner #${runnerId}`);
    return res.data;
  }

  async registerRunner(payload: {
    description: string;
    tagList?: string[];
    runUntagged?: boolean;
    locked?: boolean;
    projectId?: number;
  }): Promise<{ runner: GitLabRunner; registrationToken: string; registerCommand: string }> {
    const buildCmd = (token: string) =>
      `gitlab-runner register --url ${this.host} --token ${token} --executor "docker" --docker-image "alpine:latest" --description "${payload.description}"`;

    if (this.isDemoMode) {
      const newRunner: GitLabRunner = {
        id: Math.floor(Date.now() / 1000),
        description: payload.description,
        ip_address: '10.240.20.15',
        active: true,
        paused: false,
        is_shared: !payload.projectId,
        runner_type: payload.projectId ? 'project_type' : 'instance_type',
        status: 'online',
        tag_list: payload.tagList || [],
        contacted_at: new Date().toISOString(),
        architecture: 'x86_64',
        platform: 'linux',
        version: '17.4.2',
        project_ids: payload.projectId ? [payload.projectId] : [901, 902, 903],
        run_untagged: payload.runUntagged,
        locked: payload.locked
      };
      DEMO_RUNNERS.unshift(newRunner);
      cacheDb.logWal('REGISTER_RUNNER', String(newRunner.id), 'runners', `Registered runner "${newRunner.description}"`);
      const demoToken = 'glrt-demo-' + Math.random().toString(36).substring(2, 12);
      return { runner: newRunner, registrationToken: demoToken, registerCommand: buildCmd(demoToken) };
    }

    // Remote runner registration: POST /user/runners returns the runner authentication token once.
    const { data } = await this.fetchApi<any>('/user/runners', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runner_type: payload.projectId ? 'project_type' : 'instance_type',
        project_id: payload.projectId,
        description: payload.description,
        tag_list: payload.tagList?.join(','),
        run_untagged: payload.runUntagged,
        locked: payload.locked
      })
    });
    cacheDb.clear('runners');
    cacheDb.logWal('REGISTER_RUNNER', String(data.id), 'runners', `Registered runner`);
    return {
      runner: {
        id: data.id,
        description: payload.description,
        active: true,
        paused: false,
        is_shared: !payload.projectId,
        runner_type: payload.projectId ? 'project_type' : 'instance_type',
        status: 'online',
        tag_list: payload.tagList || []
      },
      registrationToken: data.token,
      registerCommand: buildCmd(data.token)
    };
  }

  async assignRunnerToProject(runnerId: number, projectId: number): Promise<any> {
    if (this.isDemoMode) {
      const r = DEMO_RUNNERS.find(run => run.id === runnerId);
      if (r) {
        if (!r.project_ids) r.project_ids = [];
        if (!r.project_ids.includes(projectId)) r.project_ids.push(projectId);
      }
      cacheDb.logWal('ASSIGN_RUNNER', `${runnerId}:${projectId}`, 'runners', `Assigned runner #${runnerId} to project #${projectId}`);
      return { success: true };
    }

    const { data } = await this.fetchApi<any>(`/projects/${projectId}/runners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runner_id: runnerId })
    });
    cacheDb.clear('runners');
    cacheDb.logWal('ASSIGN_RUNNER', `${runnerId}:${projectId}`, 'runners', `Assigned runner #${runnerId} to project #${projectId}`);
    return data;
  }

  async unassignRunnerFromProject(runnerId: number, projectId: number): Promise<any> {
    if (this.isDemoMode) {
      const r = DEMO_RUNNERS.find(run => run.id === runnerId);
      if (r && r.project_ids) {
        r.project_ids = r.project_ids.filter(p => p !== projectId);
      }
      cacheDb.logWal('UNASSIGN_RUNNER', `${runnerId}:${projectId}`, 'runners', `Unassigned runner #${runnerId} from project #${projectId}`);
      return { success: true };
    }

    const { data } = await this.fetchApi<any>(`/projects/${projectId}/runners/${runnerId}`, {
      method: 'DELETE'
    });
    cacheDb.clear('runners');
    cacheDb.logWal('UNASSIGN_RUNNER', `${runnerId}:${projectId}`, 'runners', `Unassigned runner #${runnerId} from project #${projectId}`);
    return data;
  }

  async stopRunner(runnerId: number): Promise<any> {
    if (this.isDemoMode) {
      DEMO_RUNNERS = DEMO_RUNNERS.filter(r => r.id !== runnerId);
      cacheDb.logWal('STOP_RUNNER', String(runnerId), 'runners', `Removed runner #${runnerId}`);
      return { success: true };
    }

    const { data } = await this.fetchApi<any>(`/runners/${runnerId}`, {
      method: 'DELETE'
    });
    cacheDb.clear('runners');
    cacheDb.logWal('STOP_RUNNER', String(runnerId), 'runners', `Removed runner #${runnerId}`);
    return data;
  }

  // 9. Labels
  async getLabels(projectId?: number, force = false): Promise<GitLabLabel[]> {
    if (this.isDemoMode) return DEMO_LABELS;

    if (!projectId) {
      // Same label name in several projects is shown once.
      const all = await this.forRecentProjects((p) => this.getLabels(p.id, force) as Promise<(GitLabLabel & { project_name?: string })[]>);
      const byName = new Map<string, GitLabLabel>();
      for (const label of all) if (!byName.has(label.name)) byName.set(label.name, label);
      return [...byName.values()];
    }

    const cacheKey = `labels:${projectId}`;
    if (!force) {
      const cached = cacheDb.get<GitLabLabel[]>(cacheKey);
      if (cached) return cached.data;
    }

    const { data, etag } = await this.fetchApi<GitLabLabel[]>(`/projects/${projectId}/labels?per_page=100&with_counts=true`);
    cacheDb.set(cacheKey, 'labels', String(projectId), data, etag, 300000);
    return data;
  }

  async createLabel(projectId: number, payload: { name: string; color: string; description?: string }): Promise<GitLabLabel> {
    if (this.isDemoMode) {
      const newLabel: GitLabLabel = {
        id: Math.floor(Date.now() / 1000),
        name: payload.name,
        color: payload.color,
        description: payload.description,
        open_issues_count: 0,
        open_merge_requests_count: 0
      };
      DEMO_LABELS.unshift(newLabel);
      cacheDb.logWal('CREATE_LABEL', newLabel.name, 'labels', `Created label "${newLabel.name}"`);
      return newLabel;
    }

    const { data } = await this.fetchApi<GitLabLabel>(`/projects/${projectId}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    cacheDb.clear('labels');
    cacheDb.logWal('CREATE_LABEL', data.name, 'labels', `Created label "${data.name}"`);
    return data;
  }

  // 10. GitLab Packages (Read-only Viewer)
  async getPackages(projectId?: number, packageType?: string, force = false): Promise<GitLabPackage[]> {
    if (this.isDemoMode) {
      let pkgs = DEMO_PACKAGES;
      if (projectId) {
        pkgs = pkgs.filter(p => p.project_id === projectId);
      }
      if (packageType && packageType !== 'all') {
        pkgs = pkgs.filter(p => p.package_type === packageType);
      }
      return pkgs;
    }

    if (!projectId) {
      const all = await this.forRecentProjects((p) => this.getPackages(p.id, packageType, force));
      return all.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }

    const cacheKey = `packages:${projectId}:${packageType || 'all'}`;
    if (!force) {
      const cached = cacheDb.get<GitLabPackage[]>(cacheKey);
      if (cached) return cached.data;
    }

    const typeFilter = packageType && packageType !== 'all' ? `&package_type=${packageType}` : '';
    const { data, etag } = await this.fetchApi<any[]>(`/projects/${projectId}/packages?per_page=50${typeFilter}`);
    const packages: GitLabPackage[] = data.map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      version: pkg.version,
      package_type: pkg.package_type,
      status: pkg.status || 'default',
      created_at: pkg.created_at,
      project_id: pkg.project_id,
      tags: pkg.tags || [],
      pipeline_id: pkg.pipeline?.id,
      web_path: pkg._links?.web_path,
      install_command: pkg.package_type === 'npm' ? `npm install ${pkg.name}@${pkg.version}` : undefined
    }));
    cacheDb.set(cacheKey, 'packages', String(projectId), packages, etag, 60000);
    return packages;
  }

  async getPackage(projectId: number, packageId: number): Promise<GitLabPackage | null> {
    if (this.isDemoMode) {
      const pkg = DEMO_PACKAGES.find(p => p.id === packageId);
      return pkg || null;
    }
    try {
      const { data } = await this.fetchApi<any>(`/projects/${projectId}/packages/${packageId}`);
      const filesRes = await this.fetchApi<any[]>(`/projects/${projectId}/packages/${packageId}/package_files`);
      return {
        id: data.id,
        name: data.name,
        version: data.version,
        package_type: data.package_type,
        status: data.status,
        created_at: data.created_at,
        project_id: data.project_id,
        tags: data.tags || [],
        package_files: (filesRes.data || []).map(f => ({
          id: f.id,
          package_id: f.package_id,
          file_name: f.file_name,
          size: f.size,
          file_md5: f.file_md5,
          file_sha256: f.file_sha256,
          created_at: f.created_at,
          download_path: f.download_path
        }))
      };
    } catch (err: any) {
      if (/\(404\)/.test(err.message)) return null;
      throw err;
    }
  }

  // 11. Tags & Releases
  async getTags(projectId: number, force = false): Promise<GitLabTag[]> {
    if (this.isDemoMode) return DEMO_TAGS;

    const cacheKey = `tags:${projectId}`;
    if (!force) {
      const cached = cacheDb.get<GitLabTag[]>(cacheKey);
      if (cached) return cached.data;
    }

    const { data, etag } = await this.fetchApi<any[]>(`/projects/${projectId}/repository/tags?per_page=50`);
    const tags: GitLabTag[] = data.map(t => ({
      name: t.name,
      message: t.message,
      target: t.target,
      commit: {
        id: t.commit.id,
        short_id: t.commit.short_id,
        title: t.commit.title,
        created_at: t.commit.created_at,
        author_name: t.commit.author_name
      },
      release: t.release ? { tag_name: t.release.tag_name, description: t.release.description } : undefined,
      protected: t.protected
    }));
    cacheDb.set(cacheKey, 'tags', String(projectId), tags, etag, 60000);
    return tags;
  }

  async createTag(projectId: number, payload: { tag_name: string; ref: string; message?: string }): Promise<GitLabTag> {
    if (this.isDemoMode) {
      const newTag: GitLabTag = {
        name: payload.tag_name,
        message: payload.message || '',
        target: '48f910ab39c',
        commit: {
          id: '48f910ab39c',
          short_id: '48f910a',
          title: payload.message || `Release tag ${payload.tag_name}`,
          created_at: new Date().toISOString(),
          author_name: DEMO_USER.name
        },
        protected: false
      };
      DEMO_TAGS.unshift(newTag);
      cacheDb.logWal('CREATE_TAG', newTag.name, 'tags', `Created tag "${newTag.name}"`);
      return newTag;
    }

    const { data } = await this.fetchApi<any>(`/projects/${projectId}/repository/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    cacheDb.clear('tags');
    cacheDb.logWal('CREATE_TAG', data.name, 'tags', `Created tag "${data.name}"`);
    return data;
  }

  async getReleases(projectId: number, force = false): Promise<GitLabRelease[]> {
    if (this.isDemoMode) return DEMO_RELEASES;

    const cacheKey = `releases:${projectId}`;
    if (!force) {
      const cached = cacheDb.get<GitLabRelease[]>(cacheKey);
      if (cached) return cached.data;
    }

    const { data, etag } = await this.fetchApi<any[]>(`/projects/${projectId}/releases?per_page=50`);
    const releases: GitLabRelease[] = data.map(r => ({
      name: r.name,
      tag_name: r.tag_name,
      description: r.description,
      created_at: r.created_at,
      released_at: r.released_at,
      author: r.author,
      commit_path: r.commit_path,
      upcoming_release: r.upcoming_release,
      assets: r.assets
    }));
    cacheDb.set(cacheKey, 'releases', String(projectId), releases, etag, 60000);
    return releases;
  }

  /**
   * Release notes for `to` (a branch, tag or sha) from the commits since `from`, which defaults to the
   * newest tag (GitLab orders tags by last update). Commits are read with the compare API.
   */
  async getReleaseNotes(projectId: number, to: string, from?: string): Promise<ReleaseNotes> {
    let base: string | null = from || null;
    if (!base) {
      const tags = await this.getTags(projectId, true);
      base = tags.find((t) => t.name !== to)?.name ?? null;
    }
    let commits: CommitLike[];
    if (this.isDemoMode) {
      commits = [
        { short_id: '7a9c8f1e', title: 'feat(cache): expire entries on TTL' },
        { short_id: '8f4b2a3d', title: 'feat(pipelines): show why a pipeline failed' },
        { short_id: '99e2a14c', title: 'fix(runners): keep paused state after refresh' },
        { short_id: '55d8a94b', title: 'docs: describe the MCP server' },
        { short_id: '3c1d0e77', title: 'chore: bump dependencies' }
      ];
    } else if (base) {
      const { data } = await this.fetchApi<any>(
        `/projects/${projectId}/repository/compare?from=${encodeURIComponent(base)}&to=${encodeURIComponent(to)}&straight=false`
      );
      commits = (data.commits || []).reverse();
    } else {
      const { data } = await this.fetchApi<any[]>(`/projects/${projectId}/repository/commits?ref_name=${encodeURIComponent(to)}&per_page=100`);
      commits = data;
    }
    return buildReleaseNotes(commits, base, to);
  }

  async createRelease(projectId: number, payload: { tag_name: string; name: string; description: string; ref?: string }): Promise<GitLabRelease> {
    if (this.isDemoMode) {
      const newRel: GitLabRelease = {
        name: payload.name,
        tag_name: payload.tag_name,
        description: payload.description,
        created_at: new Date().toISOString(),
        released_at: new Date().toISOString(),
        author: DEMO_USER,
        upcoming_release: false,
        assets: {
          count: 2,
          sources: [
            { format: 'tar.gz', url: `https://gitlab.com/projects/${projectId}/archive/${payload.tag_name}.tar.gz` },
            { format: 'zip', url: `https://gitlab.com/projects/${projectId}/archive/${payload.tag_name}.zip` }
          ],
          links: []
        }
      };
      DEMO_RELEASES.unshift(newRel);
      // Link to tag if exists
      const tag = DEMO_TAGS.find(t => t.name === payload.tag_name);
      if (tag) {
        tag.release = { tag_name: payload.tag_name, description: payload.description };
      }
      cacheDb.logWal('CREATE_RELEASE', newRel.tag_name, 'releases', `Created release "${newRel.name}"`);
      return newRel;
    }

    const { data } = await this.fetchApi<any>(`/projects/${projectId}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    cacheDb.clear('releases');
    cacheDb.logWal('CREATE_RELEASE', data.tag_name, 'releases', `Created release "${data.name}"`);
    return data;
  }

  // 12. Job Trace & Runner Jobs
  async getJobTrace(projectId: number, jobId: number): Promise<JobTrace> {
    if (this.isDemoMode) {
      if (DEMO_JOB_TRACES[jobId]) {
        return DEMO_JOB_TRACES[jobId];
      }
      // Generate synthetic realistic trace if not in demo map
      return {
        job_id: jobId,
        project_id: projectId,
        job_name: `job-${jobId}`,
        stage: 'test',
        status: 'success',
        duration: 38,
        runner: { id: 1001, description: 'runner-spot-k8s-pool-01', ip_address: '10.240.12.8' },
        trace: `\x1b[36mRunning with gitlab-runner 17.4.0\x1b[0m
\x1b[32mChecking out git tree for job #${jobId}...\x1b[0m
\x1b[34m$ echo "Starting job execution"\x1b[0m
Execution finished in 38s
\x1b[32mJob succeeded with exit code 0\x1b[0m`
      };
    }

    const jobInfo = await this.fetchApi<any>(`/projects/${projectId}/jobs/${jobId}`);
    // Raw log endpoint
    const traceRes = await fetch(`${this.host}/api/v4/projects/${projectId}/jobs/${jobId}/trace`, {
      headers: this.token ? { 'PRIVATE-TOKEN': this.token } : {}
    });
    if (!traceRes.ok) throw new Error(`GitLab API Error (${traceRes.status}): could not read the log of job ${jobId}`);
    let rawText = await traceRes.text();
    // Keep the tail of very large logs: the failure is at the end and the UI cannot render megabytes.
    if (rawText.length > MAX_TRACE_CHARS) rawText = rawText.slice(-MAX_TRACE_CHARS);
    return {
      job_id: jobId,
      project_id: projectId,
      job_name: jobInfo.data.name,
      stage: jobInfo.data.stage,
      status: jobInfo.data.status,
      duration: jobInfo.data.duration,
      failure_reason: jobInfo.data.failure_reason,
      web_url: jobInfo.data.web_url,
      trace: rawText || 'No log output captured for this job.',
      runner: jobInfo.data.runner
    };
  }

  /**
   * Uploads a file to the project so issues, MRs and comments can link it. Returns GitLab's markdown,
   * which is relative to the project and renders inside GitLab. Demo mode inlines the file instead.
   */
  async uploadFile(projectId: number, filename: string, contentType: string, data: Buffer): Promise<{ markdown: string; url: string }> {
    if (this.isDemoMode) {
      const url = `data:${contentType || 'application/octet-stream'};base64,${data.toString('base64')}`;
      const markdown = contentType.startsWith('image/') ? `![${filename}](${url})` : `[${filename}](${url})`;
      return { markdown, url };
    }
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(data)], { type: contentType || 'application/octet-stream' }), filename);
    const { data: up } = await this.fetchApi<any>(`/projects/${projectId}/uploads`, { method: 'POST', body: form });
    cacheDb.logWal('UPLOAD', String(projectId), 'uploads', `Uploaded ${filename} (${data.length} bytes)`);
    return { markdown: up.markdown, url: up.full_path || up.url };
  }

  // TRIAGE: failure excerpts and running pipelines
  async getJobFailure(projectId: number, jobId: number): Promise<JobFailure> {
    const trace = await this.getJobTrace(projectId, jobId);
    let pipelineId: number | undefined;
    if (this.isDemoMode) {
      pipelineId = Object.values(DEMO_JOBS).flat().find((j) => j.id === jobId)?.pipeline_id;
    }
    return {
      job_id: jobId,
      project_id: projectId,
      pipeline_id: pipelineId,
      job_name: trace.job_name,
      stage: trace.stage,
      status: trace.status,
      web_url: trace.web_url,
      excerpt: extractFailure(trace.trace, { failureReason: trace.failure_reason })
    };
  }

  /** Excerpts for the failed jobs of a pipeline (allowed failures excluded), earliest stage first. */
  async getPipelineFailures(projectId: number, pipelineId: number): Promise<JobFailure[]> {
    const { stages, jobs } = await this.getPipelineJobs(projectId, pipelineId, true);
    const failed = jobs
      .filter((j) => j.status === 'failed' && !j.allow_failure)
      .sort((a, b) => stages.indexOf(a.stage) - stages.indexOf(b.stage))
      .slice(0, MAX_PIPELINE_FAILURES);
    const results = await mapLimit(failed, 3, (j) => this.getJobFailure(projectId, j.id));
    return results.flatMap((r, i) =>
      r.status === 'fulfilled' ? [{ ...r.value, pipeline_id: pipelineId, web_url: r.value.web_url ?? failed[i].web_url }] : []
    );
  }

  async getBranches(projectId: number, search = ''): Promise<GitLabBranch[]> {
    if (this.isDemoMode) {
      const project = DEMO_PROJECTS.find((p) => p.id === projectId);
      const names = new Set<string>([project?.default_branch || 'main']);
      DEMO_PIPELINES.filter((p) => p.project_id === projectId).forEach((p) => names.add(p.ref));
      DEMO_MRS.filter((m) => m.project_id === projectId).forEach((m) => m.source_branch && names.add(m.source_branch));
      return [...names]
        .filter((n) => n.toLowerCase().includes(search.toLowerCase()))
        .map((name) => ({ name, default: name === (project?.default_branch || 'main'), protected: name === 'main' }));
    }
    const q = search ? `&search=${encodeURIComponent(search)}` : '';
    const { data } = await this.fetchApi<any[]>(`/projects/${projectId}/repository/branches?per_page=50${q}`);
    return data.map((b) => ({
      name: b.name,
      default: Boolean(b.default),
      protected: Boolean(b.protected),
      commit_sha: b.commit?.short_id,
      committed_date: b.commit?.committed_date
    }));
  }

  /**
   * Variables declared under `variables:` in .gitlab-ci.yml for a ref, with descriptions and options.
   * Uses the GraphQL `ciConfigVariables` field that the GitLab "Run pipeline" page uses. Best effort:
   * returns [] when GraphQL is unavailable or the config has not been evaluated yet.
   */
  async getDeclaredVariables(projectId: number, ref: string): Promise<DeclaredVariable[]> {
    if (this.isDemoMode) {
      if (projectId !== 901) return [];
      return [
        { key: 'DEPLOY_ENV', value: 'staging', description: 'Target environment for deploy jobs', options: ['staging', 'production', 'preview'] },
        { key: 'SKIP_E2E', value: 'false', description: 'Skip the end-to-end suite' },
        { key: 'LOG_LEVEL', value: 'info' }
      ];
    }
    try {
      const { data: project } = await this.fetchApi<any>(`/projects/${projectId}`);
      const res = await fetch(`${this.host}/api/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({
          query: 'query($p: ID!, $r: String!) { project(fullPath: $p) { ciConfigVariables(ref: $r) { key value valueOptions description } } }',
          variables: { p: project.path_with_namespace, r: ref }
        })
      });
      if (!res.ok) return [];
      const body: any = await res.json();
      const vars: any[] = body?.data?.project?.ciConfigVariables || [];
      return vars.map((v) => ({
        key: v.key,
        value: v.value ?? '',
        description: v.description || undefined,
        options: Array.isArray(v.valueOptions) && v.valueOptions.length ? v.valueOptions : undefined
      }));
    } catch {
      return [];
    }
  }

  async createPipeline(projectId: number, ref: string, variables: PipelineVariableInput[] = []): Promise<GitLabPipeline> {
    if (this.isDemoMode) {
      const project = DEMO_PROJECTS.find((p) => p.id === projectId);
      const id = Math.max(...DEMO_PIPELINES.map((p) => p.id)) + 1;
      const now = new Date().toISOString();
      const pipeline: GitLabPipeline = {
        id,
        project_id: projectId,
        project_name: project?.name,
        status: 'pending',
        ref,
        sha: Math.random().toString(16).slice(2, 18).padEnd(16, '0'),
        web_url: `${project?.web_url || 'https://gitlab.com/demo'}/-/pipelines/${id}`,
        created_at: now,
        updated_at: now,
        user: { name: DEMO_USER.name, username: DEMO_USER.username, avatar_url: DEMO_USER.avatar_url }
      };
      DEMO_PIPELINES.unshift(pipeline);
      cacheDb.logWal('CREATE_PIPELINE', String(id), 'pipelines', `Started pipeline #${id} on ${ref} (${variables.length} variables)`);
      return pipeline;
    }

    const { data: p } = await this.fetchApi<any>(`/projects/${projectId}/pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref,
        variables: variables.map((v) => ({ key: v.key, value: v.value, variable_type: v.variable_type || 'env_var' }))
      })
    });
    cacheDb.clear('pipelines');
    cacheDb.logWal('CREATE_PIPELINE', String(p.id), 'pipelines', `Started pipeline #${p.id} on ${ref} (${variables.length} variables)`);
    return {
      id: p.id,
      project_id: p.project_id || projectId,
      status: p.status,
      ref: p.ref,
      sha: p.sha,
      web_url: p.web_url,
      created_at: p.created_at,
      updated_at: p.updated_at,
      user: p.user ? { name: p.user.name, username: p.user.username, avatar_url: p.user.avatar_url } : undefined
    };
  }

  async getRunnerJobs(runnerId: number): Promise<RunnerJob[]> {
    // Only fetched if runner details is requested to save API hits!
    if (this.isDemoMode) {
      return DEMO_RUNNER_JOBS[runnerId] || [];
    }

    const { data } = await this.fetchApi<any[]>(`/runners/${runnerId}/jobs?per_page=20`);
    return data.map(j => ({
      id: j.id,
      name: j.name,
      stage: j.stage,
      status: j.status,
      project_id: j.project.id,
      project_name: j.project.name,
      created_at: j.created_at,
      duration: j.duration
    }));
  }

  // 13. CI/CD Pipeline Editor & Visualizer
  private async defaultBranch(projectId: number): Promise<string> {
    const cached = (await this.getProjects().catch(() => [])).find((p) => p.id === projectId);
    if (cached?.default_branch) return cached.default_branch;
    const { data } = await this.fetchApi<any>(`/projects/${projectId}`);
    return data.default_branch || 'main';
  }

  /** Reads .gitlab-ci.yml from `ref` (default branch when omitted). A missing file returns empty content. */
  async getCiConfig(projectId: number, ref?: string): Promise<CiConfig> {
    if (this.isDemoMode) {
      const content = DEMO_CI_CONFIGS[projectId] || DEMO_CI_CONFIGS[901];
      return { projectId, content, branch: ref || 'main', updated_at: new Date().toISOString() };
    }

    const branch = ref || (await this.defaultBranch(projectId));
    try {
      const { data } = await this.fetchApi<any>(`/projects/${projectId}/repository/files/.gitlab-ci.yml?ref=${encodeURIComponent(branch)}`);
      return {
        projectId,
        content: Buffer.from(data.content, 'base64').toString('utf-8'),
        branch,
        last_commit_id: data.last_commit_id
      };
    } catch (err: any) {
      // Never fall back to sample YAML: a save would commit it to the real repository.
      if (/\(404\)/.test(err.message)) return { projectId, content: '', branch, missing: true };
      throw err;
    }
  }

  async saveCiConfig(projectId: number, payload: { content: string; commit_message: string; branch?: string }): Promise<{ success: boolean; branch: string; commit_id: string }> {
    if (this.isDemoMode) {
      const branch = payload.branch || 'main';
      DEMO_CI_CONFIGS[projectId] = payload.content;
      cacheDb.logWal('COMMIT_CI_CONFIG', String(projectId), 'ci_editor', `Committed .gitlab-ci.yml: "${payload.commit_message}"`);
      return { success: true, branch, commit_id: 'demo' };
    }

    const defaultBranch = await this.defaultBranch(projectId);
    const branch = payload.branch || defaultBranch;
    const enc = encodeURIComponent;
    const exists = async (path: string) => {
      try {
        await this.fetchApi(path);
        return true;
      } catch (err: any) {
        if (/\(404\)/.test(err.message)) return false;
        throw err;
      }
    };
    const branchExists = await exists(`/projects/${projectId}/repository/branches/${enc(branch)}`);
    const fileExists = await exists(`/projects/${projectId}/repository/files/.gitlab-ci.yml?ref=${enc(branchExists ? branch : defaultBranch)}`);

    await this.fetchApi(`/projects/${projectId}/repository/files/.gitlab-ci.yml`, {
      method: fileExists ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        branch,
        // A new branch is created from the default branch.
        ...(branchExists ? {} : { start_branch: defaultBranch }),
        content: payload.content,
        commit_message: payload.commit_message
      })
    });
    const { data: head } = await this.fetchApi<any>(`/projects/${projectId}/repository/branches/${enc(branch)}`);
    cacheDb.logWal('COMMIT_CI_CONFIG', String(projectId), 'ci_editor', `Committed .gitlab-ci.yml: "${payload.commit_message}"`);
    return { success: true, branch, commit_id: head.commit?.id || '' };
  }

  /**
   * Local parse for the stage/job graph. With `projectId` in live mode GitLab's
   * POST /projects/:id/ci/lint decides validity (includes, extends, rules) and the local errors are dropped.
   */
  async lintCiConfig(content: string, projectId?: number): Promise<CiLintResult> {
    let local: CiLintResult;
    try {
      const result = parseGitLabCiYaml(content);
      local = { valid: result.errors.length === 0, errors: result.errors, warnings: result.warnings, stages: result.stages, jobs: result.jobs, source: 'local' };
    } catch (err: any) {
      local = { valid: false, errors: [`YAML syntax error: ${err.message}`], warnings: [], stages: [], jobs: [], source: 'local' };
    }
    if (this.isDemoMode || !projectId) return local;
    try {
      const { data } = await this.fetchApi<any>(`/projects/${projectId}/ci/lint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      return { ...local, valid: Boolean(data.valid), errors: data.errors || [], warnings: data.warnings || [], source: 'gitlab' };
    } catch (err: any) {
      return { ...local, warnings: [...local.warnings, `GitLab lint unavailable, showing the local check: ${err.message}`] };
    }
  }


  // 14. CI/CD Variables (Personal / Group / Project scoped)
  async getVariables(scope: 'project' | 'group' | 'instance', id?: number): Promise<GitLabVariable[]> {
    if (this.isDemoMode) {
      if (scope === 'project' && id) {
        return DEMO_VARIABLES.filter(v => v.scope_type === 'project' && v.scope_id === id);
      }
      if (scope === 'group') {
        return DEMO_VARIABLES.filter(v => v.scope_type === 'group');
      }
      return DEMO_VARIABLES;
    }

    if (!id) throw new Error(`${scope} id is required`);
    const endpoint = scope === 'project'
      ? `/projects/${id}/variables`
      : `/groups/${id}/variables`;
    const { data } = await this.fetchApi<any[]>(endpoint);
    return data.map(v => ({
      key: v.key,
      value: v.value,
      variable_type: v.variable_type || 'env_var',
      protected: Boolean(v.protected),
      masked: Boolean(v.masked),
      raw: Boolean(v.raw),
      environment_scope: v.environment_scope || '*',
      scope_type: scope,
      scope_id: id || 0
    }));
  }

  /** One variable with its value. The list response leaves masked values out; this is the explicit reveal. */
  async getVariable(scope: 'project' | 'group', id: number, key: string, environmentScope = '*'): Promise<GitLabVariable> {
    if (this.isDemoMode) {
      const v = DEMO_VARIABLES.find(
        (d) => d.scope_type === scope && d.scope_id === id && d.key === key && d.environment_scope === environmentScope
      ) ?? DEMO_VARIABLES.find((d) => d.scope_type === scope && d.key === key && d.environment_scope === environmentScope);
      if (!v) throw new Error(`Variable ${key} not found`);
      return v;
    }
    const base = scope === 'project' ? `/projects/${id}/variables` : `/groups/${id}/variables`;
    const { data: v } = await this.fetchApi<any>(
      `${base}/${encodeURIComponent(key)}?filter[environment_scope]=${encodeURIComponent(environmentScope)}`
    );
    return {
      key: v.key,
      value: v.value,
      variable_type: v.variable_type || 'env_var',
      protected: Boolean(v.protected),
      masked: Boolean(v.masked),
      raw: Boolean(v.raw),
      environment_scope: v.environment_scope || '*',
      scope_type: scope,
      scope_id: id
    };
  }

  async saveVariable(payload: GitLabVariable): Promise<GitLabVariable> {
    if (this.isDemoMode) {
      const index = DEMO_VARIABLES.findIndex(
        v => v.key === payload.key && v.scope_type === payload.scope_type && v.scope_id === payload.scope_id
      );
      if (index >= 0) {
        DEMO_VARIABLES[index] = payload;
      } else {
        DEMO_VARIABLES.push(payload);
      }
      cacheDb.logWal('SAVE_VARIABLE', `${payload.scope_type}:${payload.key}`, 'variables', `Saved ${payload.scope_type} variable "${payload.key}"`);
      return payload;
    }

    const endpoint = payload.scope_type === 'project'
      ? `/projects/${payload.scope_id}/variables`
      : `/groups/${payload.scope_id}/variables`;

    const toVariable = (v: any): GitLabVariable => ({
      key: v.key,
      value: v.value,
      variable_type: v.variable_type || 'env_var',
      protected: Boolean(v.protected),
      masked: Boolean(v.masked),
      raw: Boolean(v.raw),
      environment_scope: v.environment_scope || '*',
      scope_type: payload.scope_type,
      scope_id: payload.scope_id,
      scope_name: payload.scope_name
    });

    // Try POST, if exists then PUT
    try {
      const { data } = await this.fetchApi<any>(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: payload.key,
          value: payload.value,
          variable_type: payload.variable_type,
          protected: payload.protected,
          masked: payload.masked,
          environment_scope: payload.environment_scope
        })
      });
      cacheDb.logWal('SAVE_VARIABLE', `${payload.scope_type}:${payload.key}`, 'variables', `Created variable "${payload.key}"`);
      return toVariable(data);
    } catch {
      const scopeFilter = `filter[environment_scope]=${encodeURIComponent(payload.environment_scope || '*')}`;
      const { data } = await this.fetchApi<any>(`${endpoint}/${encodeURIComponent(payload.key)}?${scopeFilter}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value: payload.value,
          variable_type: payload.variable_type,
          protected: payload.protected,
          masked: payload.masked,
          environment_scope: payload.environment_scope
        })
      });
      cacheDb.logWal('SAVE_VARIABLE', `${payload.scope_type}:${payload.key}`, 'variables', `Updated variable "${payload.key}"`);
      return toVariable(data);
    }
  }

  async deleteVariable(scope_type: 'project' | 'group', scope_id: number, key: string): Promise<boolean> {
    if (this.isDemoMode) {
      DEMO_VARIABLES = DEMO_VARIABLES.filter(
        v => !(v.key === key && v.scope_type === scope_type && v.scope_id === scope_id)
      );
      cacheDb.logWal('DELETE_VARIABLE', `${scope_type}:${key}`, 'variables', `Deleted variable "${key}"`);
      return true;
    }

    const endpoint = scope_type === 'project'
      ? `/projects/${scope_id}/variables/${encodeURIComponent(key)}`
      : `/groups/${scope_id}/variables/${encodeURIComponent(key)}`;
    await this.fetchApi(endpoint, { method: 'DELETE' });
    cacheDb.logWal('DELETE_VARIABLE', `${scope_type}:${key}`, 'variables', `Deleted variable "${key}"`);
    return true;
  }

  // 15. Badges (Project and Namespace / Group scoped)
  async getBadges(kind: 'project' | 'group', id: number): Promise<GitLabBadge[]> {
    if (this.isDemoMode) {
      return DEMO_BADGES.filter(b => (kind === 'project' ? b.project_id === id : b.group_id === id));
    }

    const endpoint = kind === 'project' ? `/projects/${id}/badges` : `/groups/${id}/badges`;
    const { data } = await this.fetchApi<any[]>(endpoint);
    return data.map(b => ({
      id: b.id,
      name: b.name || `Badge #${b.id}`,
      link_url: b.link_url,
      image_url: b.image_url,
      rendered_link_url: b.rendered_link_url,
      rendered_image_url: b.rendered_image_url,
      kind,
      project_id: kind === 'project' ? id : undefined,
      group_id: kind === 'group' ? id : undefined
    }));
  }

  async createBadge(payload: { name: string; link_url: string; image_url: string; kind: 'project' | 'group'; project_id?: number; group_id?: number }): Promise<GitLabBadge> {
    if (this.isDemoMode) {
      let rendered = payload.image_url;
      if (payload.image_url.includes('pipeline.svg') || payload.name.toLowerCase().includes('pipeline')) {
        const branchName = payload.name.split(':')[1]?.trim() || 'main';
        const color = branchName === 'develop' ? 'blue' : 'brightgreen';
        const status = branchName === 'develop' ? 'running' : 'passed';
        rendered = `https://img.shields.io/badge/pipeline%20(${encodeURIComponent(branchName)})-${status}-${color}.svg`;
      } else if (payload.image_url.includes('coverage.svg') || payload.name.toLowerCase().includes('coverage')) {
        const branchName = payload.name.split(':')[1]?.trim() || 'main';
        const cov = branchName === 'develop' ? '94.2%25' : '96.8%25';
        rendered = `https://img.shields.io/badge/coverage%20(${encodeURIComponent(branchName)})-${cov}-brightgreen.svg`;
      }

      const newBadge: GitLabBadge = {
        id: Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 10000),
        name: payload.name,
        link_url: payload.link_url,
        image_url: payload.image_url,
        rendered_image_url: rendered,
        kind: payload.kind,
        project_id: payload.project_id,
        group_id: payload.group_id
      };
      DEMO_BADGES.push(newBadge);
      cacheDb.logWal('CREATE_BADGE', String(newBadge.id), 'badges', `Added ${payload.kind} badge "${newBadge.name}"`);
      return newBadge;
    }

    const endpoint = payload.kind === 'project'
      ? `/projects/${payload.project_id}/badges`
      : `/groups/${payload.group_id}/badges`;

    const { data } = await this.fetchApi<any>(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: payload.name,
        link_url: payload.link_url,
        image_url: payload.image_url
      })
    });
    cacheDb.logWal('CREATE_BADGE', String(data.id), 'badges', `Added ${payload.kind} badge "${data.name}"`);
    return data;
  }

  async deleteBadge(kind: 'project' | 'group', id: number, badgeId: number): Promise<boolean> {
    if (this.isDemoMode) {
      DEMO_BADGES = DEMO_BADGES.filter(b => b.id !== badgeId);
      cacheDb.logWal('DELETE_BADGE', String(badgeId), 'badges', `Deleted badge #${badgeId}`);
      return true;
    }

    const endpoint = kind === 'project'
      ? `/projects/${id}/badges/${badgeId}`
      : `/groups/${id}/badges/${badgeId}`;
    await this.fetchApi(endpoint, { method: 'DELETE' });
    cacheDb.logWal('DELETE_BADGE', String(badgeId), 'badges', `Deleted badge #${badgeId}`);
    return true;
  }

  // 16. Repository Settings & Logo/Avatar Drag and Drop
  async updateProjectSettings(projectId: number, payload: { description?: string; topics?: string[]; visibility?: string; default_branch?: string }): Promise<GitLabProject> {
    if (this.isDemoMode) {
      const p = DEMO_PROJECTS.find(proj => proj.id === projectId);
      if (!p) throw new Error('Project not found');
      if (payload.description !== undefined) p.description = payload.description;
      if (payload.topics !== undefined) p.topics = payload.topics;
      if (payload.visibility) p.visibility = payload.visibility as any;
      if (payload.default_branch) p.default_branch = payload.default_branch;
      cacheDb.logWal('UPDATE_PROJECT', String(projectId), 'projects', `Updated project metadata for "${p.name}"`);
      return p;
    }

    const { data } = await this.fetchApi<any>(`/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: payload.description,
        topics: payload.topics,
        visibility: payload.visibility,
        default_branch: payload.default_branch
      })
    });
    cacheDb.clear('projects');
    cacheDb.logWal('UPDATE_PROJECT', String(projectId), 'projects', `Updated project metadata`);
    return data;
  }

  async updateProjectAvatar(projectId: number, avatarDataUrl: string): Promise<{ success: boolean; avatar_url: string }> {
    if (this.isDemoMode) {
      const p = DEMO_PROJECTS.find(proj => proj.id === projectId);
      if (p) {
        p.avatar_url = avatarDataUrl;
      }
      cacheDb.logWal('UPDATE_AVATAR', String(projectId), 'projects', `Uploaded new logo/icon for project #${projectId}`);
      return { success: true, avatar_url: avatarDataUrl };
    }

    // PUT /projects/:id accepts the avatar as a multipart file.
    const match = /^data:([^;]+);base64,(.+)$/.exec(avatarDataUrl);
    if (!match) throw new Error('Avatar must be a base64 data URL');
    const [, type, b64] = match;
    const ext = type.split('/')[1]?.replace('svg+xml', 'svg') || 'png';
    const form = new FormData();
    form.append('avatar', new Blob([new Uint8Array(Buffer.from(b64, 'base64'))], { type }), `avatar.${ext}`);
    const { data } = await this.fetchApi<any>(`/projects/${projectId}`, { method: 'PUT', body: form });
    cacheDb.clear('projects');
    cacheDb.logWal('UPDATE_AVATAR', String(projectId), 'projects', `Uploaded project avatar`);
    return { success: true, avatar_url: data.avatar_url };
  }

  // 17. GitLab Pages Details & Metadata
  /** GitLab 16.8+ `GET /projects/:id/pages`. A 404 means Pages has never been deployed for the project. */
  async getPagesInfo(projectId: number): Promise<GitLabPagesInfo> {
    if (this.isDemoMode) {
      return DEMO_PAGES[projectId] || DEMO_PAGES[901];
    }

    let data: any;
    try {
      ({ data } = await this.fetchApi<any>(`/projects/${projectId}/pages`));
    } catch (err: any) {
      if (/\(404\)/.test(err.message)) {
        return { is_enabled: false, url: '', status: 'not_configured', https_only: false, access_control: false, domains: [] };
      }
      throw err;
    }
    const [project, domains] = await Promise.all([
      this.fetchApi<any>(`/projects/${projectId}`).then((r) => r.data).catch(() => null),
      this.fetchApi<any[]>(`/projects/${projectId}/pages/domains`).then((r) => r.data).catch(() => [])
    ]);
    const deployments: any[] = Array.isArray(data.deployments) ? data.deployments : [];
    const latest = [...deployments].sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)))[0];
    return {
      is_enabled: true,
      url: data.url || '',
      status: deployments.length ? 'deployed' : 'not_configured',
      deployed_at: latest?.created_at,
      https_only: Boolean(data.force_https),
      access_control: project?.pages_access_level === 'private',
      domains: (domains || []).map((d) => ({
        domain: d.domain,
        auto_ssl_enabled: Boolean(d.auto_ssl_enabled),
        certificate_expiration: d.certificate?.expiration,
        verified: Boolean(d.verified)
      }))
    };
  }

  async updatePagesSettings(projectId: number, settings: { https_only?: boolean }): Promise<GitLabPagesInfo> {
    if (this.isDemoMode) {
      const current = DEMO_PAGES[projectId] || DEMO_PAGES[901];
      if (settings.https_only !== undefined) {
        current.https_only = settings.https_only;
      }
      cacheDb.logWal('UPDATE_PAGES', String(projectId), 'pages', `Updated GitLab Pages HTTPS setting to ${settings.https_only}`);
      return current;
    }

    await this.fetchApi<any>(`/projects/${projectId}/pages`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages_https_only: settings.https_only })
    });
    cacheDb.logWal('UPDATE_PAGES', String(projectId), 'pages', `Updated GitLab Pages HTTPS settings`);
    return this.getPagesInfo(projectId);
  }
}

