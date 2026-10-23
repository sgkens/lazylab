/**
 * Agent token policy: what a bearer token may do on /api/agent/* and /mcp.
 *
 * - scope: `read` may read GitLab and change lazylab's own local state (watches, handoffs, notes);
 *   `write` may also change GitLab (issues, MRs, comments) and run or retry CI.
 * - projects: allowlist of GitLab project ids; null means every project the user can reach.
 * - defaultProjectId: used by agent REST routes when a call omits projectId.
 * - expiresAt: the token stops authenticating after this instant; null means no expiry.
 * - secrets: may call get_env (CI variable values and vault secrets).
 *
 * Tokens stored before scopes existed have none of these fields. They keep the access they had:
 * write scope, every project, no expiry (see normalizeAgentToken).
 */

export type AgentScope = 'read' | 'write';

export const AGENT_SCOPES: AgentScope[] = ['read', 'write'];
export const MAX_ALLOWLIST_PROJECTS = 100;
export const MAX_EXPIRY_DAYS = 3650;

/** Stored token fields that define its access. All optional so older vault records still parse. */
export interface AgentTokenFields {
  scope?: AgentScope;
  secrets?: boolean;
  projects?: number[] | null;
  defaultProjectId?: number | null;
  expiresAt?: string | null;
}

/** The effective policy of an authenticated token, with defaults applied. */
export interface AgentPolicy {
  id: string;
  name: string;
  scope: AgentScope;
  secrets: boolean;
  projects: number[] | null;
  defaultProjectId: number | null;
  expiresAt: string | null;
}

export function normalizeAgentToken(t: { id: string; name: string } & AgentTokenFields): AgentPolicy {
  return {
    id: t.id,
    name: t.name,
    // Legacy records (no scope field) had full access; keeping it avoids silently breaking agents in use.
    scope: t.scope === 'read' ? 'read' : 'write',
    secrets: Boolean(t.secrets),
    projects: Array.isArray(t.projects) && t.projects.length ? [...t.projects] : null,
    defaultProjectId: typeof t.defaultProjectId === 'number' ? t.defaultProjectId : null,
    expiresAt: typeof t.expiresAt === 'string' ? t.expiresAt : null
  };
}

export function isExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const at = Date.parse(expiresAt);
  // An unreadable expiry fails closed.
  return Number.isNaN(at) || at <= now;
}

/** True when the token may act on this project. */
export function projectAllowed(policy: { projects?: number[] | null } | undefined, projectId: number): boolean {
  return !policy?.projects || policy.projects.includes(projectId);
}

export function projectDeniedMessage(projectId: number): string {
  return `This agent token is not allowed to access project ${projectId}. Allowed projects are set in Vault → Agent tokens.`;
}

export const READ_ONLY_MESSAGE = 'This agent token is read-only. Create or edit a token with write scope in Vault → Agent tokens to change GitLab or run CI.';

const positiveInt = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/**
 * Validates token settings from the vault API. `partial` (an edit) leaves absent fields unchanged;
 * a create fills defaults: read scope, no secrets, every project, no default project, no expiry.
 * `expiresInDays` (1..3650, or null for none) is converted to `expiresAt`.
 */
export function parseAgentTokenSettings(input: unknown, partial: boolean, now = Date.now()): AgentTokenFields {
  if (input === undefined || input === null) input = {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('token settings must be an object');
  const body = input as Record<string, unknown>;
  const out: AgentTokenFields = {};

  if (body.scope !== undefined) {
    if (!AGENT_SCOPES.includes(body.scope as AgentScope)) throw new Error('scope must be read or write');
    out.scope = body.scope as AgentScope;
  } else if (!partial) out.scope = 'read';

  if (body.secrets !== undefined) {
    if (typeof body.secrets !== 'boolean') throw new Error('secrets must be true or false');
    out.secrets = body.secrets;
  } else if (!partial) out.secrets = false;

  if (body.projects !== undefined) {
    if (body.projects === null) out.projects = null;
    else {
      if (!Array.isArray(body.projects) || !body.projects.every(positiveInt)) {
        throw new Error('projects must be a list of numeric GitLab project ids, or null for every project');
      }
      const unique = [...new Set(body.projects as number[])];
      if (unique.length > MAX_ALLOWLIST_PROJECTS) throw new Error(`at most ${MAX_ALLOWLIST_PROJECTS} projects can be allowed`);
      out.projects = unique.length ? unique : null;
    }
  } else if (!partial) out.projects = null;

  if (body.defaultProjectId !== undefined) {
    if (body.defaultProjectId !== null && !positiveInt(body.defaultProjectId)) {
      throw new Error('defaultProjectId must be a numeric GitLab project id, or null');
    }
    out.defaultProjectId = body.defaultProjectId as number | null;
  } else if (!partial) out.defaultProjectId = null;

  if (body.expiresInDays !== undefined) {
    if (body.expiresInDays === null) out.expiresAt = null;
    else {
      const days = body.expiresInDays;
      if (!positiveInt(days) || (days as number) > MAX_EXPIRY_DAYS) throw new Error(`expiresInDays must be between 1 and ${MAX_EXPIRY_DAYS}, or null`);
      out.expiresAt = new Date(now + (days as number) * 86_400_000).toISOString();
    }
  } else if (!partial) out.expiresAt = null;

  return out;
}

/** The default project must be one the token may use. Checked on the merged (stored + edited) settings. */
export function checkDefaultProject(fields: AgentTokenFields) {
  if (fields.defaultProjectId && fields.projects?.length && !fields.projects.includes(fields.defaultProjectId)) {
    throw new Error('defaultProjectId must be one of the allowed projects');
  }
}
