/**
 * Release notes from Conventional Commits: groups the commits between two refs by type and
 * suggests the next semantic version. Pure, so it is unit tested without GitLab.
 */

export interface CommitLike {
  short_id: string;
  title: string;
  message?: string;
  author_name?: string;
}

export interface ReleaseNotes {
  from: string | null;
  to: string;
  markdown: string;
  bump: 'major' | 'minor' | 'patch' | null;
  nextVersion: string | null;
  commitCount: number;
}

const HEADER_RE = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

const SECTIONS: { title: string; types: string[] }[] = [
  { title: 'Features', types: ['feat'] },
  { title: 'Fixes', types: ['fix'] },
  { title: 'Performance', types: ['perf'] },
  { title: 'Refactoring', types: ['refactor'] },
  { title: 'Documentation', types: ['docs'] },
  { title: 'Build and CI', types: ['build', 'ci'] },
  { title: 'Tests', types: ['test'] },
  { title: 'Chores', types: ['chore', 'style'] }
];

interface Parsed {
  type: string | null;
  scope: string | null;
  breaking: boolean;
  subject: string;
  short_id: string;
}

export function parseCommit(c: CommitLike): Parsed {
  const m = HEADER_RE.exec(c.title.trim());
  const breakingFooter = /^BREAKING[ -]CHANGE:/m.test(c.message || '');
  if (!m) return { type: null, scope: null, breaking: breakingFooter, subject: c.title.trim(), short_id: c.short_id };
  return { type: m[1].toLowerCase(), scope: m[2] || null, breaking: Boolean(m[3]) || breakingFooter, subject: m[4].trim(), short_id: c.short_id };
}

/** Next version for a vX.Y.Z / X.Y.Z tag; null when the tag is not semver. Pre-1.0 majors bump the minor. */
export function nextVersion(tag: string | null, bump: ReleaseNotes['bump']): string | null {
  if (!bump) return null;
  if (!tag) return bump === 'major' ? 'v1.0.0' : 'v0.1.0';
  const m = /^(v?)(\d+)\.(\d+)\.(\d+)/.exec(tag);
  if (!m) return null;
  const [prefix, ma, mi, pa] = [m[1], Number(m[2]), Number(m[3]), Number(m[4])];
  if (bump === 'major') return ma === 0 ? `${prefix}0.${mi + 1}.0` : `${prefix}${ma + 1}.0.0`;
  if (bump === 'minor') return `${prefix}${ma}.${mi + 1}.0`;
  return `${prefix}${ma}.${mi}.${pa + 1}`;
}

export function buildReleaseNotes(commits: CommitLike[], from: string | null, to: string): ReleaseNotes {
  const parsed = commits.filter((c) => !/^Merge (branch|remote-tracking branch|pull request) /.test(c.title)).map(parseCommit);
  const line = (p: Parsed) => `- ${p.scope ? `**${p.scope}:** ` : ''}${p.subject} (${p.short_id})`;

  const out: string[] = [];
  const breaking = parsed.filter((p) => p.breaking);
  if (breaking.length) out.push('### Breaking changes', ...breaking.map(line), '');
  for (const section of SECTIONS) {
    const items = parsed.filter((p) => p.type && section.types.includes(p.type));
    if (items.length) out.push(`### ${section.title}`, ...items.map(line), '');
  }
  const known = new Set(SECTIONS.flatMap((s) => s.types));
  const other = parsed.filter((p) => !p.type || !known.has(p.type));
  if (other.length) out.push('### Other changes', ...other.map(line), '');
  if (!parsed.length) out.push(`No commits between ${from ?? 'the first commit'} and ${to}.`);

  const bump: ReleaseNotes['bump'] = breaking.length
    ? 'major'
    : parsed.some((p) => p.type === 'feat')
      ? 'minor'
      : parsed.length
        ? 'patch'
        : null;

  if (from) out.push(`Changes since ${from}.`);
  return { from, to, markdown: out.join('\n').trim(), bump, nextVersion: nextVersion(from, bump), commitCount: parsed.length };
}
