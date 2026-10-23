import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import express from 'express';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { Server } from 'http';
import { GitLabClient } from '../server/gitlabClient.ts';
import { createMcpRouter, handleMessage } from '../server/mcp.ts';
import { exportFileNames, migrationDescription, Note, noteToMarkdown, parseNoteFilter, parseNoteInput, resolveNoteId, slugify } from '../server/notes.ts';
import { createNotesRouter, exportNotesZip, migrateNote, parseMigrateOptions } from '../server/notesRouter.ts';
import { apiGuard, sessionRouter } from '../server/session.ts';
import { vault } from '../server/vault.ts';
import { crc32, createZip } from '../server/zip.ts';
import { renderNoteRows } from '../cli/notes.ts';

const USER = 'tester';
const PASSWORD = 'correct horse battery';
const demo = new GitLabClient();

beforeAll(async () => {
  if (!vault.isInitialized()) await vault.initialize(USER, PASSWORD);
});

const scratch = (prefix: string) => mkdtempSync(path.join(tmpdir(), prefix));

/** Runs a script in a fresh Bun process against its own data directory. */
function runIsolated(dir: string, script: string) {
  const result = Bun.spawnSync([process.execPath, '--eval', script], { env: { ...process.env, LAZYLAB_DATA_DIR: dir } });
  return { exit: result.exitCode, stdout: result.stdout.toString().trim(), stderr: result.stderr.toString() };
}

describe('note validation', () => {
  test('requires a title on create and rejects server-owned or unknown fields', () => {
    expect(parseNoteInput({ title: '  Fix   the cache  ' }, false)).toEqual({ title: 'Fix the cache' });
    expect(() => parseNoteInput({}, false)).toThrow('title');
    expect(() => parseNoteInput({ title: ' ' }, false)).toThrow('title');
    expect(() => parseNoteInput({ title: 'x'.repeat(201) }, false)).toThrow('title');
    expect(() => parseNoteInput({ title: 'x', id: 'forged' }, false)).toThrow('unknown note field "id"');
    expect(() => parseNoteInput({ title: 'x', comments: [] }, false)).toThrow('unknown note field');
    expect(() => parseNoteInput({ title: 'x', migrated: {} }, false)).toThrow('unknown note field');
    expect(() => parseNoteInput([], false)).toThrow('object');
    expect(() => parseNoteInput(null, true)).toThrow('object');
  });

  test('checks kind, status, body size, tags and the project link', () => {
    expect(() => parseNoteInput({ title: 'x', kind: 'issue' }, false)).toThrow('kind');
    expect(() => parseNoteInput({ status: 'migrated' }, true)).toThrow('migrate action');
    expect(() => parseNoteInput({ status: 'closed' }, true)).toThrow('status');
    expect(() => parseNoteInput({ body: 'x'.repeat(50_001) }, true)).toThrow('body');
    expect(() => parseNoteInput({ body: 42 }, true)).toThrow('body');
    expect(parseNoteInput({ tags: ['CI', '#ci', 'follow-up', 'area/api'] }, true).tags).toEqual(['ci', 'follow-up', 'area/api']);
    expect(() => parseNoteInput({ tags: ['has space'] }, true)).toThrow('tags');
    expect(() => parseNoteInput({ tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }, true)).toThrow('20');
    expect(() => parseNoteInput({ tags: 'ci' }, true)).toThrow('array');
    expect(parseNoteInput({ project: { project_id: 9, name: 'team/app' } }, true).project).toEqual({ project_id: 9, name: 'team/app' });
    expect(parseNoteInput({ project: null }, true).project).toBeNull();
    expect(() => parseNoteInput({ project: { project_id: -1 } }, true)).toThrow('project_id');
    expect(() => parseNoteInput({ project: { project_id: 9, host: 'x' } }, true)).toThrow('project');
    expect(() => parseNoteInput({}, true)).toThrow('nothing to update');
  });

  test('parses list filters and migrate options strictly', () => {
    expect(parseNoteFilter({ kind: 'task', status: 'open', tag: '#CI', q: ' Cache ' })).toEqual({ kind: 'task', status: 'open', tag: 'ci', q: 'cache' });
    expect(parseNoteFilter({ kind: '' })).toEqual({});
    expect(() => parseNoteFilter({ kind: 'issue' })).toThrow('kind');
    expect(() => parseNoteFilter({ status: ['open', 'done'] })).toThrow('once');
    expect(parseMigrateOptions({ project_id: '901', mode: 'mark' })).toEqual({ project_id: 901, mode: 'mark' });
    expect(() => parseMigrateOptions({ project_id: 901, mode: 'move' })).toThrow('mode');
    expect(() => parseMigrateOptions({ project_id: 0, mode: 'mark' })).toThrow('project_id');
    expect(() => parseMigrateOptions({ project_id: 1, mode: 'mark', web_url: 'x' })).toThrow('unknown');
  });

  test('resolves full ids and unique prefixes of at least 6 characters', () => {
    const notes = [{ id: 'abcdef12-0000' }, { id: 'abcdef34-0000' }, { id: '99887766-0000' }];
    expect(resolveNoteId(notes, '99887766-0000')).toBe('99887766-0000');
    expect(resolveNoteId(notes, '998877')).toBe('99887766-0000');
    expect(() => resolveNoteId(notes, 'abcdef')).toThrow('ambiguous');
    expect(() => resolveNoteId(notes, '9988')).toThrow('not found');
    expect(() => resolveNoteId(notes, '000000')).toThrow('not found');
  });
});

