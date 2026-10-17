/**
 * CI failure triage: turns a raw GitLab job trace into the few lines that explain why it failed,
 * and validates input for running a pipeline.
 *
 * - Section markers (`section_start:<ts>:<name>[opts]\r\x1b[0K`) are parsed so the excerpt stays inside the
 *   section that failed and skips runner boilerplate (artifact upload, cache archive, cleanup).
 * - Carriage-return progress output keeps only its final state; ANSI colour codes are stripped.
 * - Everything here is pure so it can be unit-tested without GitLab.
 */

export interface ExcerptLine {
  /** 1-based line number in the cleaned trace. */
  n: number;
  text: string;
  /** Matches an error pattern (error, fail, fatal, panic, exception, ...). */
  hl: boolean;
}

export interface FailureExcerpt {
  section: string | null;
  sectionHeader: string | null;
  lines: ExcerptLine[];
  /** The most specific error line: the last highlighted line before the runner's "Job failed" line. */
  errorLine: string | null;
  exitCode: number | null;
  failureReason: string | null;
  failureHint: string | null;
  /** True for infrastructure failures where a retry is likely to pass. */
  retryable: boolean;
  totalLines: number;
}

export const FAILURE_REASONS: Record<string, { hint: string; retryable: boolean }> = {
  script_failure: { hint: 'A command in the job script exited non-zero.', retryable: false },
  runner_system_failure: { hint: 'The runner itself failed (executor, disk, network). Usually passes on retry.', retryable: true },
  stuck_or_timeout_failure: { hint: 'No runner picked the job up in time, or it got stuck.', retryable: true },
  job_execution_timeout: { hint: 'The job ran past its timeout.', retryable: false },
  scheduler_failure: { hint: 'GitLab could not schedule the job onto a runner.', retryable: true },
  api_failure: { hint: 'The runner could not talk to the GitLab API.', retryable: true },
  data_integrity_failure: { hint: 'Job data was corrupted between GitLab and the runner.', retryable: true },
  missing_dependency_failure: { hint: 'Artifacts from a needed job were missing or expired.', retryable: false },
  runner_unsupported: { hint: 'The runner is too old for a feature this job uses.', retryable: false },
  stale_schedule: { hint: 'A delayed job could not be run on time.', retryable: false },
  archived_failure: { hint: 'The project is archived or the job is too old to run.', retryable: false },
  unmet_prerequisites: { hint: 'A prerequisite (for example an environment or Kubernetes setup) failed.', retryable: false },
  forward_deployment_failure: { hint: 'A newer deployment already ran for this environment.', retryable: false },
  user_blocked: { hint: 'The user who triggered the job is blocked.', retryable: false },
  ci_quota_exceeded: { hint: 'The namespace ran out of CI minutes.', retryable: false },
  no_matching_runner: { hint: 'No online runner matches the job tags.', retryable: false },
  trace_size_exceeded: { hint: 'The job log exceeded the size limit.', retryable: false },
  image_pull_failure: { hint: 'The job image could not be pulled.', retryable: true },
  unknown_failure: { hint: 'GitLab did not record a reason.', retryable: false }
};

/** Runner sections that run after the script and never explain the failure. */
const BOILERPLATE_SECTIONS = new Set([
  'after_script',
  'archive_cache',
  'archive_cache_on_failure',
  'upload_artifacts_on_success',
  'upload_artifacts_on_failure',
  'cleanup_file_variables'
]);

