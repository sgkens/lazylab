/**
 * `lazy` commands. Each takes parsed options and a client, prints for humans (or JSON with --json),
 * and returns the process exit code.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { CliError, LazyClient } from './client.js';
import { describeSource, dotenvCaveats, EnvVar, HEADER_MARK, renderDotenv } from './env.js';
import { currentBranch, headSha, lastCommit, mrFromCommit, pushedRemote, tryGit } from './git.js';
import { Cell, duration, err, out, paint, relativeTime, statusCell, table, toneFor, UI } from './ui.js';

export interface Ctx {
  client: LazyClient;
  /** Resolved lazily: commands that do not need a project work outside a checkout. */
  project: () => string;
  json: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const printJson = (data: unknown) => out(JSON.stringify(data, null, 2));

/** Pipeline states after which nothing more happens without user action. */
export const FINISHED = new Set(['success', 'failed', 'canceled', 'skipped', 'manual']);

// ---- inbox ----------------------------------------------------------------------

const BUCKETS: [string, string][] = [
  ['action', 'Needs your action'],
  ['waiting', 'Waiting on others'],
  ['assigned', 'Assigned']
];

export async function inbox(ctx: Ctx, opts: { refresh: boolean }): Promise<number> {
  const data = await ctx.client.call<any>('get_inbox', { refresh: opts.refresh });
  if (ctx.json) return printJson(data), 0;
  for (const [bucket, label] of BUCKETS) {
    const items = data.items.filter((i: any) => i.bucket === bucket);
    out(paint('bold', `${label} (${items.length})`));
    const rows: Cell[][] = items.map((i: any) => [
      { text: `${UI.mark} ${i.reason}`, tone: bucket === 'action' ? 'warn' : 'dim' },
      { text: i.reference, tone: 'info' },
      { text: i.title, flex: true },
      i.pipeline ? statusCell(i.pipeline.status) : { text: '' }
    ]);
    for (const line of table(rows)) out(`  ${line}`);
    out();
  }
  for (const e of data.errors ?? []) out(paint('warn', `Could not read ${e}`));
  return 0;
}

// ---- pipelines --------------------------------------------------------------------

export async function ciList(ctx: Ctx, opts: { ref?: string; all: boolean }): Promise<number> {
  const ref = opts.all ? undefined : (opts.ref ?? currentBranch());
  const pipelines = await ctx.client.call<any[]>('list_pipelines', { project: ctx.project(), ...(ref ? { ref } : {}) });
  if (ctx.json) return printJson(pipelines), 0;
  if (pipelines.length === 0) {
    out(paint('dim', `No pipelines${ref ? ` for ${ref}` : ''} in ${ctx.project()}.`));
    return 0;
  }
  const rows: Cell[][] = pipelines.slice(0, 10).map((p) => [
    statusCell(p.status),
    { text: `#${p.id}` },
    { text: p.ref, flex: true },
    { text: p.sha ?? '', tone: 'dim' },
    { text: relativeTime(p.created_at), tone: 'dim' }
  ]);
  for (const line of table(rows)) out(line);
  return 0;
}

/** Latest pipeline for the ref, optionally only failed ones. */
async function latestPipeline(ctx: Ctx, ref: string, failedOnly = false): Promise<any> {
  const pipelines = await ctx.client.call<any[]>('list_pipelines', { project: ctx.project(), ref });
  const p = pipelines.find((x) => !failedOnly || x.status === 'failed');
  if (!p) throw new CliError(`No ${failedOnly ? 'failed ' : ''}pipeline for ${ref} in ${ctx.project()}`);
  return p;
}

/**
 * Prints job transitions until the pipeline finishes, then the failures if it failed.
 * Returns 0 for success (or manual/skipped), 1 for failed or canceled.
 */
