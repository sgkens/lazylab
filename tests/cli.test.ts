import { describe, expect, test } from 'bun:test';
import { issueFromBranch, mrFromCommit, parseRemote } from '../cli/git.ts';
import { parseArgs } from '../cli/lazy.ts';
import { fit, table } from '../cli/ui.ts';
import { normalizeUrl } from '../cli/client.ts';

describe('parseRemote', () => {
  test('reads scp, ssh and https remotes with nested groups', () => {
    expect(parseRemote('git@gitlab.com:sgkens/lazylab.git')).toEqual({ host: 'gitlab.com', path: 'sgkens/lazylab' });
    expect(parseRemote('ssh://git@gitlab.example:2222/team/sub/app.git')).toEqual({ host: 'gitlab.example', path: 'team/sub/app' });
    expect(parseRemote('https://oauth2:glpat-x@gitlab.example/team/app')).toEqual({ host: 'gitlab.example', path: 'team/app' });
    expect(parseRemote('https://gitlab.example/team/app.git/')).toEqual({ host: 'gitlab.example', path: 'team/app' });
  });
  test('rejects remotes without a project path', () => {
    expect(parseRemote('/srv/git/app.git')).toBeNull();
    expect(parseRemote('file:///srv/git/team/app.git')).toBeNull();
    expect(parseRemote('git@gitlab.com:app.git')).toBeNull();
    expect(parseRemote('')).toBeNull();
  });
});

describe('issueFromBranch', () => {
  test('finds the issue number in common branch names', () => {
    expect(issueFromBranch('42-fix-login')).toBe(42);
    expect(issueFromBranch('feat/42-fix-login')).toBe(42);
    expect(issueFromBranch('release-2026')).toBeNull();
    expect(issueFromBranch('main')).toBeNull();
  });
});

describe('mrFromCommit', () => {
  test('uses the commit, adds Closes and the draft prefix', () => {
    expect(mrFromCommit({ subject: 'fix(auth): handle expiry', body: 'Details.', branch: '42-expiry', draft: true })).toEqual({
      title: 'Draft: fix(auth): handle expiry',
      description: 'Details.\n\nCloses #42'
    });
    expect(mrFromCommit({ subject: 's', body: 'Fixes #42', branch: '42-x' }).description).toBe('Fixes #42');
    expect(mrFromCommit({ subject: 's', body: '', branch: 'main', title: 'Custom' })).toEqual({ title: 'Custom', description: '' });
    expect(mrFromCommit({ subject: 'Draft: wip', body: '', branch: 'x', draft: true }).title).toBe('Draft: wip');
  });
});

describe('parseArgs', () => {
  test('separates positionals, value flags, boolean flags and pass-through args', () => {
    const a = parseArgs(['ci', 'watch', '123', '--project', 'team/app', '--json', '--interval=2']);
    expect(a.positionals).toEqual(['ci', 'watch', '123']);
    expect(a.flags).toEqual({ project: 'team/app', json: true, interval: '2' });
    expect(parseArgs(['push', '--detach', '--', '--force-with-lease']).rest).toEqual(['--force-with-lease']);
    expect(parseArgs(['-h']).flags.help).toBe(true);
    expect(() => parseArgs(['ci', '--ref'])).toThrow('--ref needs a value');
  });
});

describe('ui', () => {
  test('fit pads and truncates plain text', () => {
    expect(fit('abc', 5)).toBe('abc  ');
    expect(fit('abcdef', 4)).toBe('abc…');
  });
  test('table aligns columns on plain text', () => {
    const lines = table([
      [{ text: 'a' }, { text: 'one' }],
      [{ text: 'long' }, { text: 'two' }]
    ]);
    expect(lines).toEqual(['a     one', 'long  two']);
  });
  test('normalizeUrl strips slashes and a pasted /mcp suffix', () => {
    expect(normalizeUrl('https://lazylab.example/mcp/')).toBe('https://lazylab.example');
  });
});
