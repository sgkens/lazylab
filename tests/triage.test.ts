import { describe, expect, test } from 'bun:test';
import { cleanTrace, extractFailure, parseRunPipelineInput, summarizeFailure } from '../server/triage';

const S = (name: string, header: string, opts = '') => `\x1b[0Ksection_start:1700000000:${name}${opts}\r\x1b[0K${header}`;
const E = (name: string) => `\x1b[0Ksection_end:1700000001:${name}\r\x1b[0K`;

// Shape of a real GitLab runner trace for a failing script.
const failingTrace = [
  '\x1b[0KRunning with gitlab-runner 17.4.0 (5b91a70)\x1b[0;m',
  S('prepare_executor', '\x1b[0K\x1b[36;1mPreparing the "docker" executor\x1b[0;m'),
  'Using Docker executor with image node:22-alpine ...',
  E('prepare_executor'),
  S('get_sources', '\x1b[0K\x1b[36;1mGetting source from Git repository\x1b[0;m'),
  'Fetching changes with git depth set to 20...',
  'Receiving objects:  10% (1/10)\rReceiving objects: 100% (10/10), done.',
  E('get_sources'),
  S('step_script', '\x1b[0K\x1b[36;1mExecuting "step_script" stage of the job script\x1b[0;m'),
  '\x1b[32;1m$ bun test\x1b[0;m',
  'tests/a.test.ts:',
  '\x1b[32m✓\x1b[0m adds numbers',
  'tests/b.test.ts:',
  '\x1b[31m✗\x1b[0m parses config',
  'error: expect(received).toBe(expected)',
  '',
  ' 1 pass',
  ' 1 fail',
  E('step_script'),
  S('upload_artifacts_on_failure', '\x1b[0K\x1b[36;1mUploading artifacts for failed job\x1b[0;m'),
  'Uploading artifacts...',
  'WARNING: coverage/: no matching files. Ensure that the artifact path is relative to the working directory',
  'ERROR: No files to upload',
  E('upload_artifacts_on_failure'),
  S('cleanup_file_variables', '\x1b[0K\x1b[36;1mCleaning up project directory and file based variables\x1b[0;m'),
  E('cleanup_file_variables'),
  '',
  '\x1b[31;1mERROR: Job failed: exit code 1\x1b[0;m',
  ''
].join('\n');

describe('cleanTrace', () => {
  test('strips ANSI, section markers and carriage-return progress', () => {
    const { lines, headers } = cleanTrace(failingTrace);
    const texts = lines.map((l) => l.text);
    expect(texts).toContain('Receiving objects: 100% (10/10), done.');
    expect(texts.some((t) => t.includes('section_'))).toBe(false);
    expect(texts.some((t) => t.includes('\x1b'))).toBe(false);
    expect(headers.get('step_script')).toBe('Executing "step_script" stage of the job script');
  });

  test('tags lines with their innermost section', () => {
    const { lines } = cleanTrace(failingTrace);
    expect(lines.find((l) => l.text === '$ bun test')?.section).toBe('step_script');
    expect(lines.find((l) => l.text.startsWith('ERROR: Job failed'))?.section).toBeNull();
  });

  test('handles nested user sections', () => {
    const raw = [S('step_script', 'script'), S('install', 'Installing', '[collapsed=true]'), 'npm ci', E('install'), 'npm test', E('step_script')].join('\n');
    const { lines } = cleanTrace(raw);
    expect(lines.find((l) => l.text === 'npm ci')?.section).toBe('install');
    expect(lines.find((l) => l.text === 'npm test')?.section).toBe('step_script');
  });
});