describe('vault storage', () => {
  test('creates, filters, updates and deletes notes; comments are a running log', () => {
    const task = vault.createNote('live', { title: 'Rotate the deploy token', kind: 'task', tags: ['ops'] });
    const note = vault.createNote('live', { title: 'Cache idea', body: 'Use ETags for **pipelines**', tags: ['perf'] });
    expect(task).toMatchObject({ kind: 'task', status: 'open', namespace: 'live', migrated: null, comments: [] });
    expect(vault.listNotes('live', { kind: 'task' }).map((n) => n.id)).toContain(task.id);
    expect(vault.listNotes('live', { kind: 'task' }).map((n) => n.id)).not.toContain(note.id);
    expect(vault.listNotes('live', { tag: 'perf' }).map((n) => n.id)).toEqual([note.id]);
    expect(vault.listNotes('live', { q: 'etags' }).map((n) => n.id)).toEqual([note.id]);

    const done = vault.updateNote('live', task.id, { status: 'done' });
    expect(done.status).toBe('done');
    expect(vault.listNotes('live', { status: 'done' }).map((n) => n.id)).toContain(task.id);

    let withComments = vault.addNoteComment('live', note.id, 'Tried If-None-Match; GitLab returns 304');
    withComments = vault.addNoteComment('live', note.id, 'Second attempt');
    expect(withComments.comments.map((c) => c.body)).toEqual(['Tried If-None-Match; GitLab returns 304', 'Second attempt']);
    expect(vault.listNotes('live', { q: '304' }).map((n) => n.id)).toEqual([note.id]);
    const [first, second] = withComments.comments;
    const edited = vault.updateNoteComment('live', note.id, first.id, 'Edited');
    expect(edited.comments[0].body).toBe('Edited');
    expect(vault.deleteNoteComment('live', note.id, second.id).comments).toHaveLength(1);
    expect(() => vault.addNoteComment('live', note.id, '   ')).toThrow('comment');
    expect(() => vault.updateNoteComment('live', note.id, 'missing', 'x')).toThrow('Comment not found');

    // Callers get copies; mutating them does not change stored state.
    const copy = vault.getNote('live', note.id);
    copy.title = 'mutated';
    expect(vault.getNote('live', note.id).title).toBe('Cache idea');

    vault.deleteNote('live', task.id);
    expect(() => vault.getNote('live', task.id)).toThrow('Note not found');
  });

  test('keeps demo notes in their own namespace', () => {
    const live = vault.createNote('live', { title: 'Live only' });
    const sample = vault.createNote('demo', { title: 'Demo only' });
    expect(vault.listNotes('live').some((n) => n.id === sample.id)).toBe(false);
    expect(vault.listNotes('demo').some((n) => n.id === live.id)).toBe(false);
    expect(() => vault.getNote('demo', live.id)).toThrow('Note not found');
    expect(() => vault.updateNote('demo', live.id, { title: 'x' })).toThrow('Note not found');
    expect(() => vault.deleteNote('demo', live.id)).toThrow('Note not found');
  });

  test('migrated notes keep their status', () => {
    const note = vault.createNote('live', { title: 'Will migrate' });
    vault.markNoteMigrated('live', note.id, { project_id: 9, iid: 3, web_url: 'https://gitlab.example/team/app/-/issues/3' });
    expect(() => vault.updateNote('live', note.id, { status: 'open' })).toThrow('migrated');
    expect(vault.getNote('live', note.id).status).toBe('migrated');
  });
});