export async function follow(ctx: Ctx, pipelineId: number, opts: { intervalMs: number; watched: boolean }): Promise<number> {
  const project = ctx.project();
  let first = true;
  const seen = new Map<number, string>();
  let lastStatus = '';
  let interrupted = false;
  const onSigint = () => {
    interrupted = true;
  };
  process.once('SIGINT', onSigint);
  try {
    for (;;) {
      const p = await ctx.client.call<any>('get_pipeline', { project, pipeline_id: pipelineId });
      if (first) {
        out(`${paint('bold', `${UI.arrow} Pipeline #${p.id}`)} ${UI.sep} ${p.ref} ${UI.sep} ${paint('dim', p.web_url)}`);
        first = false;
      }
      for (const j of p.jobs as any[]) {
        const before = seen.get(j.id);
        if (before === j.status) continue;
        seen.set(j.id, j.status);
        // Report starts and ends; queued states are noise.
        if (j.status === 'running' || FINISHED.has(j.status)) {
          const suffix = FINISHED.has(j.status) && j.duration ? ` ${paint('dim', duration(j.duration))}` : '';
          const allowed = j.status === 'failed' && j.allow_failure ? paint('dim', ' (allowed to fail)') : '';
          out(`  ${paint(toneFor(j.status), `${UI.mark} ${j.status.padEnd(8)}`)} ${j.stage}/${j.name}${suffix}${allowed}`);
        }
      }
      if (p.status !== lastStatus && !FINISHED.has(p.status) && lastStatus) out(paint('dim', `  pipeline ${p.status}`));
      lastStatus = p.status;
      if (FINISHED.has(p.status)) {
        out();
        out(paint(toneFor(p.status), `${UI.mark} Pipeline #${p.id} ${p.status}`) + (p.duration ? paint('dim', ` in ${duration(p.duration)}`) : ''));
        if (p.status === 'failed') await printFailures(ctx, pipelineId);
        if (p.status === 'manual') out(paint('dim', 'Waiting for a manual job: start it in GitLab or lazylab.'));
        return p.status === 'failed' || p.status === 'canceled' ? 1 : 0;
      }
      for (let waited = 0; waited < opts.intervalMs && !interrupted; waited += 250) await sleep(250);
      if (interrupted) {
        out();
        out(paint('dim', opts.watched ? 'Stopped following. lazylab still watches it and will notify you.' : 'Stopped following.'));
        return 130;
      }
    }
  } finally {
    process.off('SIGINT', onSigint);
  }
}

async function printFailures(ctx: Ctx, pipelineId: number) {
  const failures = await ctx.client.call<any[]>('get_pipeline_failures', { project: ctx.project(), pipeline_id: pipelineId });
  for (const f of failures) printFailure(f, f.job ?? f.job_name, f.job_id);
}

function printFailure(f: any, name: string, jobId?: number) {
  out();
  const reason = [f.failure_reason, f.exit_code !== null && f.exit_code !== undefined ? `exit ${f.exit_code}` : ''].filter(Boolean).join(', ');
  out(`${paint('fail', `${UI.item} ${f.stage ? `${f.stage}/` : ''}${name}`)}${reason ? paint('dim', ` (${reason})`) : ''}`);
  if (f.error_line) out(`  ${paint('bold', f.error_line)}`);
  const lines = String(f.log ?? '').split('\n').filter(Boolean).slice(-15);
  for (const l of lines) out(paint('dim', `  ${UI.rule} ${l}`));
  if (f.retryable) out(paint('warn', '  Likely passes on retry (infrastructure failure).'));
  if (jobId) out(paint('dim', `  Retry: lazy retry ${jobId}    Full log: ${f.web_url ?? ''}`));
}

export async function ciWatch(ctx: Ctx, opts: { pipelineId?: number; ref?: string; intervalMs: number; notify: boolean }): Promise<number> {
  const id = opts.pipelineId ?? (await latestPipeline(ctx, opts.ref ?? currentBranch())).id;
  // Check the pipeline exists before asking lazylab to watch it, so a wrong id fails once and clearly.
  await ctx.client.call('get_pipeline', { project: ctx.project(), pipeline_id: id });
  const watched = opts.notify ? await addWatch(ctx, 'pipeline', id) : false;
  return follow(ctx, id, { intervalMs: opts.intervalMs, watched });
}

async function addWatch(ctx: Ctx, kind: 'pipeline' | 'job' | 'merge_request', id: number): Promise<boolean> {
  try {
    await ctx.client.call('watch', { project: ctx.project(), kind, target_id: id });
    return true;
  } catch (e: any) {
    out(paint('warn', `Not watched in lazylab: ${e.message}`));
    return false;
  }
}

// ---- jobs ---------------------------------------------------------------------------

export async function jobLog(ctx: Ctx, opts: { jobId?: number; failed: boolean; pipelineId?: number; ref?: string }): Promise<number> {
  if (opts.jobId) {
    const f = await ctx.client.call<any>('get_job_failure', { project: ctx.project(), job_id: opts.jobId });
    if (ctx.json) return printJson(f), 0;
    if (f.status !== 'failed') out(paint('dim', `Job ${opts.jobId} is ${f.status}; showing the end of its log.`));
    printFailure(f, f.job, opts.jobId);
    return 0;
  }
  if (!opts.failed) throw new CliError('Usage: lazy job log <job-id> | lazy job log --failed [pipeline-id]', 2);
  const id = opts.pipelineId ?? (await latestPipeline(ctx, opts.ref ?? currentBranch(), true)).id;
  const failures = await ctx.client.call<any[]>('get_pipeline_failures', { project: ctx.project(), pipeline_id: id });
  if (ctx.json) return printJson(failures), 0;
  if (failures.length === 0) {
    out(paint('dim', `Pipeline #${id} has no failed jobs (allowed failures are left out).`));
    return 0;
  }
  out(paint('bold', `${UI.arrow} Pipeline #${id}: ${failures.length} failed job${failures.length === 1 ? '' : 's'}`));
  for (const f of failures) printFailure(f, f.job, f.job_id);
  return 0;
}

export async function retry(ctx: Ctx, opts: { jobId: number; follow: boolean; intervalMs: number }): Promise<number> {
  const job = await ctx.client.call<any>('retry_job', { project: ctx.project(), job_id: opts.jobId });
  if (ctx.json) return printJson(job), 0;
  out(`${paint('info', `${UI.arrow} Retried job ${opts.jobId}`)} ${UI.sep} new job #${job.id} ${job.status}${job.watched ? paint('dim', ' (watched)') : ''}`);
  if (!opts.follow) return 0;
  const pipelineId = job.pipeline_id;
  if (!pipelineId) return 0;
  return follow(ctx, pipelineId, { intervalMs: opts.intervalMs, watched: Boolean(job.watched) });
}

// ---- merge requests --------------------------------------------------------------------

export async function mrCreate(ctx: Ctx, opts: { title?: string; target?: string; draft: boolean; labels: string[]; watch: boolean }): Promise<number> {
  const branch = currentBranch();
  if (!pushedRemote(branch)) throw new CliError(`${branch} is not pushed under its own name. Push it first: lazy push`);
  const { subject, body } = lastCommit();
  const { title, description } = mrFromCommit({ subject, body, branch, draft: opts.draft, title: opts.title });
  const mr = await ctx.client.call<any>('create_merge_request', {
    project: ctx.project(),
    title,
    source_branch: branch,
    ...(opts.target ? { target_branch: opts.target } : {}),
    description,
    labels: opts.labels
  });
  if (opts.watch) await addWatch(ctx, 'merge_request', mr.iid);
  if (ctx.json) return printJson(mr), 0;
  out(`${paint('ok', `${UI.mark} !${mr.iid}`)} ${mr.title} ${UI.sep} ${mr.source_branch} → ${mr.target_branch}`);
  out(paint('dim', mr.web_url));
  return 0;
}

// ---- push --------------------------------------------------------------------------------

/**
 * git push, then find the pipeline GitLab created for HEAD, ask lazylab to watch it (so the phone
 * gets the result), and follow it here unless --detach.
 */
export async function push(
  ctx: Ctx,
  opts: { gitArgs: string[]; detach: boolean; notify: boolean; waitPipelineMs: number; intervalMs: number }
): Promise<number> {
  const branch = currentBranch();
  // Without arguments: push the branch to its own name, setting the upstream on first push.
  const remote = pushedRemote(branch) || tryGit(['config', '--get', 'lazylab.remote']) || 'origin';
  const args = opts.gitArgs.length ? opts.gitArgs : pushedRemote(branch) ? [] : ['-u', remote, branch];
  const proc = Bun.spawn(['git', 'push', ...args], { stdio: ['inherit', 'inherit', 'inherit'] });
  const code = await proc.exited;
  if (code !== 0) return code;

  const sha = headSha();
  const short = sha.slice(0, 8);
  const project = ctx.project();
  out(paint('dim', `Waiting for the pipeline of ${short} on ${branch}…`));
  const deadline = Date.now() + opts.waitPipelineMs;
  let pipeline: any = null;
  while (!pipeline) {
    const list = await ctx.client.call<any[]>('list_pipelines', { project, ref: branch });
    pipeline = list.find((p) => p.sha && sha.startsWith(p.sha));
    if (pipeline) break;
    if (Date.now() >= deadline) {
      out(paint('warn', `No pipeline for ${short} after ${Math.round(opts.waitPipelineMs / 1000)} s.`));
      out(paint('dim', 'The project may have no .gitlab-ci.yml, or its rules skip this push. Check with: lazy ci'));
      return 0;
    }
    await sleep(Math.min(3000, opts.intervalMs));
  }

  const watched = opts.notify ? await addWatch(ctx, 'pipeline', pipeline.id) : false;
  if (opts.detach) {
    out(`${paint('info', `${UI.arrow} Pipeline #${pipeline.id}`)} ${pipeline.status}${watched ? paint('dim', ' · lazylab will notify you when it finishes') : ''}`);
    out(paint('dim', pipeline.web_url));
    return 0;
  }
  return follow(ctx, pipeline.id, { intervalMs: opts.intervalMs, watched });
}

// ---- environment (ENV-1, ENV-2) --------------------------------------------------------

export interface EnvOpts {
  environment: string | null;
  secrets: { name: string; key?: string }[];
}

interface EnvResult {
  project: string;
  environment: string | null;
  variables: EnvVar[];
  errors: string[];
}

const fetchEnv = (ctx: Ctx, opts: EnvOpts) =>
  ctx.client.call<EnvResult>('get_env', {
    project: ctx.project(),
    ...(opts.environment ? { environment: opts.environment } : {}),
    ...(opts.secrets.length ? { secrets: opts.secrets } : {})
  });

function warnEnv(env: EnvResult, print: (line: string) => void) {
  for (const e of env.errors) print(paint('warn', `Skipped ${e}`));
  for (const v of env.variables.filter((x) => x.value === null)) print(paint('warn', `${UI.mark} ${v.key} has no value: ${v.missing}`));
}

/** `lazy env`: which variables apply and where each comes from. Values are not printed. */
export async function envList(ctx: Ctx, opts: EnvOpts): Promise<number> {
  const env = await fetchEnv(ctx, opts);
  if (ctx.json) return printJson({ ...env, variables: env.variables.map(({ value, ...v }) => ({ ...v, has_value: value !== null })) }), 0;
  out(`${paint('bold', `${UI.arrow} ${env.project}`)} ${UI.sep} environment ${env.environment ?? paint('dim', 'none (only * scoped variables)')}`);
  if (env.variables.length === 0) out(paint('dim', 'No variables apply.'));
  const rows: Cell[][] = env.variables.map((v) => [
    { text: v.key, tone: v.value === null ? 'fail' : undefined },
    { text: v.variable_type === 'file' ? 'file' : '', tone: 'dim' },
    { text: [v.protected ? 'protected' : '', v.masked ? 'masked' : ''].filter(Boolean).join(' '), tone: 'dim' },
    { text: describeSource(v), flex: true, tone: 'dim' }
  ]);
  for (const line of table(rows)) out(`  ${line}`);
  warnEnv(env, out);
  return 0;
}

/** Ignored by git, or not in a git work tree at all. */
function gitIgnores(file: string): boolean {
  const res = Bun.spawnSync(['git', 'check-ignore', '-q', file], { stdout: 'ignore', stderr: 'ignore' });
  return res.exitCode !== 1;
}

function requireIgnored(file: string) {
  if (gitIgnores(file)) return;
  const shown = path.relative(process.cwd(), file) || file;
  throw new CliError(`${shown} is not ignored by git and would hold secrets. Add it to .gitignore, or pass --force.`);
}

/** `lazy env pull`: write the variables to a .env file (mode 600); file variables go to <out>.d/. */
export async function envPull(ctx: Ctx, opts: EnvOpts & { out: string; force: boolean }): Promise<number> {
  const file = path.resolve(opts.out);
  const filesDir = `${file}.d`;
  if (!opts.force) {
    if (existsSync(file) && !readFileSync(file, 'utf8').startsWith(HEADER_MARK)) {
      throw new CliError(`${opts.out} exists and was not written by lazy. Pass --force to replace it.`);
    }
    requireIgnored(file);
  }
  const env = await fetchEnv(ctx, opts);
  const filePaths = new Map<string, string>();
  const fileVars = env.variables.filter((v) => v.variable_type === 'file' && v.value !== null);
  if (fileVars.length) {
    if (!opts.force) requireIgnored(path.join(filesDir, fileVars[0].key));
    mkdirSync(filesDir, { recursive: true, mode: 0o700 });
    for (const v of fileVars) {
      const p = path.join(filesDir, v.key);
      writeFileSync(p, v.value!, { mode: 0o600 });
      chmodSync(p, 0o600);
      filePaths.set(v.key, p);
    }
  }
  writeFileSync(file, renderDotenv(env.variables, { project: env.project, environment: env.environment, at: new Date() }, filePaths), { mode: 0o600 });
  chmodSync(file, 0o600); // an existing file keeps its mode on write
  if (ctx.json) return printJson({ file, files: Object.fromEntries(filePaths), keys: env.variables.map((v) => v.key), errors: env.errors }), 0;
  const written = env.variables.filter((v) => v.value !== null).length;
  out(`${paint('ok', `${UI.mark} Wrote ${written} variable${written === 1 ? '' : 's'}`)} to ${opts.out}${fileVars.length ? ` (${fileVars.length} file${fileVars.length === 1 ? '' : 's'} in ${path.relative(process.cwd(), filesDir)})` : ''}`);
  warnEnv(env, out);
  const caveats = dotenvCaveats(env.variables);
  if (caveats.dollar.length) out(paint('dim', `Contains $: ${caveats.dollar.join(', ')}. Bun's .env loader expands $NAME even in single quotes; use lazy run for exact values.`));
  if (caveats.escaped.length) out(paint('dim', `Has both quote kinds: ${caveats.escaped.join(', ')}. Written with escapes that some loaders keep literally; use lazy run for exact values.`));
  return 0;
}

/**
 * `lazy run -- <cmd>`: run a command with the variables in its environment, nothing written to the
 * project. File variables go to a private temporary directory that is removed afterwards.
 */
export async function envRun(ctx: Ctx, opts: EnvOpts & { command: string[] }): Promise<number> {
  if (opts.command.length === 0) throw new CliError('Usage: lazy run [--env <name>] [--secret …] -- <command> [args…]', 2);
  const env = await fetchEnv(ctx, opts);
  warnEnv(env, err);
  const childEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
  let tmp: string | null = null;
  for (const v of env.variables) {
    if (v.value === null) continue;
    if (v.variable_type === 'file') {
      tmp ??= mkdtempSync(path.join(tmpdir(), 'lazy-run-'));
      const p = path.join(tmp, v.key);
      writeFileSync(p, v.value, { mode: 0o600 });
      childEnv[v.key] = p;
    } else {
      childEnv[v.key] = v.value;
    }
  }
  // Ctrl+C reaches the child through the terminal; stay alive to clean up and pass on its exit code.
  const ignore = () => {};
  process.on('SIGINT', ignore);
  process.on('SIGTERM', ignore);
  try {
    let proc;
    try {
      proc = Bun.spawn(opts.command, { env: childEnv, stdio: ['inherit', 'inherit', 'inherit'] });
    } catch (e: any) {
      throw new CliError(`Cannot run ${opts.command[0]}: ${e?.message ?? e}`);
    }
    const code = await proc.exited;
    return proc.signalCode ? 128 + (signalNumbers[proc.signalCode] ?? 0) : code;
  } finally {
    process.off('SIGINT', ignore);
    process.off('SIGTERM', ignore);
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

const signalNumbers: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 };
