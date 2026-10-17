/**
 * Resolves the CI/CD variables a job in a project would see, for local development (`lazy env pull`,
 * `lazy run`). Follows GitLab's rules:
 *
 * - Precedence: project variables, then the closest group, then each parent group. The first level
 *   that defines a key wins; instance variables are left out (they need admin access to read).
 * - Environment scope: without an environment only `*` applies, as for a job without `environment:`.
 *   With one, an exact scope beats a wildcard pattern such as `review/*`, which beats `*`.
 * - Hidden variables (masked and hidden) have no value in the API. The value comes from the vault CI
 *   secret that was pushed to that exact key and scope, when there is one.
 * - Named vault secrets are added last and win over CI variables with the same key.
 */
import { GitLabClient, GitLabVariable } from './gitlabClient.js';
import { VaultEntry } from './vault.js';

export interface EnvLevel {
  scope_type: 'project' | 'group';
  scope_id: number;
  /** Project or group path, for display. */
  label: string;
  variables: GitLabVariable[];
}

export interface ResolvedVar {
  key: string;
  /** null when no value is available (hidden in GitLab and not in the vault, or a missing vault secret). */
  value: string | null;
  variable_type: 'env_var' | 'file';
  source: 'project' | 'group' | 'secret';
  /** Project or group path, or the vault entry name for secrets. */
  from: string;
  environment_scope: string | null;
  protected: boolean;
  masked: boolean;
  /** The value came from a vault CI secret because GitLab hides it. */
  from_vault: boolean;
  missing?: string;
}

export interface SecretRequest {
  /** Vault entry name (kind "secret"). */
  name: string;
  /** Environment variable name; derived from the entry name when left out. */
  key?: string;
}

/** Does a variable's environment scope apply to the environment? `*` in a scope matches any characters. */
export function scopeMatches(scope: string, environment: string | null): boolean {
  if (scope === '*') return true;
  if (!environment) return false;
  if (!scope.includes('*')) return scope === environment;
  const pattern = scope.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${pattern}$`).test(environment);
}

/** 2 exact scope, 1 wildcard pattern, 0 `*`. */
const specificity = (scope: string) => (scope === '*' ? 0 : scope.includes('*') ? 1 : 2);

/** "Stripe test key" → "STRIPE_TEST_KEY". */
export function envKeyFor(name: string): string {
  const key = name.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[0-9]/.test(key) ? `_${key}` : key || 'SECRET';
}

export function resolveEnv(input: {
  /** Highest precedence first: the project, then its groups closest first. */
  levels: EnvLevel[];
  environment: string | null;
  /** Vault entries: CI secrets supply hidden values, generic secrets serve `secrets`. */
  entries: VaultEntry[];
  secrets?: SecretRequest[];
}): ResolvedVar[] {
  const byKey = new Map<string, ResolvedVar>();
  for (const level of input.levels) {
    const best = new Map<string, GitLabVariable>();
    for (const v of level.variables) {
      if (!scopeMatches(v.environment_scope, input.environment)) continue;
      const current = best.get(v.key);
      if (!current || specificity(v.environment_scope) > specificity(current.environment_scope)) best.set(v.key, v);
    }
    for (const [key, v] of best) {
      if (byKey.has(key)) continue; // a higher level already defines it
      let value: string | null = v.value;
      let fromVault = false;
      if (v.hidden) {
        value = vaultValueFor(input.entries, level, v);
        fromVault = value !== null;
      }
      byKey.set(key, {
        key,
        value,
        variable_type: v.variable_type,
        source: level.scope_type,
        from: level.label,
        environment_scope: v.environment_scope,
        protected: v.protected,
        masked: v.masked,
        from_vault: fromVault,
        ...(value === null ? { missing: 'hidden in GitLab and not stored in the lazylab vault' } : {})
      });
    }
  }

  for (const s of input.secrets ?? []) {
    const key = s.key?.trim() || envKeyFor(s.name);
    const entry = input.entries.find((e) => e.kind === 'secret' && e.name === s.name);
    byKey.set(key, {
      key,
      value: entry ? entry.value : null,
      variable_type: 'env_var',
      source: 'secret',
      from: s.name,
      environment_scope: null,
      protected: false,
      masked: true,
      from_vault: Boolean(entry),
      ...(entry ? {} : { missing: `no vault secret named "${s.name}"` })
    });
  }

  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function vaultValueFor(entries: VaultEntry[], level: EnvLevel, v: GitLabVariable): string | null {
  const entry = entries.find(
    (e) =>
      e.kind === 'ci' &&
      (e.meta?.targets ?? []).some(
        (t: any) => t.scope_type === level.scope_type && t.scope_id === level.scope_id && t.key === v.key && (t.environment_scope || '*') === v.environment_scope
      )
  );
  return entry ? entry.value : null;
}

/**
 * Reads the project's and its groups' variables. A group the user cannot read (403: not a
 * maintainer there) is skipped and reported in `errors`; a failing project read throws.
 */
export async function loadEnvLevels(client: GitLabClient, projectId: number, projectLabel: string): Promise<{ levels: EnvLevel[]; errors: string[] }> {
  const errors: string[] = [];
  const [projectVars, groups] = await Promise.all([
    client.getVariables('project', projectId),
    client.getProjectAncestorGroups(projectId).catch((err: any) => {
      errors.push(`groups of ${projectLabel}: ${err?.message ?? err}`);
      return [];
    })
  ]);
  const levels: EnvLevel[] = [{ scope_type: 'project', scope_id: projectId, label: projectLabel, variables: projectVars }];
  const groupVars = await Promise.all(
    groups.map((g) =>
      client.getVariables('group', g.id).catch((err: any) => {
        errors.push(`group ${g.full_path}: ${err?.message ?? err}`);
        return null;
      })
    )
  );
  groups.forEach((g, i) => {
    const vars = groupVars[i];
    if (vars) levels.push({ scope_type: 'group', scope_id: g.id, label: g.full_path, variables: vars });
  });
  return { levels, errors };
}
