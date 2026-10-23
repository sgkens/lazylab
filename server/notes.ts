/**
 * Personal notes and tasks that live in lazylab rather than in a GitLab project. Stored encrypted in the
 * vault; not scoped to a GitLab profile. Once a note is migrated, GitLab is the source of truth.
 */

export type NoteKind = 'note' | 'task';
export type NoteStatus = 'open' | 'done' | 'migrated';
/** Notes written in demo mode stay apart, so sample project links and demo issues never mix with real ones. */
export type NoteNamespace = 'live' | 'demo';

export interface NoteComment {
  id: string;
  body: string;
  created_at: string;
  updated_at: string;
}

/** Optional link to a project on the GitLab profile that was active when the link was set. */
export interface NoteProjectLink {
  project_id: number;
  name?: string;
}

export interface NoteMigration {
  project_id: number;
  iid: number;
  web_url: string;
  migrated_at: string;
}

export interface Note {
  id: string;
  namespace: NoteNamespace;
  kind: NoteKind;
  title: string;
  body: string;
  status: NoteStatus;
  tags: string[];
  project: NoteProjectLink | null;
  migrated: NoteMigration | null;
  comments: NoteComment[];
  created_at: string;
  updated_at: string;
}

/** Fields a client may set. `migrated` status is only reachable through the migrate action. */
export interface NoteInput {
  kind?: NoteKind;
  title?: string;
  body?: string;
  status?: 'open' | 'done';
  tags?: string[];
  project?: NoteProjectLink | null;
}

export interface NoteFilter {
  kind?: NoteKind;
  status?: NoteStatus;
  tag?: string;
  q?: string;
}

export const NOTE_LIMITS = {
  title: 200,
  body: 50_000,
  tags: 20,
  tag: 40,
  comments: 100,
  comment: 10_000,
  /** Per namespace. */
  notes: 1000,
  /** Serialized size of one namespace's notes; the whole vault payload is re-encrypted on every write. */
  totalChars: 5_000_000
} as const;

const KINDS: NoteKind[] = ['note', 'task'];
const STATUSES: NoteStatus[] = ['open', 'done', 'migrated'];
const TAG = /^[\p{L}\p{N}][\p{L}\p{N}._\/-]*$/u;

const plainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function title(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > NOTE_LIMITS.title) {
    throw new Error(`title must contain 1–${NOTE_LIMITS.title} characters`);
  }
  return value.trim().replace(/\s+/g, ' ');
}

