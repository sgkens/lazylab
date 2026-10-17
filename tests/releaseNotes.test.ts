import { describe, expect, test } from 'bun:test';
import { buildReleaseNotes, nextVersion, parseCommit } from '../server/releaseNotes';

const c = (title: string, message?: string) => ({ short_id: title.slice(0, 7).replace(/\W/g, 'x'), title, message });

describe('parseCommit', () => {
  test('reads type, scope, breaking marker and subject', () => {
    expect(parseCommit(c('feat(cache)!: drop v1 keys'))).toMatchObject({ type: 'feat', scope: 'cache', breaking: true, subject: 'drop v1 keys' });
    expect(parseCommit(c('fix: handle 404'))).toMatchObject({ type: 'fix', scope: null, breaking: false });
    expect(parseCommit(c('Update README'))).toMatchObject({ type: null, subject: 'Update README' });
    expect(parseCommit(c('refactor: split client', 'refactor: split client\n\nBREAKING CHANGE: new import path')).breaking).toBe(true);
  });
});

describe('nextVersion', () => {
  test('bumps semver tags and keeps the v prefix', () => {
    expect(nextVersion('v1.4.2', 'patch')).toBe('v1.4.3');
    expect(nextVersion('v1.4.2', 'minor')).toBe('v1.5.0');
    expect(nextVersion('1.4.2', 'major')).toBe('2.0.0');
    expect(nextVersion('v0.3.1', 'major')).toBe('v0.4.0');
  });
  test('handles missing and non-semver tags', () => {
    expect(nextVersion(null, 'minor')).toBe('v0.1.0');
    expect(nextVersion('release-2024', 'patch')).toBeNull();
    expect(nextVersion('v1.0.0', null)).toBeNull();
  });
});

describe('buildReleaseNotes', () => {
  test('groups by type, lists breaking changes first and suggests the bump', () => {
    const notes = buildReleaseNotes(
      [
        c('feat(ui): add run pipeline form'),
        c('fix(api): reject empty refs'),
        c("Merge branch 'feature/x' into 'main'"),
        c('feat(mcp)!: rename tools'),
        c('docs: describe MCP'),
        c('Tidy things')
      ],
      'v1.2.0',
      'main'
    );
    const md = notes.markdown;
    expect(md.indexOf('### Breaking changes')).toBe(0);
    expect(md).toContain('### Features\n- **ui:** add run pipeline form');
    expect(md).toContain('### Fixes\n- **api:** reject empty refs');
    expect(md).toContain('### Documentation');
    expect(md).toContain('### Other changes\n- Tidy things');
    expect(md).not.toContain('Merge branch');
    expect(notes.bump).toBe('major');
    expect(notes.nextVersion).toBe('v2.0.0');
    expect(notes.commitCount).toBe(5);
  });

  test('fix-only ranges are a patch; empty ranges have no bump', () => {
    expect(buildReleaseNotes([c('fix: one')], 'v1.0.0', 'main').nextVersion).toBe('v1.0.1');
    const empty = buildReleaseNotes([], 'v1.0.0', 'v1.0.0');
    expect(empty.bump).toBeNull();
    expect(empty.markdown).toContain('No commits');
  });
});
