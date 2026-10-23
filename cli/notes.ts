/** Personal notes and tasks through the same MCP tools agents use (list_notes, get_note, add_note, set_note_status). */
import { readFileSync, statSync } from 'fs';
import type { Ctx } from './commands.js';
import { CliError } from './client.js';
import { out, paint, relativeTime, table, Tone, UI } from './ui.js';
import type { Note, NoteKind, NoteStatus } from '../server/notes.js';

interface NoteRow {
  id: string;
  kind: NoteKind;
  status: NoteStatus;
  title: string;
  tags: string[];
  updated_at: string;
}

const STATUS_TONE: Record<NoteStatus, Tone> = { open: 'info', done: 'ok', migrated: 'dim' };

export const shortId = (id: string) => id.slice(0, 8);

export function renderNoteRows(notes: NoteRow[], now = Date.now()): string[] {
  return table(notes.map((n) => [
    { text: shortId(n.id), tone: 'dim' },
    { text: n.kind === 'task' ? (n.status === 'done' ? '[x]' : '[ ]') : ' - ' },
    { text: `${UI.mark} ${n.status}`, tone: STATUS_TONE[n.status] },
    { text: n.title, flex: true },
    { text: n.tags.map((t) => `#${t}`).join(' '), tone: 'dim' },
    { text: relativeTime(n.updated_at, now), tone: 'dim' }
  ]));
}

export function renderNote(n: Note): string {
  const lines = [`# ${n.title}`, `${n.kind} ${UI.sep} ${n.status} ${UI.sep} ${n.id}`];
  if (n.tags.length) lines.push(`Tags: ${n.tags.map((t) => `#${t}`).join(' ')}`);
  if (n.project) lines.push(`Project: ${n.project.name ?? n.project.project_id}`);
  if (n.migrated) lines.push(`Migrated: ${n.migrated.web_url}`);
  lines.push(`Created ${n.created_at} ${UI.sep} updated ${n.updated_at}`);
  if (n.body.trim()) lines.push('', n.body.trim());
  if (n.comments.length) {
    lines.push('', '## Comments');
    for (const c of n.comments) lines.push('', `${c.created_at}:`, c.body.trim());
  }
  return lines.join('\n');
}

export async function noteList(ctx: Ctx, opts: { kind?: string; status?: string; tag?: string; search?: string; limit?: number }) {
  if (opts.kind && !['note', 'task'].includes(opts.kind)) throw new CliError('--kind must be note or task', 2);
  if (opts.status && !['open', 'done', 'migrated'].includes(opts.status)) throw new CliError('--status must be open, done or migrated', 2);
  const data = await ctx.client.call<{ total: number; notes: NoteRow[] }>('list_notes', {
    ...(opts.kind ? { kind: opts.kind } : {}), ...(opts.status ? { status: opts.status } : {}),
    ...(opts.tag ? { tag: opts.tag } : {}), ...(opts.search ? { query: opts.search } : {}),
    limit: opts.limit ?? 50
  });
  if (ctx.json) return out(JSON.stringify(data, null, 2)), 0;
  if (!data.notes.length) return out('No notes.'), 0;
  for (const line of renderNoteRows(data.notes)) out(line);
  if (data.total > data.notes.length) out(paint('dim', `${data.notes.length} of ${data.total}; use --limit or a filter`));
  return 0;
}

export async function noteShow(ctx: Ctx, id: string) {
  const note = await ctx.client.call<Note>('get_note', { id });
  out(ctx.json ? JSON.stringify(note, null, 2) : renderNote(note));
  return 0;
}

export async function noteAdd(ctx: Ctx, opts: { title: string; body?: string; file?: string; task: boolean; tags: string[] }) {
  if (!opts.title.trim()) throw new CliError('Usage: lazy note add <title> [--body <text> | --file <notes.md>] [--task] [--tag a,b]', 2);
  if (opts.body !== undefined && opts.file) throw new CliError('Use --body or --file, not both', 2);
  let body = opts.body;
  if (opts.file) {
    try {
      if (statSync(opts.file).size > 200_000) throw new Error('file exceeds 200 KB');
      body = readFileSync(opts.file, 'utf8');
    } catch (err: any) { throw new CliError(`Cannot read ${opts.file}: ${err.message}`, 2); }
  }
  const note = await ctx.client.call<Note>('add_note', {
    title: opts.title, ...(body !== undefined ? { body } : {}), kind: opts.task ? 'task' : 'note',
    ...(opts.tags.length ? { tags: opts.tags } : {})
  });
  out(ctx.json ? JSON.stringify(note, null, 2) : `${paint('ok', `${UI.mark} Saved`)} ${note.kind} ${shortId(note.id)}: ${note.title}`);
  return 0;
}

export async function noteStatus(ctx: Ctx, id: string, status: 'open' | 'done') {
  const note = await ctx.client.call<Note>('set_note_status', { id, status });
  out(ctx.json ? JSON.stringify(note, null, 2) : `${paint('ok', `${UI.mark} ${status === 'done' ? 'Done' : 'Reopened'}`)} ${shortId(note.id)}: ${note.title}`);
  return 0;
}
