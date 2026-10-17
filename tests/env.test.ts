import { beforeAll, describe, expect, test } from 'bun:test';
import { dotenvCaveats, EnvVar, HEADER_MARK, parseSecretSpecs, quoteDotenv, renderDotenv } from '../cli/env.ts';
import { parseArgs } from '../cli/lazy.ts';
import { EnvLevel, envKeyFor, resolveEnv, scopeMatches } from '../server/envResolve.ts';
import { GitLabClient, GitLabVariable } from '../server/gitlabClient.ts';
import { handleMessage, listTools } from '../server/mcp.ts';
import { vault, VaultEntry } from '../server/vault.ts';

const v = (key: string, value: string, extra: Partial<GitLabVariable> = {}): GitLabVariable => ({
  key,
  value,
  variable_type: 'env_var',
  protected: false,
  masked: false,
  environment_scope: '*',
  scope_type: 'project',
  scope_id: 1,
  ...extra
});

const entry = (kind: VaultEntry['kind'], name: string, value: string, meta?: Record<string, any>): VaultEntry => ({
  id: name,
  kind,
  name,
  value,
  meta,
  createdAt: '',
  updatedAt: ''
});

describe('scopeMatches', () => {
  test('* always applies; other scopes need an environment', () => {
    expect(scopeMatches('*', null)).toBe(true);
    expect(scopeMatches('production', null)).toBe(false);
    expect(scopeMatches('production', 'production')).toBe(true);
    expect(scopeMatches('production', 'production-eu')).toBe(false);
  });
  test('wildcards match any characters and nothing else is a pattern', () => {
    expect(scopeMatches('review/*', 'review/42-fix')).toBe(true);
    expect(scopeMatches('review/*', 'staging')).toBe(false);
    expect(scopeMatches('*-eu', 'prod-eu')).toBe(true);
    expect(scopeMatches('prod.eu', 'prodXeu')).toBe(false);
  });
});

describe('resolveEnv', () => {
  const project: EnvLevel = {
    scope_type: 'project',
    scope_id: 1,
    label: 'team/app',
    variables: [
      v('URL', 'any'),
      v('URL', 'prod', { environment_scope: 'production' }),
      v('URL', 'review', { environment_scope: 'review/*' }),
      v('TOKEN', '', { masked: true, hidden: true, environment_scope: '*' }),
      v('KEY_FILE', 'pem', { variable_type: 'file' })
    ]
  };
  const sub: EnvLevel = { scope_type: 'group', scope_id: 20, label: 'team/sub', variables: [v('URL', 'group', { scope_type: 'group', scope_id: 20 }), v('NPM', 'sub', { scope_type: 'group', scope_id: 20 })] };
  const root: EnvLevel = { scope_type: 'group', scope_id: 10, label: 'team', variables: [v('NPM', 'root', { scope_type: 'group' }), v('SONAR', 'root', { scope_type: 'group' })] };
  const levels = [project, sub, root];

  const byKey = (vars: ReturnType<typeof resolveEnv>) => Object.fromEntries(vars.map((x) => [x.key, x]));

  test('project beats groups, the closest group beats its parent', () => {
    const r = byKey(resolveEnv({ levels, environment: null, entries: [] }));
    expect(r.URL.value).toBe('any');
    expect(r.URL.source).toBe('project');
    expect(r.NPM.value).toBe('sub');
    expect(r.NPM.from).toBe('team/sub');
    expect(r.SONAR.value).toBe('root');
  });

  test('exact scope beats a pattern, which beats *', () => {
    expect(byKey(resolveEnv({ levels, environment: 'production', entries: [] })).URL.value).toBe('prod');
    expect(byKey(resolveEnv({ levels, environment: 'review/7-x', entries: [] })).URL.value).toBe('review');
    expect(byKey(resolveEnv({ levels, environment: 'staging', entries: [] })).URL.value).toBe('any');
  });

  test('hidden values come from the vault CI secret pushed to that exact target, else are missing', () => {
    const missing = byKey(resolveEnv({ levels, environment: null, entries: [] })).TOKEN;
    expect(missing.value).toBeNull();
    expect(missing.missing).toContain('hidden');
    const wrongScope = entry('ci', 'tok', 's3cret', { targets: [{ scope_type: 'project', scope_id: 1, key: 'TOKEN', environment_scope: 'production' }] });
    expect(byKey(resolveEnv({ levels, environment: null, entries: [wrongScope] })).TOKEN.value).toBeNull();
    const right = entry('ci', 'tok', 's3cret', { targets: [{ scope_type: 'project', scope_id: 1, key: 'TOKEN', environment_scope: '*' }] });
    const found = byKey(resolveEnv({ levels, environment: null, entries: [right] })).TOKEN;
    expect(found.value).toBe('s3cret');
    expect(found.from_vault).toBe(true);
  });

  test('named secrets are added, win over CI variables, and report missing names', () => {
    const entries = [entry('secret', 'Stripe test key', 'sk_test'), entry('ci', 'Sonar', 'nope')];
    const r = byKey(
      resolveEnv({ levels, environment: null, entries, secrets: [{ name: 'Stripe test key' }, { name: 'Stripe test key', key: 'SONAR' }] })
    );
    expect(r.STRIPE_TEST_KEY.value).toBe('sk_test');
    expect(r.SONAR.value).toBe('sk_test');
    expect(r.SONAR.source).toBe('secret');
    // Only generic secrets are served by name; CI secrets are not.
    const ci = byKey(resolveEnv({ levels: [], environment: null, entries, secrets: [{ name: 'Sonar' }, { name: 'Gone' }] }));
    expect(ci.SONAR.value).toBeNull();
    expect(ci.GONE.missing).toBe('no vault secret named "Gone"');
  });

  test('envKeyFor makes a variable name from an entry name', () => {
    expect(envKeyFor('Stripe test key')).toBe('STRIPE_TEST_KEY');
    expect(envKeyFor('  db-url (prod) ')).toBe('DB_URL_PROD');
    expect(envKeyFor('1password')).toBe('_1PASSWORD');
    expect(envKeyFor('***')).toBe('SECRET');
  });
});