test('notes are encrypted at rest, survive lock and a fresh process, and migrate older vaults', () => {
  const dir = scratch('lazylab-notes-restart-');
  const module = JSON.stringify(new URL('../server/vault.ts', import.meta.url).href);
  try {
    // An older vault: no notes array at all.
    const setup = runIsolated(dir, `import { vault } from ${module};
      await vault.initialize('tester', 'long-enough-password', { notes: undefined });
      vault.lock();
      if (!await vault.verifyAndUnlock('tester', 'long-enough-password')) process.exit(2);
      if (vault.listNotes('live').length !== 0) process.exit(3);
      const n = vault.createNote('live', { title: 'private-note-marker', body: 'secret-body-marker', tags: ['ops'] });
      vault.addNoteComment('live', n.id, 'private-comment-marker');
      vault.createNote('demo', { title: 'demo note' });
      vault.lock();
      try { vault.listNotes('live'); process.exit(4); } catch {}
      console.log(n.id);`);
    expect(setup.stderr).toBe('');
    expect(setup.exit).toBe(0);
    const raw = readFileSync(path.join(dir, 'vault.json'), 'utf8');
    for (const marker of ['private-note-marker', 'secret-body-marker', 'private-comment-marker']) expect(raw).not.toContain(marker);

    const read = runIsolated(dir, `import { vault } from ${module};
      if (await vault.verifyAndUnlock('tester', 'wrong-password-here')) process.exit(2);
      if (!await vault.verifyAndUnlock('tester', 'long-enough-password')) process.exit(3);
      console.log(JSON.stringify({ live: vault.listNotes('live'), demo: vault.listNotes('demo') }));`);
    expect(read.exit).toBe(0);
    const { live, demo: demoNotes } = JSON.parse(read.stdout);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ id: setup.stdout, title: 'private-note-marker', tags: ['ops'] });
    expect(live[0].comments[0].body).toBe('private-comment-marker');
    expect(demoNotes.map((n: Note) => n.title)).toEqual(['demo note']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a failed vault write leaves no phantom note, edit or comment', () => {
  const dir = scratch('lazylab-notes-rollback-');
  const module = JSON.stringify(new URL('../server/vault.ts', import.meta.url).href);
  const tmp = JSON.stringify(path.join(dir, 'vault.json.'));
  try {
    const result = runIsolated(dir, `import { vault } from ${module};
      import { mkdirSync, rmSync } from 'fs';
      await vault.initialize('tester', 'long-enough-password');
      const kept = vault.createNote('live', { title: 'kept' });
      // A directory where the temp file goes makes the next write fail.
      const blocker = ${tmp} + process.pid + '.tmp';
      mkdirSync(blocker);
      const attempts = [
        () => vault.createNote('live', { title: 'must not appear' }),
        () => vault.updateNote('live', kept.id, { title: 'must not change' }),
        () => vault.addNoteComment('live', kept.id, 'must not appear'),
        () => vault.deleteNote('live', kept.id),
        () => vault.markNoteMigrated('live', kept.id, { project_id: 1, iid: 1, web_url: 'x' })
      ];
      for (const attempt of attempts) {
        let failed = false;
        try { attempt(); } catch { failed = true; }
        if (!failed) process.exit(2);
      }
      rmSync(blocker, { recursive: true });
      const notes = vault.listNotes('live');
      if (notes.length !== 1 || notes[0].title !== 'kept' || notes[0].comments.length || notes[0].status !== 'open') process.exit(3);
      console.log('ok');`);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('ok');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the per-namespace count limit is enforced and rolled back', () => {
  const dir = scratch('lazylab-notes-limit-');
  const module = JSON.stringify(new URL('../server/vault.ts', import.meta.url).href);
  try {
    const result = runIsolated(dir, `import { vault } from ${module};
      await vault.initialize('tester', 'long-enough-password');
      for (let i = 0; i < 1000; i++) vault.createNote('live', { title: 'n' + i });
      try { vault.createNote('live', { title: 'one too many' }); process.exit(2); } catch (e) { if (!/at most 1000/.test(e.message)) process.exit(3); }
      if (vault.listNotes('live').length !== 1000) process.exit(4);
      vault.createNote('demo', { title: 'other namespace still has room' });
      console.log('ok');`);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('ok');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30_000);

describe('migrate to a work item', () => {
  test('demo: creates the issue with comments appended, then marks the note migrated', async () => {
    const note = vault.createNote('demo', { title: 'Promote me', body: 'Steps to reproduce', kind: 'task', tags: ['ci'] });
    vault.addNoteComment('demo', note.id, 'Tried clearing the runner cache');
    const result = await migrateNote(demo, note.id, { project_id: 901, mode: 'mark', labels_from_tags: true });
    expect(result.deleted).toBe(false);
    expect(result.work_item.project_id).toBe(901);
    expect(result.note).toMatchObject({ status: 'migrated', migrated: { project_id: 901, iid: result.work_item.iid, web_url: result.work_item.web_url } });
    const issue = await demo.getWorkItem(901, result.work_item.iid);
    expect(issue.title).toBe('Promote me');
    expect(issue.description).toContain('Steps to reproduce');
    expect(issue.description).toContain('Tried clearing the runner cache');
    expect(issue.labels).toEqual(['ci']);
    expect(issue.work_item_type.toLowerCase()).toBe('task');
    await expect(migrateNote(demo, note.id, { project_id: 901, mode: 'mark' })).rejects.toThrow('already migrated');
  });

  test('demo: delete mode removes the note; unknown projects are refused before anything is created', async () => {
    const note = vault.createNote('demo', { title: 'Delete after migrating' });
    await expect(migrateNote(demo, note.id, { project_id: 424242, mode: 'delete' })).rejects.toThrow('Project not found');
    expect(vault.getNote('demo', note.id).status).toBe('open');
    const result = await migrateNote(demo, note.id, { project_id: 902, mode: 'delete' });
    expect(result).toMatchObject({ deleted: true, note: null });
    expect(() => vault.getNote('demo', note.id)).toThrow('Note not found');
    // A live-namespace id is not reachable through the demo client.
    const live = vault.createNote('live', { title: 'Live note' });
    await expect(migrateNote(demo, live.id, { project_id: 901, mode: 'mark' })).rejects.toThrow('Note not found');
  });

  test('live: posts title, description, type and no labels by default to GitLab', async () => {
    const posts: any[] = [];
    const gitlab = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
      const u = new URL(req.url);
      expect(req.headers.get('PRIVATE-TOKEN')).toBe('fake-test-token');
      if (req.method === 'POST' && u.pathname === '/api/v4/projects/9/issues') {
        const body = await req.json();
        posts.push(body);
        return Response.json({ id: 500, iid: 12, project_id: 9, title: body.title, description: body.description, state: 'opened',
          issue_type: body.issue_type, labels: [], assignees: [], author: { id: 1, username: 'dev', name: 'Dev' },
          web_url: 'https://gitlab.example/team/app/-/issues/12', created_at: '2026-10-23', updated_at: '2026-10-23' });
      }
      return Response.json({ message: `Unexpected ${req.method} ${u.pathname}` }, { status: 404 });
    } });
    try {
      const client = new GitLabClient(`http://127.0.0.1:${gitlab.port}`, 'fake-test-token');
      const note = vault.createNote('live', { title: 'Live migrate', body: 'Body text', tags: ['perf'] });
      vault.addNoteComment('live', note.id, 'Measured 2.1 s');
      const marked = await migrateNote(client, note.id, { project_id: 9, mode: 'mark' });
      expect(posts[0]).toMatchObject({ title: 'Live migrate', issue_type: 'issue' });
      expect(posts[0].labels).toBeUndefined();
      expect(posts[0].description).toBe(migrationDescription({ ...note, comments: vault.getNote('live', note.id).comments }));
      expect(marked.note?.migrated).toMatchObject({ project_id: 9, iid: 12, web_url: 'https://gitlab.example/team/app/-/issues/12' });

      const second = vault.createNote('live', { title: 'Live delete', kind: 'task' });
      const deleted = await migrateNote(client, second.id, { project_id: 9, mode: 'delete' });
      expect(posts[1].issue_type).toBe('task');
      expect(deleted.deleted).toBe(true);
      expect(() => vault.getNote('live', second.id)).toThrow('Note not found');

      const failing = vault.createNote('live', { title: 'GitLab refuses' });
      await expect(migrateNote(client, failing.id, { project_id: 404, mode: 'delete' })).rejects.toThrow();
      expect(vault.getNote('live', failing.id).status).toBe('open');
    } finally { gitlab.stop(true); }
  });
});