function body(value: unknown, name: string, max: number, required: boolean): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${name} must be a string of at most ${max} characters`);
  if (required && !value.trim()) throw new Error(`${name} must not be empty`);
  return value.replace(/\r\n/g, '\n');
}

export function parseTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > NOTE_LIMITS.tags) throw new Error(`tags must be an array of at most ${NOTE_LIMITS.tags} entries`);
  const tags = new Set<string>();
  for (const raw of value) {
    const tag = typeof raw === 'string' ? raw.trim().replace(/^#/, '').toLowerCase() : '';
    if (!tag || tag.length > NOTE_LIMITS.tag || !TAG.test(tag)) {
      throw new Error(`tags must be 1–${NOTE_LIMITS.tag} letters, digits, ".", "_", "/" or "-"`);
    }
    tags.add(tag);
  }
  return [...tags];
}

function projectLink(value: unknown): NoteProjectLink | null {
  if (value === null) return null;
  if (!plainObject(value) || Object.keys(value).some((k) => k !== 'project_id' && k !== 'name')) {
    throw new Error('project must be null or { project_id, name? }');
  }
  if (!Number.isSafeInteger(value.project_id) || (value.project_id as number) <= 0) throw new Error('project_id must be a positive integer');
  const link: NoteProjectLink = { project_id: value.project_id as number };
  if (value.name !== undefined) {
    if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 255) throw new Error('project name must contain 1–255 characters');
    link.name = value.name.trim();
  }
  return link;
}

/**
 * Validate at the storage boundary: clients must not set ids, timestamps, comments or migration links.
 * `partial` accepts any subset of fields (updates); otherwise a title is required (create).
 */
export function parseNoteInput(input: unknown, partial: boolean): NoteInput {
  if (!plainObject(input)) throw new Error('note must be an object');
  const allowed = ['kind', 'title', 'body', 'status', 'tags', 'project'];
  for (const key of Object.keys(input)) if (!allowed.includes(key)) throw new Error(`unknown note field "${key}"`);
  const result: NoteInput = {};
  if (input.kind !== undefined) {
    if (!KINDS.includes(input.kind as NoteKind)) throw new Error('kind must be note or task');
    result.kind = input.kind as NoteKind;
  }
  if (input.title !== undefined || !partial) result.title = title(input.title);
  if (input.body !== undefined) result.body = body(input.body, 'body', NOTE_LIMITS.body, false);
  if (input.status !== undefined) {
    if (input.status === 'migrated') throw new Error('use the migrate action to mark a note migrated');
    if (input.status !== 'open' && input.status !== 'done') throw new Error('status must be open or done');
    result.status = input.status;
  }
  if (input.tags !== undefined) result.tags = parseTags(input.tags);
  if (input.project !== undefined) result.project = projectLink(input.project);
  if (partial && !Object.keys(result).length) throw new Error('nothing to update');
  return result;
}

export const parseCommentBody = (value: unknown) => body(value, 'comment', NOTE_LIMITS.comment, true);

export function parseNoteFilter(query: Record<string, unknown>): NoteFilter {
  const one = (key: string) => {
    const v = query[key];
    if (v === undefined || v === '') return undefined;
    if (typeof v !== 'string') throw new Error(`${key} must be given once`);
    return v;
  };
  const filter: NoteFilter = {};
  const kind = one('kind');
  if (kind !== undefined) {
    if (!KINDS.includes(kind as NoteKind)) throw new Error('kind must be note or task');
    filter.kind = kind as NoteKind;
  }
  const status = one('status');
  if (status !== undefined) {
    if (!STATUSES.includes(status as NoteStatus)) throw new Error('status must be open, done or migrated');
    filter.status = status as NoteStatus;
  }
  const tag = one('tag');
  if (tag !== undefined) filter.tag = tag.trim().replace(/^#/, '').toLowerCase();
  const q = one('q');
  if (q !== undefined) {
    if (q.length > 200) throw new Error('q must be at most 200 characters');
    filter.q = q.trim().toLowerCase();
  }
  return filter;
}

export function matchesFilter(note: Note, filter: NoteFilter): boolean {
  if (filter.kind && note.kind !== filter.kind) return false;
  if (filter.status && note.status !== filter.status) return false;
  if (filter.tag && !note.tags.includes(filter.tag)) return false;
  if (filter.q) {
    const haystack = [note.title, note.body, ...note.tags, ...note.comments.map((c) => c.body)].join('\n').toLowerCase();
    if (!haystack.includes(filter.q)) return false;
  }
  return true;
}

/** Full id, or a unique prefix of at least 6 characters (for the CLI, which shows short ids). */
export function resolveNoteId(notes: Pick<Note, 'id'>[], ref: string): string {
  const key = ref.trim().toLowerCase();
  const exact = notes.find((n) => n.id === key);
  if (exact) return exact.id;
  if (key.length < 6) throw new Error('Note not found');
  const matches = notes.filter((n) => n.id.startsWith(key));
  if (matches.length > 1) throw new Error(`Note id "${ref}" is ambiguous; use more characters`);
  if (!matches.length) throw new Error('Note not found');
  return matches[0].id;
}

// ---- migration and export -----------------------------------------------------

/** Issue description for a migrated note: the body, then the comment log as an appendix. */
export function migrationDescription(note: Note): string {
  const parts = [note.body.trim() || '_No description._'];
  if (note.comments.length) {
    parts.push('---', '### Notes log', ...note.comments.map((c) => `**${c.created_at}**\n\n${c.body.trim()}`));
  }
  parts.push(`_Migrated from a lazylab ${note.kind} created ${note.created_at}._`);
  return parts.join('\n\n');
}

/** YAML double-quoted scalar. JSON string escapes are valid YAML. */
const yamlString = (value: string) => JSON.stringify(value);

export function noteToMarkdown(note: Note): string {
  const lines = [
    '---',
    `id: ${yamlString(note.id)}`,
    `title: ${yamlString(note.title)}`,
    `kind: ${note.kind}`,
    `status: ${note.status}`,
    `tags: [${note.tags.map(yamlString).join(', ')}]`
  ];
  if (note.project) {
    lines.push('project:', `  id: ${note.project.project_id}`);
    if (note.project.name) lines.push(`  name: ${yamlString(note.project.name)}`);
  } else lines.push('project: null');
  if (note.migrated) {
    lines.push('migrated:', `  project_id: ${note.migrated.project_id}`, `  iid: ${note.migrated.iid}`,
      `  web_url: ${yamlString(note.migrated.web_url)}`, `  migrated_at: ${yamlString(note.migrated.migrated_at)}`);
  } else lines.push('migrated: null');
  lines.push(`created_at: ${yamlString(note.created_at)}`, `updated_at: ${yamlString(note.updated_at)}`, '---', '', `# ${note.title}`, '');
  if (note.body.trim()) lines.push(note.body.trim(), '');
  if (note.comments.length) {
    lines.push('## Comments', '');
    for (const c of note.comments) lines.push(`### ${c.created_at}`, '', c.body.trim(), '');
  }
  return lines.join('\n');
}

export function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'note';
}

/** One `.md` per note, named after its title; duplicates get -2, -3, … (case-insensitive). */
export function exportFileNames(notes: Pick<Note, 'title'>[]): string[] {
  const used = new Set<string>();
  return notes.map((note) => {
    const base = slugify(note.title);
    let name = `${base}.md`;
    for (let i = 2; used.has(name); i++) name = `${base}-${i}.md`;
    used.add(name);
    return name;
  });
}