describe('dotenv rendering', () => {
  test('quotes only what needs it and keeps values literal', () => {
    expect(quoteDotenv('us-east-1')).toBe('us-east-1');
    expect(quoteDotenv('postgres://u:p@h:5432/db')).toBe('postgres://u:p@h:5432/db');
    expect(quoteDotenv('')).toBe('');
    expect(quoteDotenv('a b # c')).toBe("'a b # c'");
    expect(quoteDotenv('cost $5')).toBe("'cost $5'");
    expect(quoteDotenv('line1\nline2')).toBe("'line1\nline2'");
    expect(quoteDotenv("it's")).toBe('"it\'s"');
    expect(quoteDotenv(`it's "x"`)).toBe('"it\'s \\"x\\""');
  });

  test('renders a header, values, file paths and comments for missing values', () => {
    const vars: EnvVar[] = [
      { key: 'A', value: '1', variable_type: 'env_var', source: 'project', from: 'p', environment_scope: '*', protected: false, masked: false, from_vault: false },
      { key: 'F', value: 'pem', variable_type: 'file', source: 'project', from: 'p', environment_scope: '*', protected: false, masked: false, from_vault: false },
      { key: 'H', value: null, variable_type: 'env_var', source: 'group', from: 'g', environment_scope: '*', protected: false, masked: true, from_vault: false, missing: 'hidden' }
    ];
    const text = renderDotenv(vars, { project: 'team/app', environment: null, at: new Date('2026-10-18T00:00:00Z') }, new Map([['F', '/w/.env.d/F']]));
    expect(text.startsWith(`${HEADER_MARK} for team/app (environment: none) at 2026-10-18T00:00:00.000Z\n`)).toBe(true);
    expect(text).toContain('\nA=1\n');
    expect(text).toContain('\nF=/w/.env.d/F\n');
    expect(text).toContain('\n# H: hidden\n');
    expect(text).not.toContain('pem');
  });

  test('caveats name values some loaders change', () => {
    const mk = (key: string, value: string): EnvVar => ({ key, value, variable_type: 'env_var', source: 'project', from: 'p', environment_scope: '*', protected: false, masked: false, from_vault: false });
    expect(dotenvCaveats([mk('A', 'x$Y'), mk('B', 'plain'), mk('C', `'"`)])).toEqual({ dollar: ['A'], escaped: ['C'] });
  });

  test('secret specs: names, KEY=name and comma lists', () => {
    expect(parseSecretSpecs(['Stripe key', 'DB=Prod db,  Other ', ''])).toEqual([{ name: 'Stripe key' }, { key: 'DB', name: 'Prod db' }, { name: 'Other' }]);
    // A leading part that is not a variable name stays part of the entry name.
    expect(parseSecretSpecs(['my key=x'])).toEqual([{ name: 'my key=x' }]);
  });

  test('repeated options add to a comma list', () => {
    expect(parseArgs(['env', 'pull', '--secret', 'a', '--secret=B=b', '--force']).flags).toEqual({ secret: 'a,B=b', force: true });
    expect(parseArgs(['run', '--env', 'production', '--', 'npm', 'test']).rest).toEqual(['npm', 'test']);
  });
});