const SECTION_RE = /section_(start|end):\d+:([A-Za-z0-9_.\-]+)(?:\[[^\]]*\])?\r?(?:\x1b\[0K)?/g;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
const JOB_FAILED_RE = /^ERROR: Job failed/;
const EXIT_CODE_RE = /exit (?:code|status) (\d+)/i;
const ERROR_RE =
  /\b(error|errors|failed|failure|fail|fatal|panic|exception|traceback|assert(?:ion)?(?:error)?|denied|not found|cannot|could not|unable to|segmentation fault|killed|oom)\b|✗|✕|×/i;

// Lines that name a cause, preferred over summary lines such as "1 fail" when picking errorLine.
const STRONG_ERROR_RE = /\b(error|fatal|panic|exception|traceback|assert\w*|segmentation fault|denied)\b/i;

export const DEFAULT_CONTEXT_LINES = 40;

interface CleanLine {
  text: string;
  section: string | null;
}

/** Strips markers, ANSI and carriage-return overwrites, tagging each line with its innermost section. */
export function cleanTrace(raw: string): { lines: CleanLine[]; headers: Map<string, string> } {
  const stack: string[] = [];
  const headers = new Map<string, string>();
  const lines: CleanLine[] = [];

  for (const rawLine of raw.replace(/\r\n/g, '\n').split('\n')) {
    let openedHere: string | null = null;
    let closed = false;

    for (const [, kind, name] of rawLine.matchAll(SECTION_RE)) {
      if (kind === 'start') {
        stack.push(name);
        openedHere = name;
      } else {
        const idx = stack.lastIndexOf(name);
        if (idx > -1) stack.splice(idx);
        closed = true;
      }
    }
    const rest = rawLine.replace(SECTION_RE, '');

    // Progress bars rewrite the line with \r; the terminal shows only the last segment.
    const segments = rest.split('\r');
    const text = segments[segments.length - 1].replace(ANSI_RE, '').replace(/\x1b/g, '').trimEnd();

    if (openedHere && text) headers.set(openedHere, text);
    if (!text && (openedHere || closed)) continue;
    lines.push({ text, section: stack.length ? stack[stack.length - 1] : openedHere });
  }

  // A trailing empty line from the final newline carries no information.
  while (lines.length && !lines[lines.length - 1].text) lines.pop();
  return { lines, headers };
}

export function extractFailure(
  raw: string,
  opts: { failureReason?: string | null; contextLines?: number } = {}
): FailureExcerpt {
  const contextLines = opts.contextLines ?? DEFAULT_CONTEXT_LINES;
  const { lines, headers } = cleanTrace(raw || '');
  const reason = opts.failureReason || null;
  const meta = reason ? FAILURE_REASONS[reason] : undefined;

  let failedAt = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (JOB_FAILED_RE.test(lines[i].text)) {
      failedAt = i;
      break;
    }
  }
  const exitMatch = failedAt > -1 ? lines[failedAt].text.match(EXIT_CODE_RE) : null;

  // Walk back from the failure past blank lines and post-script boilerplate to the last meaningful line.
  let end = (failedAt > -1 ? failedAt : lines.length) - 1;
  while (end >= 0 && (!lines[end].text || BOILERPLATE_SECTIONS.has(lines[end].section ?? ''))) end--;

  const section = end >= 0 ? lines[end].section : null;
  let start = Math.max(0, end - contextLines + 1);
  if (section) {
    // Stay inside the failing section when it is shorter than the window.
    let sectionStart = end;
    while (sectionStart > 0 && lines[sectionStart - 1].section === section) sectionStart--;
    start = Math.max(start, sectionStart);
  }

  const excerpt: ExcerptLine[] = [];
  for (let i = start; i <= end; i++) {
    excerpt.push({ n: i + 1, text: lines[i].text, hl: ERROR_RE.test(lines[i].text) });
  }
  if (failedAt > -1) excerpt.push({ n: failedAt + 1, text: lines[failedAt].text, hl: true });

  const candidates = excerpt.filter((l) => l.hl && !JOB_FAILED_RE.test(l.text));
  const best = [...candidates].reverse().find((l) => STRONG_ERROR_RE.test(l.text)) ?? candidates[candidates.length - 1];
  const errorLine = best ? best.text.trim() : null;

  return {
    section,
    sectionHeader: section ? headers.get(section) ?? null : null,
    lines: excerpt,
    errorLine,
    exitCode: exitMatch ? Number(exitMatch[1]) : null,
    failureReason: reason,
    failureHint: meta?.hint ?? (reason ? `GitLab reported ${reason.replace(/_/g, ' ')}.` : null),
    retryable: meta?.retryable ?? false,
    totalLines: lines.length
  };
}

/** One-line summary for notifications: "test:unit: FAIL controllers (61.8s)". */
export function summarizeFailure(jobName: string, excerpt: FailureExcerpt): string {
  const detail = excerpt.errorLine || excerpt.failureHint || 'failed';
  const trimmed = detail.length > 160 ? `${detail.slice(0, 157)}...` : detail;
  return `${jobName}: ${trimmed}`;
}

export interface RunPipelineInput {
  ref: string;
  variables: { key: string; value: string; variable_type: 'env_var' | 'file' }[];
  /** Watch the new pipeline; defaults to true. */
  watch: boolean;
}

/** Validates a run-pipeline request body. Rows with an empty key are dropped. */
export function parseRunPipelineInput(body: any): { error: string } | RunPipelineInput {
  const ref = typeof body?.ref === 'string' ? body.ref.trim() : '';
  if (!ref) return { error: 'ref is required' };
  const raw: any[] = Array.isArray(body?.variables) ? body.variables : [];
  const variables: RunPipelineInput['variables'] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    const key = typeof v?.key === 'string' ? v.key.trim() : '';
    if (!key) continue;
    if (!/^[A-Za-z0-9_]+$/.test(key)) return { error: `Invalid variable key "${key}": use letters, digits and _` };
    if (seen.has(key)) return { error: `Variable "${key}" is set twice` };
    seen.add(key);
    variables.push({ key, value: String(v.value ?? ''), variable_type: v.variable_type === 'file' ? 'file' : 'env_var' });
  }
  return { ref, variables, watch: body?.watch !== false };
}
