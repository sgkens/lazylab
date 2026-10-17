#!/usr/bin/env bun
/**
 * lazy: lazylab from the terminal. Talks to lazylab's MCP endpoint with an agent token and finds
 * the GitLab project from the current git checkout.
 */
import { CliConfig, CliError, configPath, LazyClient, loadConfig, normalizeUrl, saveConfig } from './client.js';
import * as cmd from './commands.js';
import { parseSecretSpecs } from './env.js';
import { detectProject, GitError, tryGit } from './git.js';
import { err, out, paint, resetTerminal, UI } from './ui.js';

export const VERSION = '0.1.0';

const HELP = `lazy ${VERSION}: lazylab from the terminal

Usage: lazy <command> [options]

Commands:
  login <url> [--token llab_…]     Save the lazylab URL and an agent token (prompted if omitted)
  inbox [--refresh]                MRs, issues and To-Dos that need you
  ci [--ref <ref>] [--all]         Recent pipelines for the current branch
  ci watch [<pipeline-id>]         Follow a pipeline until it finishes (latest on this branch by default)
  job log <job-id>                 The failing section of a job log
  job log --failed [<pipeline-id>] Failures of the latest failed pipeline on this branch
  retry <job-id> [--follow]        Retry a job; --follow follows its pipeline
  mr create [--draft] [--target <branch>] [--title <t>] [--label a,b] [--watch]
                                   Open an MR from the current branch; title and body from the
                                   last commit, "Closes #N" from a "N-slug" branch name
  push [--detach] [-- <git push args>]
                                   git push, then follow the new pipeline; lazylab also
                                   notifies you when it finishes
  env [--env <name>]               CI/CD variables that apply here and where each comes from
                                   (values not shown)
  env pull [--env <name>] [--out .env] [--force]
                                   Write them to a .env file (mode 600); refuses a file git
                                   does not ignore unless --force
  run [--env <name>] -- <command>  Run a command with them in its environment; nothing is written

  env and run need an agent token with "Can read secrets" (Vault → Agent tokens).
  --env defaults to git config lazylab.environment; without one only * scoped variables apply.
  --secret KEY=name,name adds vault secrets by entry name (also: git config --add lazylab.secret)

Options:
  --project <path|id>   GitLab project (default: git config lazylab.project, else the origin remote)
  --json                Print the raw result as JSON
  --no-notify           Do not ask lazylab to watch the pipeline (ci watch, push)
  --interval <s>        Poll interval while following (default 5)
  -h, --help            Show this help
  -v, --version         Show the version

Environment: LAZYLAB_URL and LAZYLAB_TOKEN override ${configPath()}
Exit codes: 0 done or pipeline passed, 1 error or pipeline failed, 2 usage error, 130 interrupted`;

const BOOLEAN_FLAGS = new Set(['json', 'refresh', 'all', 'failed', 'follow', 'draft', 'watch', 'detach', 'no-notify', 'force', 'help', 'version']);
const SHORT: Record<string, string> = { h: 'help', v: 'version' };

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
  /** Everything after "--", passed through (lazy push -- --force-with-lease). */
  rest: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const [name, inline] = a.slice(2).split(/=(.*)/s, 2);
      let value: string;
      if (BOOLEAN_FLAGS.has(name)) {
        flags[name] = true;
        continue;
      } else if (inline !== undefined) value = inline;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) value = argv[++i];
      else throw new CliError(`--${name} needs a value`, 2);
      // A repeated option adds to the list: --label a --label b is --label a,b.
      flags[name] = typeof flags[name] === 'string' ? `${flags[name]},${value}` : value;
    } else if (/^-[a-z]$/i.test(a) && SHORT[a[1]]) {
      flags[SHORT[a[1]]] = true;
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags, rest };
}

