/** Agent-authored checkpoints. GitLab remains the source of truth for task and CI state. */
export type TaskKind = 'work_item' | 'merge_request';
export interface TaskRef {
  project_id: number;
  kind: TaskKind;
  iid: number;
}

export interface HandoffInput {
  status: 'in_progress' | 'blocked' | 'ready_for_review' | 'done';
  summary: string;
  decisions: string[];
  attempts: string[];
  verification: { check: string; result: 'passed' | 'failed' | 'not_run'; details?: string }[];
  next_steps: string[];
  blockers: string[];
  branch?: string;
  head_sha?: string;
}

export interface AgentHandoff extends HandoffInput, TaskRef {
  id: string;
  profile_id: string | null;
  created_at: string;
  author: { id: string | null; name: string };
}

export const HANDOFFS_PER_TASK = 20;
export const HANDOFFS_TOTAL = 500;

export function validateTask(task: TaskRef) {
  if (!Number.isSafeInteger(task.project_id) || task.project_id <= 0) throw new Error('project_id must be a positive integer');
  if (!Number.isSafeInteger(task.iid) || task.iid <= 0) throw new Error('iid must be a positive integer');
  if (task.kind !== 'work_item' && task.kind !== 'merge_request') throw new Error('kind must be work_item or merge_request');
}

const text = (value: unknown, name: string, max = 1000): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} must contain 1–${max} characters`);
  return value.trim();
};

/** Validate at the storage boundary too: clients must not inject identity or arbitrary fields. */
export function parseHandoff(input: unknown): HandoffInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('handoff must be an object');
  const raw = input as Record<string, unknown>;
  const allowed = ['status', 'summary', 'decisions', 'attempts', 'verification', 'next_steps', 'blockers', 'branch', 'head_sha'];
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) throw new Error(`unknown handoff field "${key}"`);
  if (typeof raw.status !== 'string' || !['in_progress', 'blocked', 'ready_for_review', 'done'].includes(raw.status)) throw new Error('invalid handoff status');
  const strings = (key: string): string[] => {
    const list = raw[key] === undefined ? [] : raw[key];
    if (!Array.isArray(list) || list.length > 20) throw new Error(`${key} must be an array of at most 20 entries`);
    return list.map((v) => text(v, key));
  };
  const verification = raw.verification === undefined ? [] : raw.verification;
  if (!Array.isArray(verification) || verification.length > 20) throw new Error('verification must be an array of at most 20 checks');
  const result: HandoffInput = {
    status: raw.status as HandoffInput['status'],
    summary: text(raw.summary, 'summary', 4000),
    decisions: strings('decisions'), attempts: strings('attempts'),
    blockers: strings('blockers'), next_steps: strings('next_steps'),
    verification: verification.map((v) => {
      if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some((k) => !['check', 'result', 'details'].includes(k))) {
        throw new Error('verification entries need check, result and optional details');
      }
      if (!['passed', 'failed', 'not_run'].includes(v.result)) throw new Error('verification result must be passed, failed or not_run');
      return { check: text(v.check, 'check'), result: v.result, ...(v.details !== undefined ? { details: text(v.details, 'details') } : {}) };
    })
  };
  if (result.status !== 'done' && !result.next_steps.length) throw new Error('next_steps is required unless status is done');
  if (result.status === 'blocked' && !result.blockers.length) throw new Error('blocked handoffs need at least one blocker');
  if (raw.branch !== undefined) result.branch = text(raw.branch, 'branch', 255);
  if (raw.head_sha !== undefined) {
    if (typeof raw.head_sha !== 'string' || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(raw.head_sha)) throw new Error('head_sha must be a full commit SHA');
    result.head_sha = raw.head_sha.toLowerCase();
  }
  if (JSON.stringify(result).length > 30_000) throw new Error('handoff exceeds 30000 characters');
  return result;
}

export function sameTask(a: TaskRef, b: TaskRef) {
  return a.project_id === b.project_id && a.kind === b.kind && a.iid === b.iid;
}
