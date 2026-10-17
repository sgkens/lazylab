/**
 * Pure helpers for `lazy env pull` and `lazy run`: secret arguments, .env rendering, and the
 * header that marks a file as written by lazy (so it may be overwritten).
 */

export interface EnvVar {
  key: string;
  value: string | null;
  variable_type: 'env_var' | 'file';
  source: 'project' | 'group' | 'secret';
  from: string;
  environment_scope: string | null;
  protected: boolean;
  masked: boolean;
  from_vault: boolean;
  missing?: string;
}

export const HEADER_MARK = '# Written by lazy env pull';

/**
 * "STRIPE_KEY=Stripe test key" or "Stripe test key" (variable name derived on the server).
 * Accepts several comma-separated specs per argument.
 */
export function parseSecretSpecs(specs: string[]): { name: string; key?: string }[] {
  const out: { name: string; key?: string }[] = [];
  for (const spec of specs.flatMap((s) => s.split(','))) {
    const raw = spec.trim();
    if (!raw) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(raw);
    out.push(m ? { key: m[1], name: m[2].trim() } : { name: raw });
  }
  return out;
}

/**
 * Quotes a value for .env loaders. Single quotes are literal (no escapes, no `$` expansion, may span
 * lines) in Node's --env-file, dotenv and Docker Compose, so they are used for anything that is not
 * plainly safe. A value with a single quote goes in double quotes as is; one with both quote kinds
 * needs escapes, which loaders do not agree on (see dotenvCaveats).
 */
export function quoteDotenv(value: string): string {
  if (/^[A-Za-z0-9_./:@%+,=-]*$/.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"') && !value.includes('\\')) return `"${value}"`;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`;
}

/** Keys whose values some loaders will not read back exactly. */
export function dotenvCaveats(vars: EnvVar[]): { dollar: string[]; escaped: string[] } {
  const withValue = vars.filter((v) => v.value !== null && v.variable_type === 'env_var');
  return {
    // Bun's loader expands $NAME even inside single quotes.
    dollar: withValue.filter((v) => v.value!.includes('$')).map((v) => v.key),
    escaped: withValue.filter((v) => /'/.test(v.value!) && /["\\]/.test(v.value!)).map((v) => v.key)
  };
}

/**
 * The .env text. `filePaths` maps file-type variables to the path their content was written to;
 * as in CI, the variable holds the path, not the content.
 */
export function renderDotenv(
  vars: EnvVar[],
  meta: { project: string; environment: string | null; at: Date },
  filePaths: Map<string, string> = new Map()
): string {
  const lines = [
    `${HEADER_MARK} for ${meta.project} (environment: ${meta.environment ?? 'none'}) at ${meta.at.toISOString()}`,
    '# Holds secrets: keep it out of git. Re-run lazy env pull to refresh it.',
    ''
  ];
  for (const v of vars) {
    if (v.value === null) {
      lines.push(`# ${v.key}: ${v.missing ?? 'no value'}`);
      continue;
    }
    const value = v.variable_type === 'file' ? (filePaths.get(v.key) ?? '') : v.value;
    lines.push(`${v.key}=${quoteDotenv(value)}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Short description of where a variable came from, for `lazy env`. */
export function describeSource(v: EnvVar): string {
  if (v.source === 'secret') return `vault secret "${v.from}"`;
  const scope = v.environment_scope && v.environment_scope !== '*' ? ` [${v.environment_scope}]` : '';
  return `${v.source} ${v.from}${scope}${v.from_vault ? ' (value from vault)' : ''}`;
}