describe('export', () => {
  test('CRC-32 matches the standard check value', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });

  test('file names are slugged and de-duplicated', () => {
    expect(slugify('Ünïcode: Fix  the "cache"!')).toBe('unicode-fix-the-cache');
    expect(slugify('***')).toBe('note');
    expect(slugify('x'.repeat(100))).toHaveLength(60);
    expect(exportFileNames([{ title: 'Same' }, { title: 'same' }, { title: 'SAME!' }, { title: 'other' }])).toEqual(['same.md', 'same-2.md', 'same-3.md', 'other.md']);
  });

  test('markdown has YAML front matter, the body and appended comments', () => {
    const note: Note = {
      id: 'n1', namespace: 'live', kind: 'task', title: 'Quote "this": yes', body: 'Body', status: 'migrated', tags: ['ci', 'ops'],
      project: { project_id: 9, name: 'team/app' }, created_at: '2026-10-20T00:00:00.000Z', updated_at: '2026-10-21T00:00:00.000Z',
      migrated: { project_id: 9, iid: 3, web_url: 'https://gitlab.example/team/app/-/issues/3', migrated_at: '2026-10-21T00:00:00.000Z' },
      comments: [{ id: 'c1', body: 'Tried X', created_at: '2026-10-20T01:00:00.000Z', updated_at: '2026-10-20T01:00:00.000Z' }]
    };
    const md = noteToMarkdown(note);
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('title: "Quote \\"this\\": yes"');
    expect(md).toContain('kind: task\nstatus: migrated\ntags: ["ci", "ops"]');
    expect(md).toContain('project:\n  id: 9\n  name: "team/app"');
    expect(md).toContain('migrated:\n  project_id: 9\n  iid: 3\n  web_url: "https://gitlab.example/team/app/-/issues/3"');
    expect(md).toContain('---\n\n# Quote "this": yes\n\nBody\n\n## Comments\n\n### 2026-10-20T01:00:00.000Z\n\nTried X');
    expect(noteToMarkdown({ ...note, project: null, migrated: null, comments: [] })).toContain('project: null\nmigrated: null');
  });

  /** Independent reader: walks the central directory and checks each local header against it. */
  function readZip(zip: Buffer) {
    const eocd = zip.length - 22;
    expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
    const count = zip.readUInt16LE(eocd + 10);
    let at = zip.readUInt32LE(eocd + 16);
    expect(at + zip.readUInt32LE(eocd + 12)).toBe(eocd);
    const files: { name: string; text: string; method: number; flags: number }[] = [];
    for (let i = 0; i < count; i++) {
      expect(zip.readUInt32LE(at)).toBe(0x02014b50);
      const method = zip.readUInt16LE(at + 10);
      const crc = zip.readUInt32LE(at + 16);
      const size = zip.readUInt32LE(at + 20);
      const nameLen = zip.readUInt16LE(at + 28);
      const local = zip.readUInt32LE(at + 42);
      const name = zip.subarray(at + 46, at + 46 + nameLen).toString('utf8');
      expect(zip.readUInt32LE(local)).toBe(0x04034b50);
      expect(zip.subarray(local + 30, local + 30 + nameLen).toString('utf8')).toBe(name);
      const start = local + 30 + nameLen + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      expect(crc32(data)).toBe(crc);
      files.push({ name, text: data.toString('utf8'), method, flags: zip.readUInt16LE(at + 8) });
      at += 46 + nameLen + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    }
    return files;
  }

  test('the ZIP is store-only with UTF-8 names and reads back with standard tools', () => {
    const dir = scratch('lazylab-notes-zip-');
    try {
      const notes = ['Ünïcode title', 'Same', 'same', 'Empty body'].map((title, i) => vault.createNote('live', { title, body: i === 3 ? '' : `Body ${i} ✓` }));
      const zip = exportNotesZip(notes);
      const files = readZip(zip);
      expect(files.map((f) => f.name)).toEqual(['lazylab-notes/unicode-title.md', 'lazylab-notes/same.md', 'lazylab-notes/same-2.md', 'lazylab-notes/empty-body.md']);
      expect(files.every((f) => f.method === 0 && (f.flags & 0x0800) !== 0)).toBe(true);
      expect(files[0].text).toContain('title: "Ünïcode title"');
      expect(files[0].text).toContain('Body 0 ✓');
      expect(createZip([]).length).toBe(22);
      expect(() => createZip([{ name: '../escape.md', data: Buffer.from('x') }])).toThrow('invalid');

      // Cross-check with external readers where they exist (the CI image has neither).
      const file = path.join(dir, 'notes.zip');
      writeFileSync(file, zip);
      if (Bun.which('python3')) {
        const check = Bun.spawnSync(['python3', '-I', '-c', 'import sys, zipfile\nz = zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint("\\n".join(z.namelist()))', file]);
        expect(check.stderr.toString()).toBe('');
        expect(check.stdout.toString()).toContain('lazylab-notes/same-2.md');
      }
      if (Bun.which('unzip')) {
        const test = Bun.spawnSync(['unzip', '-t', file]);
        expect(test.exitCode).toBe(0);
        expect(test.stdout.toString()).toContain('No errors detected');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('HTTP routes', () => {
  let server: Server;
  let base: string;
  let origin: string;
  let cookie = '';
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/session', sessionRouter);
    app.use('/api', apiGuard);
    app.use('/api/notes', createNotesRouter(() => demo));
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    origin = `http://127.0.0.1:${(server.address() as any).port}`;
    base = `${origin}/api`;
  });
  afterAll(() => server.close());

  const call = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

  test('requires a session, and an Origin for writes', async () => {
    expect((await call('GET', '/notes')).status).toBe(401);
    expect((await call('GET', '/notes/export')).status).toBe(401);
    expect((await call('POST', '/notes', { title: 'x' }, { Origin: origin })).status).toBe(401);
    // An agent token is not a session: notes are not under /api/agent.
    const { token } = vault.createAgentToken('notes-route-test');
    expect((await call('GET', '/notes', undefined, { Authorization: `Bearer ${token}` })).status).toBe(401);

    const login = await call('POST', '/session/login', { username: USER, password: PASSWORD }, { Origin: origin });
    expect(login.status).toBe(200);
    cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    expect(cookie).toContain('lazylab_sid=');
    expect((await call('POST', '/notes', { title: 'x' })).status).toBe(403);
    expect((await call('POST', '/notes', { title: 'x' }, { Origin: 'https://elsewhere.example' })).status).toBe(403);
  });

  test('CRUD, comments, filters, migrate and export over HTTP', async () => {
    const w = { Origin: origin };
    const created = await call('POST', '/notes', { title: 'HTTP task', kind: 'task', tags: ['http'], body: 'From the route test' }, w);
    expect(created.status).toBe(201);
    const { note } = await created.json();
    expect((await call('POST', '/notes', { title: 'x', id: 'forged' }, w)).status).toBe(400);

    const listed = await (await call('GET', '/notes?tag=http&kind=task')).json();
    expect(listed.namespace).toBe('demo');
    expect(listed.tags).toContain('http');
    expect(listed.notes.map((n: Note) => n.id)).toEqual([note.id]);
    expect((await call('GET', '/notes?kind=bogus')).status).toBe(400);

    const patched = await (await call('PATCH', `/notes/${note.id}`, { status: 'done' }, w)).json();
    expect(patched.note.status).toBe('done');
    const commented = await (await call('POST', `/notes/${note.id}/comments`, { body: 'Tried the route' }, w)).json();
    const commentId = commented.note.comments[0].id;
    expect((await (await call('PATCH', `/notes/${note.id}/comments/${commentId}`, { body: 'Edited' }, w)).json()).note.comments[0].body).toBe('Edited');
    expect((await call('GET', `/notes/${note.id}`)).status).toBe(200);
    expect((await call('GET', '/notes/does-not-exist')).status).toBe(404);

    const exported = await call('GET', '/notes/export');
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-type')).toBe('application/zip');
    expect(exported.headers.get('content-disposition')).toMatch(/^attachment; filename="lazylab-notes-\d{4}-\d{2}-\d{2}\.zip"$/);
    const bytes = Buffer.from(await exported.arrayBuffer());
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(bytes.includes(Buffer.from('lazylab-notes/http-task.md'))).toBe(true);

    expect((await call('POST', `/notes/${note.id}/migrate`, { project_id: 901, mode: 'sideways' }, w)).status).toBe(400);
    const migrated = await (await call('POST', `/notes/${note.id}/migrate`, { project_id: 901, mode: 'mark' }, w)).json();
    expect(migrated.note.status).toBe('migrated');
    expect((await call('POST', `/notes/${note.id}/migrate`, { project_id: 901, mode: 'mark' }, w)).status).toBe(400);

    expect((await call('DELETE', `/notes/${note.id}/comments/${commentId}`, undefined, w)).status).toBe(200);
    expect((await call('DELETE', `/notes/${note.id}`, undefined, w)).status).toBe(200);
    expect((await call('GET', `/notes/${note.id}`)).status).toBe(404);
  });
});

describe('MCP tools and CLI', () => {
  const invoke = async (name: string, args: unknown) => {
    const res: any = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
      () => ({ client: demo, profileId: null, token: { id: 'notes-agent', name: 'notes-agent', secrets: false } }));
    return { error: res.result.isError as boolean, text: res.result.content[0].text as string };
  };

  test('agents add, list, read and complete notes; invalid input is a tool error', async () => {
    const added = await invoke('add_note', { title: 'Agent jotted', body: 'Check the flaky test', kind: 'task', tags: ['agent'] });
    expect(added.error).toBe(false);
    const note = JSON.parse(added.text) as Note;
    expect(note.namespace).toBe('demo');
    const listed = JSON.parse((await invoke('list_notes', { tag: 'agent', status: 'open' })).text);
    expect(listed.notes.map((n: any) => n.id)).toContain(note.id);
    expect(listed.notes[0]).not.toHaveProperty('body');
    expect(JSON.parse((await invoke('get_note', { id: note.id.slice(0, 8) })).text).body).toBe('Check the flaky test');
    expect(JSON.parse((await invoke('set_note_status', { id: note.id, status: 'done' })).text).status).toBe('done');
    expect((await invoke('set_note_status', { id: note.id, status: 'migrated' })).error).toBe(true);
    expect((await invoke('add_note', { title: '' })).error).toBe(true);
    expect((await invoke('add_note', { title: 'x', tags: ['bad tag'] })).error).toBe(true);
    expect((await invoke('list_notes', { limit: 101 })).error).toBe(true);
    expect((await invoke('get_note', { id: 'nope' })).error).toBe(true);
  });

  test('renders aligned CLI rows', () => {
    const rows = renderNoteRows([
      { id: '12345678-aaaa', kind: 'task', status: 'done', title: 'Ship it', tags: ['ops'], updated_at: new Date(0).toISOString() },
      { id: '87654321-bbbb', kind: 'note', status: 'open', title: 'Idea', tags: [], updated_at: new Date(0).toISOString() }
    ], 60_000);
    expect(rows[0]).toContain('12345678');
    expect(rows[0]).toContain('[x]');
    expect(rows[0]).toContain('#ops');
    expect(rows[1]).toContain(' - ');
  });

  describe('lazy note over HTTP', () => {
    let server: Server;
    let url: string;
    let token: string;
    beforeAll(async () => {
      token = vault.createAgentToken('cli-notes-test').token;
      const app = express();
      app.use(express.json());
      app.use('/mcp', createMcpRouter(() => demo));
      server = await new Promise<Server>((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
      });
      url = `http://127.0.0.1:${(server.address() as any).port}`;
    });
    afterAll(() => server.close());
    const cli = async (...args: string[]) => {
      const proc = Bun.spawn([Bun.which('bun')!, 'cli/lazy.ts', ...args], {
        env: { ...process.env, LAZYLAB_URL: url, LAZYLAB_TOKEN: token, NO_COLOR: '1' }, stdout: 'pipe', stderr: 'pipe'
      });
      const [stdout, stderr, exit] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      return { stdout, stderr, exit };
    };

    test('add, list, show and done round-trip', async () => {
      const dir = scratch('lazylab-notes-cli-');
      try {
        const file = path.join(dir, 'body.md');
        writeFileSync(file, '# From a file\n\n- [ ] step');
        const added = await cli('note', 'add', 'CLI', 'task', 'title', '--task', '--tag', 'cli,terminal', '--file', file, '--json');
        expect(added.stderr).toBe('');
        expect(added.exit).toBe(0);
        const note = JSON.parse(added.stdout) as Note;
        expect(note).toMatchObject({ title: 'CLI task title', kind: 'task', tags: ['cli', 'terminal'], body: '# From a file\n\n- [ ] step' });
        const listed = await cli('note', 'list', '--tag', 'cli');
        expect(listed.exit).toBe(0);
        expect(listed.stdout).toContain(note.id.slice(0, 8));
        expect(listed.stdout).toContain('CLI task title');
        const shown = await cli('note', 'show', note.id.slice(0, 8));
        expect(shown.stdout).toContain('# CLI task title');
        expect(shown.stdout).toContain('- [ ] step');
        const done = await cli('note', 'done', note.id.slice(0, 8));
        expect(done.exit).toBe(0);
        expect(done.stdout).toContain('Done');
        expect(JSON.parse((await cli('note', 'show', note.id, '--json')).stdout).status).toBe('done');
        expect((await cli('note', 'add')).exit).toBe(2);
        expect((await cli('note', 'list', '--status', 'closed')).exit).toBe(2);
        expect((await cli('note', 'add', 'x', '--body', 'a', '--file', file)).exit).toBe(2);
        expect((await cli('note', 'show', 'zzzzzzzz')).exit).toBe(1);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  });
});