function intArg(value: string | undefined, what: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value.replace(/^[#!]/, ''));
  if (!Number.isInteger(n) || n <= 0) throw new CliError(`${what} must be a number, got "${value}"`, 2);
  return n;
}

const str = (v: string | boolean | undefined) => (typeof v === 'string' ? v : undefined);

/** --env and --secret, with defaults from git config in the checkout. */
function envOptions(flags: ParsedArgs['flags']): cmd.EnvOpts {
  const environment = str(flags.env) ?? tryGit(['config', '--get', 'lazylab.environment']) ?? null;
  const configured = (tryGit(['config', '--get-all', 'lazylab.secret']) ?? '').split('\n');
  return { environment: environment?.trim() || null, secrets: parseSecretSpecs([...configured, str(flags.secret) ?? '']) };
}

async function readSecret(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  for await (const line of console) return line.trim();
  return '';
}

async function login(positionals: string[], flags: ParsedArgs['flags']): Promise<number> {
  const url = positionals[0] || process.env.LAZYLAB_URL;
  if (!url) throw new CliError('Usage: lazy login <url> [--token llab_…]', 2);
  const token = str(flags.token) || (await readSecret('Agent token (Vault → Agent tokens): '));
  if (!token.startsWith('llab_')) throw new CliError('Agent tokens start with llab_', 2);
  const config: CliConfig = { url: normalizeUrl(url), token };
  const tools = await new LazyClient(config).listTools();
  const path = saveConfig(config);
  out(`${paint('ok', `${UI.mark} Connected`)} to ${config.url} (${tools.length} tools). Saved to ${path}`);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const { positionals, flags, rest } = parseArgs(argv);
  if (flags.version) return out(VERSION), 0;
  const [command, sub, ...more] = positionals;
  if (flags.help || !command || command === 'help') return out(HELP), 0;
  if (command === 'login') return login(positionals.slice(1), flags);

  const config = loadConfig();
  if (!config) throw new CliError('Not connected. Run: lazy login <lazylab-url>');
  let project: string | null = null;
  const ctx: cmd.Ctx = {
    client: new LazyClient(config),
    json: Boolean(flags.json),
    project: () => (project ??= str(flags.project) || detectProject())
  };
  const intervalMs = (intArg(str(flags.interval), '--interval') ?? 5) * 1000;
  const notify = !flags['no-notify'];

  switch (command) {
    case 'inbox':
      return cmd.inbox(ctx, { refresh: Boolean(flags.refresh) });
    case 'ci':
      if (sub === 'watch') return cmd.ciWatch(ctx, { pipelineId: intArg(more[0], 'pipeline id'), ref: str(flags.ref), intervalMs, notify });
      if (sub) throw new CliError(`Unknown: lazy ci ${sub}. See lazy --help`, 2);
      return cmd.ciList(ctx, { ref: str(flags.ref), all: Boolean(flags.all) });
    case 'job':
      if (sub !== 'log') throw new CliError('Usage: lazy job log <job-id> | lazy job log --failed [pipeline-id]', 2);
      return flags.failed
        ? cmd.jobLog(ctx, { failed: true, pipelineId: intArg(more[0], 'pipeline id'), ref: str(flags.ref) })
        : cmd.jobLog(ctx, { failed: false, jobId: intArg(more[0], 'job id') });
    case 'retry': {
      const jobId = intArg(sub, 'job id');
      if (!jobId) throw new CliError('Usage: lazy retry <job-id> [--follow]', 2);
      return cmd.retry(ctx, { jobId, follow: Boolean(flags.follow), intervalMs });
    }
    case 'mr':
      if (sub !== 'create') throw new CliError('Usage: lazy mr create [--draft] [--target <branch>] [--title <t>] [--label a,b]', 2);
      return cmd.mrCreate(ctx, {
        title: str(flags.title),
        target: str(flags.target),
        draft: Boolean(flags.draft),
        labels: (str(flags.label) ?? '').split(',').map((l) => l.trim()).filter(Boolean),
        watch: Boolean(flags.watch)
      });
    case 'push':
      return cmd.push(ctx, {
        gitArgs: rest,
        detach: Boolean(flags.detach),
        notify,
        waitPipelineMs: (intArg(str(flags['wait-pipeline']), '--wait-pipeline') ?? 60) * 1000,
        intervalMs
      });
    case 'env':
      if (!sub || sub === 'list') return cmd.envList(ctx, envOptions(flags));
      if (sub === 'pull') return cmd.envPull(ctx, { ...envOptions(flags), out: str(flags.out) ?? '.env', force: Boolean(flags.force) });
      throw new CliError(`Unknown: lazy env ${sub}. See lazy --help`, 2);
    case 'run':
      if (positionals.length > 1) throw new CliError('Put the command after --: lazy run -- <command> [args…]', 2);
      return cmd.envRun(ctx, { ...envOptions(flags), command: rest });
    default:
      throw new CliError(`Unknown command "${command}". See lazy --help`, 2);
  }
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      resetTerminal();
      if (e instanceof CliError || e instanceof GitError) {
        err(paint('fail', `lazy: ${e.message}`));
        process.exit(e instanceof CliError ? e.exitCode : 1);
      }
      err(paint('fail', `lazy: unexpected error: ${e?.stack ?? e}`));
      process.exit(1);
    });
}