describe('get_env over MCP', () => {
  const demo = new GitLabClient();
  const call = (token: { name: string; secrets: boolean } | undefined, args: unknown) =>
    handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_env', arguments: args } }, () => ({ client: demo, token })) as Promise<any>;

  beforeAll(async () => {
    if (!vault.isInitialized()) await vault.initialize('tester', 'correct horse battery');
  });

  test('listed and callable only for tokens with secret access', async () => {
    expect(listTools().map((t) => t.name)).not.toContain('get_env');
    expect(listTools(true).map((t) => t.name)).toContain('get_env');
    const listed = (await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, () => ({ client: demo, token: { name: 'cli', secrets: true } }))) as any;
    expect(listed.result.tools.map((t: any) => t.name)).toContain('get_env');
    const denied = await call({ name: 'agent', secrets: false }, { project: 901 });
    expect(denied.result.isError).toBe(true);
    expect(denied.result.content[0].text).toContain('secret access');
    expect((await call(undefined, { project: 901 })).result.isError).toBe(true);
  });

  test('demo project: project and group variables, environment scopes', async () => {
    const res = await call({ name: 'cli', secrets: true }, { project: 'platform/gitlab-orchestrator' });
    expect(res.result.isError).toBe(false);
    const env = JSON.parse(res.result.content[0].text);
    const keys = env.variables.map((x: any) => x.key);
    expect(keys).toContain('AWS_DEFAULT_REGION');
    expect(keys).toContain('NPM_TOKEN');
    expect(keys).not.toContain('DATABASE_URL'); // production only
    expect(env.variables.find((x: any) => x.key === 'NPM_TOKEN').from).toBe('platform');

    const prod = JSON.parse((await call({ name: 'cli', secrets: true }, { project: 901, environment: 'production' })).result.content[0].text);
    const db = prod.variables.find((x: any) => x.key === 'DATABASE_URL');
    expect(db.value).toContain('postgres://');
    expect(prod.variables.find((x: any) => x.key === 'SSH_DEPLOY_KEY').variable_type).toBe('file');
  });

  test('a project in another group does not get platform group variables', async () => {
    const env = JSON.parse((await call({ name: 'cli', secrets: true }, { project: 902 })).result.content[0].text);
    expect(env.variables.map((x: any) => x.key)).not.toContain('NPM_TOKEN');
  });

  test('agent tokens record secret access', () => {
    const plain = vault.createAgentToken('agent');
    const cli = vault.createAgentToken('cli', { secrets: true });
    expect(vault.verifyAgentToken(plain.token)!.secrets).toBe(false);
    expect(vault.verifyAgentToken(cli.token)!.secrets).toBe(true);
    expect(vault.listAgentTokens().find((t) => t.id === cli.record.id)!.secrets).toBe(true);
  });
});
