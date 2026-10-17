#!/usr/bin/env bun
/**
 * lazy: lazylab from the terminal. Talks to lazylab's MCP endpoint with an agent token and finds
 * the GitLab project from the current git checkout.
 */
import { CliConfig, CliError, configPath, LazyClient, loadConfig, normalizeUrl, saveConfig } from './client.js';
import * as cmd from './commands.js';
import { detectProject, GitError } from './git.js';
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

Options:
  --project <path|id>   GitLab project (default: git config lazylab.project, else the origin remote)
  --json                Print the raw result as JSON
  --no-notify           Do not ask lazylab to watch the pipeline (ci watch, push)
  --interval <s>        Poll interval while following (default 5)
  -h, --help            Show this help
  -v, --version         Show the version

Environment: LAZYLAB_URL and LAZYLAB_TOKEN override ${configPath()}
Exit codes: 0 done or pipeline passed, 1 error or pipeline failed, 2 usage error, 130 interrupted`;

const BOOLEAN_FLAGS = new Set(['json', 'refresh', 'all', 'failed', 'follow', 'draft', 'watch', 'detach', 'no-notify', 'help', 'version']);
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
      if (BOOLEAN_FLAGS.has(name)) flags[name] = true;
      else if (inline !== undefined) flags[name] = inline;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) flags[name] = argv[++i];
      else throw new CliError(`--${name} needs a value`, 2);
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