describe('extractFailure', () => {
  test('excerpts the failing script section and skips upload boilerplate', () => {
    const f = extractFailure(failingTrace, { failureReason: 'script_failure' });
    expect(f.section).toBe('step_script');
    expect(f.sectionHeader).toContain('step_script');
    const texts = f.lines.map((l) => l.text);
    expect(texts[0]).toContain('step_script');
    expect(texts).toContain('error: expect(received).toBe(expected)');
    expect(texts.some((t) => t.includes('No files to upload'))).toBe(false);
    expect(texts[texts.length - 1]).toBe('ERROR: Job failed: exit code 1');
    expect(f.exitCode).toBe(1);
    expect(f.errorLine).toBe('error: expect(received).toBe(expected)');
    expect(f.failureHint).toContain('non-zero');
    expect(f.retryable).toBe(false);
  });

  test('highlights error lines and keeps original line numbers', () => {
    const f = extractFailure(failingTrace);
    const hl = f.lines.filter((l) => l.hl).map((l) => l.text);
    expect(hl).toContain('✗ parses config');
    expect(hl).toContain('error: expect(received).toBe(expected)');
    const { lines } = cleanTrace(failingTrace);
    const pick = f.lines.find((l) => l.text === '$ bun test')!;
    expect(lines[pick.n - 1].text).toBe('$ bun test');
  });

  test('caps the window at contextLines', () => {
    const body = Array.from({ length: 500 }, (_, i) => `line ${i}`);
    const raw = [S('step_script', 'script'), ...body, 'fatal: boom', E('step_script'), 'ERROR: Job failed: exit code 2'].join('\n');
    const f = extractFailure(raw, { contextLines: 10 });
    expect(f.lines).toHaveLength(11);
    expect(f.errorLine).toBe('fatal: boom');
    expect(f.exitCode).toBe(2);
  });

  test('works on traces without section markers', () => {
    const raw = ['$ go test ./...', '--- FAIL: TestX (0.01s)', 'FAIL    pkg 0.2s', 'ERROR: Job failed: exit code 1'].join('\n');
    const f = extractFailure(raw);
    expect(f.section).toBeNull();
    expect(f.errorLine).toBe('FAIL    pkg 0.2s');
  });

  test('marks infrastructure failures as retryable', () => {
    const f = extractFailure('ERROR: Job failed (system failure): prepare environment: exit status 1', {
      failureReason: 'runner_system_failure'
    });
    expect(f.retryable).toBe(true);
    expect(f.failureHint).toContain('runner');
  });

  test('describes unknown reasons and empty traces without throwing', () => {
    const f = extractFailure('', { failureReason: 'some_new_reason' });
    expect(f.lines).toHaveLength(0);
    expect(f.errorLine).toBeNull();
    expect(f.failureHint).toBe('GitLab reported some new reason.');
  });
});

describe('summarizeFailure', () => {
  test('prefers the error line and truncates long ones', () => {
    const f = extractFailure(['x'.repeat(400) + ' error', 'ERROR: Job failed: exit code 1'].join('\n'));
    const s = summarizeFailure('test:unit', f);
    expect(s.startsWith('test:unit: ')).toBe(true);
    expect(s.length).toBeLessThanOrEqual('test:unit: '.length + 160);
  });
});

describe('parseRunPipelineInput', () => {
  test('requires a ref', () => {
    expect(parseRunPipelineInput({})).toEqual({ error: 'ref is required' });
    expect(parseRunPipelineInput({ ref: '  ' })).toEqual({ error: 'ref is required' });
  });

  test('cleans variables and defaults watch to true', () => {
    const r = parseRunPipelineInput({
      ref: ' main ',
      variables: [{ key: ' DEPLOY_ENV ', value: 'staging' }, { key: '', value: 'x' }, { key: 'CFG', value: 1, variable_type: 'file' }]
    });
    expect(r).toEqual({
      ref: 'main',
      variables: [
        { key: 'DEPLOY_ENV', value: 'staging', variable_type: 'env_var' },
        { key: 'CFG', value: '1', variable_type: 'file' }
      ],
      watch: true
    });
  });

  test('rejects bad and duplicate keys', () => {
    expect('error' in parseRunPipelineInput({ ref: 'main', variables: [{ key: 'BAD-KEY', value: '' }] })).toBe(true);
    expect('error' in parseRunPipelineInput({ ref: 'main', variables: [{ key: 'A', value: '1' }, { key: 'A', value: '2' }] })).toBe(true);
  });

  test('honours watch: false', () => {
    const r = parseRunPipelineInput({ ref: 'main', watch: false });
    expect('error' in r ? null : r.watch).toBe(false);
  });
});
