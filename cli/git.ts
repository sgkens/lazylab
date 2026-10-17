/**
 * Git facts for `lazy`: which GitLab project the current directory belongs to, the branch, HEAD,
 * and the last commit. Parsing is pure and unit tested; git itself is called through `git()`.
 */

export interface RemoteRef {
  host: string;
  /** Project path such as "group/subgroup/project". */
  path: string;
}

/**
 * Accepts the remote URL shapes git uses:
 * git@host:group/proj.git, ssh://git@host:2222/group/proj.git, https://user:token@host/group/proj.git
 */
export function parseRemote(url: string): RemoteRef | null {
  const raw = url.trim();
  if (!raw) return null;
  let host: string;
  let path: string;
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(raw);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return null;
    }
    if (u.protocol === 'file:') return null;
    host = u.hostname;
    path = decodeURIComponent(u.pathname);
  } else if (scp) {
    host = scp[1];
    path = scp[2];
  } else {
    return null;
  }
  path = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  if (!path.includes('/')) return null;
  return { host, path };
}

/** Issue number from branch names such as "42-fix-login" or "feat/42-fix-login". */
export function issueFromBranch(branch: string): number | null {
  const m = /(?:^|\/)(\d+)-[\w.-]+$/.exec(branch);
  return m ? Number(m[1]) : null;
}

/** Title and description for an MR from the last commit and the branch name. */
export function mrFromCommit(input: { subject: string; body: string; branch: string; draft?: boolean; title?: string }): { title: string; description: string } {
  const base = (input.title ?? input.subject).trim() || input.branch;
  const title = input.draft && !/^draft:/i.test(base) ? `Draft: ${base}` : base;
  const parts: string[] = [];
  if (input.body.trim()) parts.push(input.body.trim());
  const issue = issueFromBranch(input.branch);
  if (issue && !new RegExp(`#${issue}\\b`).test(input.body)) parts.push(`Closes #${issue}`);
  return { title, description: parts.join('\n\n') };
}

export class GitError extends Error {}

/** Runs git and returns trimmed stdout; throws GitError with git's message on failure. */
export function git(args: string[], cwd = process.cwd()): string {
  const res = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (res.exitCode !== 0) {
    const msg = res.stderr.toString().trim() || `git ${args.join(' ')} exited with ${res.exitCode}`;
    throw new GitError(msg);
  }
  return res.stdout.toString().trim();
}

export function tryGit(args: string[], cwd?: string): string | null {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

export function currentBranch(): string {
  const branch = tryGit(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!branch) throw new GitError('Not on a branch (detached HEAD or not a git repository)');
  return branch;
}

export const headSha = () => git(['rev-parse', 'HEAD']);

export function lastCommit(): { subject: string; body: string } {
  return { subject: git(['log', '-1', '--format=%s']), body: git(['log', '-1', '--format=%b']) };
}

export const upstreamOf = (branch: string) => tryGit(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]);

/**
 * The remote the branch is pushed to under its own name, or null. A branch created from
 * origin/main tracks origin/main, which does not mean the branch itself exists on the remote.
 */
export function pushedRemote(branch: string): string | null {
  const upstream = upstreamOf(branch);
  if (!upstream) return null;
  const slash = upstream.indexOf('/');
  return slash > 0 && upstream.slice(slash + 1) === branch ? upstream.slice(0, slash) : null;
}

/**
 * The GitLab project for this checkout: `git config lazylab.project` when set, else the path of
 * the `origin` remote (or `lazylab.remote`).
 */
export function detectProject(): string {
  const configured = tryGit(['config', '--get', 'lazylab.project']);
  if (configured) return configured;
  const remoteName = tryGit(['config', '--get', 'lazylab.remote']) || 'origin';
  const url = tryGit(['remote', 'get-url', remoteName]);
  if (!url) throw new GitError(`No "${remoteName}" remote here. Pass --project <group/project> or run: git config lazylab.project <group/project>`);
  const ref = parseRemote(url);
  if (!ref) throw new GitError(`Cannot read a GitLab project path from ${remoteName} (${url}). Run: git config lazylab.project <group/project>`);
  return ref.path;
}
