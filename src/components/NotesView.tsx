import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CheckSquare,
  Download,
  ExternalLink,
  MessageSquare,
  NotebookPen,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Square,
  StickyNote,
  Trash2,
  X
} from 'lucide-react';
import { GitLabProject } from '../types/gitlab';
import { Note, NoteFilter, NoteKind, NoteMigrateOptions, NoteNamespace, NoteStatus } from '../types/notes';
import { notesApi } from '../services/api';
import { reportError } from '../utils/reportError';
import { renderMarkdownToHtml } from '../utils/markdown';
import { MarkdownEditor } from './MarkdownEditor';

interface NotesViewProps {
  projects: GitLabProject[];
  showToast: (msg: string) => void;
}

interface Draft {
  id: string | null;
  kind: NoteKind;
  title: string;
  body: string;
  tags: string;
  projectId: number | null;
}

const STATUS_BADGE: Record<NoteStatus, string> = {
  open: 'text-sky-300 bg-sky-950/50 border-sky-800/60',
  done: 'text-emerald-300 bg-emerald-950/50 border-emerald-800/60',
  migrated: 'text-zinc-300 bg-zinc-800/60 border-zinc-700'
};

const inputClass =
  'bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-orange-500';

const emptyDraft = (kind: NoteKind): Draft => ({ id: null, kind, title: '', body: '', tags: '', projectId: null });

const draftOf = (note: Note): Draft => ({
  id: note.id,
  kind: note.kind,
  title: note.title,
  body: note.body,
  tags: note.tags.join(', '),
  projectId: note.project?.project_id ?? null
});

const parseTagInput = (value: string) =>
  value
    .split(/[,\s]+/)
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean);

function relativeTime(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

const Markdown: React.FC<{ text: string }> = ({ text }) => (
  <div
    className="text-xs text-zinc-200 prose prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-pre:my-1 leading-relaxed"
    dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(text) }}
  />
);

function MigrateDialog({
  note,
  projects,
  onClose,
  onMigrate
}: {
  note: Note;
  projects: GitLabProject[];
  onClose: () => void;
  onMigrate: (options: NoteMigrateOptions) => Promise<void>;
}) {
  const [projectId, setProjectId] = useState<number>(note.project?.project_id ?? projects[0]?.id ?? 0);
  const [mode, setMode] = useState<'mark' | 'delete'>('mark');
  const [issueType, setIssueType] = useState<'issue' | 'task'>(note.kind === 'task' ? 'task' : 'issue');
  const [labelsFromTags, setLabelsFromTags] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    setBusy(true);
    try {
      await onMigrate({ project_id: projectId, mode, issue_type: issueType, labels_from_tags: labelsFromTags });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2 text-base font-semibold text-white">
            <ArrowUpRight className="w-5 h-5 text-orange-400" />
            <span>Migrate to GitLab</span>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={submit} className="p-6 overflow-y-auto space-y-4 text-xs">
          <p className="text-zinc-400">
            Creates an issue from <span className="text-zinc-100 font-semibold">{note.title}</span>. The body becomes the
            description
            {note.comments.length > 0
              ? `, and ${note.comments.length === 1 ? 'its comment is' : `its ${note.comments.length} comments are`} appended as a log.`
              : '.'}
          </p>
          <div>
            <label className="block text-zinc-400 font-medium mb-1">Project</label>
            {projects.length === 0 ? (
              <p className="text-amber-300">No projects are loaded for the active GitLab profile.</p>
            ) : (
              <select value={projectId} onChange={(e) => setProjectId(Number(e.target.value))} className={`w-full ${inputClass}`}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name_with_namespace || p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="block text-zinc-400 font-medium mb-1">Type</label>
            <select value={issueType} onChange={(e) => setIssueType(e.target.value as 'issue' | 'task')} className={`w-full ${inputClass}`}>
              <option value="issue">Issue</option>
              <option value="task">Task</option>
            </select>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-zinc-400 font-medium mb-1">After the issue is created</legend>
            <label className="flex items-start gap-2 text-zinc-300">
              <input type="radio" name="mode" checked={mode === 'mark'} onChange={() => setMode('mark')} className="mt-0.5 accent-orange-500" />
              <span>Keep the note, marked migrated with a link to the issue</span>
            </label>
            <label className="flex items-start gap-2 text-zinc-300">
              <input type="radio" name="mode" checked={mode === 'delete'} onChange={() => setMode('delete')} className="mt-0.5 accent-orange-500" />
              <span>Delete the note</span>
            </label>
          </fieldset>
          {note.tags.length > 0 && (
            <label className="flex items-start gap-2 text-zinc-300">
              <input type="checkbox" checked={labelsFromTags} onChange={(e) => setLabelsFromTags(e.target.checked)} className="mt-0.5 accent-orange-500" />
              <span>
                Add tags as labels ({note.tags.join(', ')}). GitLab creates labels that do not exist in the project.
              </span>
            </label>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md text-zinc-300 hover:bg-zinc-800">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !projectId}
              className="px-3 py-1.5 rounded-md font-semibold text-white bg-orange-600 hover:bg-orange-500 disabled:opacity-60"
            >
              {busy ? 'Creating…' : 'Create issue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export const NotesView: React.FC<NotesViewProps> = ({ projects, showToast }) => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [namespace, setNamespace] = useState<NoteNamespace>('live');
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<NoteFilter>({});
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [comment, setComment] = useState('');
  const [editingComment, setEditingComment] = useState<{ id: string; body: string } | null>(null);
  const [migrating, setMigrating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await notesApi.list(filter);
      setNotes(res.notes);
      setAllTags(res.tags);
      setNamespace(res.namespace);
    } catch (err) {
      reportError('Could not load notes', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  // Debounce the text search so each keystroke is not a request.
  useEffect(() => {
    const timer = setTimeout(() => setFilter((f) => ({ ...f, q: search.trim() || undefined })), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const selected = useMemo(() => (draft?.id ? notes.find((n) => n.id === draft.id) ?? null : null), [draft, notes]);
  const readOnly = selected?.status === 'migrated';

  const replaceNote = (note: Note) => setNotes((list) => list.map((n) => (n.id === note.id ? note : n)));

  const confirmDiscard = () => !dirty || window.confirm('Discard unsaved changes?');

  const open = (note: Note) => {
    if (draft?.id === note.id || !confirmDiscard()) return;
    setDraft(draftOf(note));
    setDirty(false);
    setComment('');
    setEditingComment(null);
  };

  const startNew = (kind: NoteKind) => {
    if (!confirmDiscard()) return;
    setDraft(emptyDraft(kind));
    setDirty(false);
    setComment('');
    setEditingComment(null);
  };

  const edit = (patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  };

  const save = async () => {
    if (!draft || !draft.title.trim()) return;
    const project = draft.projectId ? projects.find((p) => p.id === draft.projectId) : null;
    const payload = {
      kind: draft.kind,
      title: draft.title,
      body: draft.body,
      tags: parseTagInput(draft.tags),
      project: draft.projectId ? { project_id: draft.projectId, ...(project ? { name: project.path_with_namespace } : {}) } : null
    };
    setSaving(true);
    try {
      const res = draft.id ? await notesApi.update(draft.id, payload) : await notesApi.create(payload);
      setDraft(draftOf(res.note));
      setDirty(false);
      showToast(draft.id ? 'Note saved' : `${res.note.kind === 'task' ? 'Task' : 'Note'} created`);
      await load();
    } catch (err) {
      reportError('Could not save the note', err);
    } finally {
      setSaving(false);
    }
  };

  const toggleDone = async (note: Note) => {
    try {
      const res = await notesApi.update(note.id, { status: note.status === 'done' ? 'open' : 'done' });
      replaceNote(res.note);
      if (filter.status) await load();
    } catch (err) {
      reportError('Could not update the task', err);
    }
  };

  const remove = async () => {
    if (!draft?.id || !window.confirm('Delete this note and its comments?')) return;
    try {
      await notesApi.remove(draft.id);
      setDraft(null);
      setDirty(false);
      showToast('Note deleted');
      await load();
    } catch (err) {
      reportError('Could not delete the note', err);
    }
  };

  const addComment = async () => {
    if (!selected || !comment.trim()) return;
    try {
      replaceNote((await notesApi.addComment(selected.id, comment)).note);
      setComment('');
    } catch (err) {
      reportError('Could not add the comment', err);
    }
  };

  const saveComment = async () => {
    if (!selected || !editingComment || !editingComment.body.trim()) return;
    try {
      replaceNote((await notesApi.updateComment(selected.id, editingComment.id, editingComment.body)).note);
      setEditingComment(null);
    } catch (err) {
      reportError('Could not update the comment', err);
    }
  };

  const deleteComment = async (commentId: string) => {
    if (!selected || !window.confirm('Delete this comment?')) return;
    try {
      replaceNote((await notesApi.deleteComment(selected.id, commentId)).note);
    } catch (err) {
      reportError('Could not delete the comment', err);
    }
  };

  const migrate = async (options: NoteMigrateOptions) => {
    if (!selected) return;
    try {
      const res = await notesApi.migrate(selected.id, options);
      setMigrating(false);
      showToast(`Created issue #${res.work_item.iid}${res.deleted ? ' and deleted the note' : ''}`);
      if (res.note) {
        setDraft(draftOf(res.note));
      } else {
        setDraft(null);
      }
      setDirty(false);
      await load();
    } catch (err) {
      reportError('Could not migrate the note', err);
    }
  };

  const exportZip = async () => {
    try {
      const { blob, filename } = await notesApi.exportZip();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      reportError('Could not export notes', err);
    }
  };

  const selectClass = `${inputClass} py-1.5`;

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-zinc-950 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 bg-zinc-900/40 border-b border-zinc-800 text-xs">
        <span className="text-zinc-400 font-mono flex items-center gap-2">
          <NotebookPen className="w-3.5 h-3.5 text-orange-400" />
          Notes
          <span className="text-zinc-600">·</span>
          <span className="tabular-nums">{notes.length} shown</span>
          {namespace === 'demo' && (
            <span className="px-1.5 py-0.5 rounded border border-amber-800/60 bg-amber-950/40 text-amber-300 text-[10px] uppercase tracking-wide">
              demo list
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => startNew('note')}
            className="px-3 py-1.5 font-semibold text-white bg-orange-600 hover:bg-orange-500 rounded-md flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Note</span>
          </button>
          <button
            onClick={() => startNew('task')}
            className="px-3 py-1.5 font-semibold text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-md flex items-center gap-1.5"
          >
            <CheckSquare className="w-3.5 h-3.5" />
            <span>Task</span>
          </button>
          <button
            onClick={exportZip}
            className="px-3 py-1.5 font-semibold text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-md flex items-center gap-1.5"
            title="Download every note as Markdown files in a .zip"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export .zip</span>
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1.5 font-semibold text-zinc-200 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-60 rounded-md flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* List and filters */}
        <aside className="w-full max-w-sm border-r border-zinc-800 flex flex-col min-h-0">
          <div className="p-3 space-y-2 border-b border-zinc-800">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search notes and comments"
                className={`w-full pl-8 ${inputClass} py-1.5`}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <select
                value={filter.kind ?? ''}
                onChange={(e) => setFilter((f) => ({ ...f, kind: (e.target.value || undefined) as NoteKind | undefined }))}
                className={selectClass}
                aria-label="Kind"
              >
                <option value="">All kinds</option>
                <option value="note">Notes</option>
                <option value="task">Tasks</option>
              </select>
              <select
                value={filter.status ?? ''}
                onChange={(e) => setFilter((f) => ({ ...f, status: (e.target.value || undefined) as NoteStatus | undefined }))}
                className={selectClass}
                aria-label="Status"
              >
                <option value="">Any status</option>
                <option value="open">Open</option>
                <option value="done">Done</option>
                <option value="migrated">Migrated</option>
              </select>
              <select
                value={filter.tag ?? ''}
                onChange={(e) => setFilter((f) => ({ ...f, tag: e.target.value || undefined }))}
                className={selectClass}
                aria-label="Tag"
              >
                <option value="">Any tag</option>
                {allTags.map((t) => (
                  <option key={t} value={t}>
                    #{t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <ul className="flex-1 overflow-y-auto divide-y divide-zinc-800/70">
            {notes.length === 0 && !loading && <li className="px-4 py-4 text-xs text-zinc-500">No notes match.</li>}
            {notes.map((note) => (
              <li
                key={note.id}
                onClick={() => open(note)}
                className={`flex items-start gap-2.5 px-4 py-3 cursor-pointer transition-colors ${
                  draft?.id === note.id ? 'bg-zinc-900' : 'hover:bg-zinc-900/60'
                }`}
              >
                {note.kind === 'task' ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (note.status !== 'migrated') toggleDone(note);
                    }}
                    disabled={note.status === 'migrated'}
                    className="mt-0.5 text-zinc-400 hover:text-emerald-300 disabled:opacity-50"
                    title={note.status === 'done' ? 'Mark open' : 'Mark done'}
                    aria-label={note.status === 'done' ? 'Mark open' : 'Mark done'}
                  >
                    {note.status === 'done' ? <CheckSquare className="w-4 h-4 text-emerald-400" /> : <Square className="w-4 h-4" />}
                  </button>
                ) : (
                  <StickyNote className="w-4 h-4 mt-0.5 text-orange-400 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${note.status === 'done' ? 'text-zinc-500 line-through' : 'text-zinc-100'}`} title={note.title}>
                    {note.title}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1 text-[11px] font-mono text-zinc-500 flex-wrap">
                    <span className={`px-1.5 py-px rounded border text-[10px] uppercase tracking-wide ${STATUS_BADGE[note.status]}`}>{note.status}</span>
                    {note.tags.map((t) => (
                      <span key={t}>#{t}</span>
                    ))}
                    {note.comments.length > 0 && (
                      <span className="flex items-center gap-0.5">
                        <MessageSquare className="w-3 h-3" />
                        {note.comments.length}
                      </span>
                    )}
                    <span className="ml-auto">{relativeTime(note.updated_at)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </aside>

        {/* Editor */}
        <section className="flex-1 min-w-0 overflow-y-auto">
          {!draft ? (
            <div className="h-full flex items-center justify-center p-6 text-xs text-zinc-500 text-center">
              Select a note, or start a new note or task. Notes are encrypted in the vault and stay out of GitLab until you
              migrate them.
            </div>
          ) : (
            <div className="p-6 space-y-4 max-w-4xl">
              {selected?.migrated && (
                <div className="p-3 rounded-lg border border-zinc-700 bg-zinc-900/60 text-xs text-zinc-300 flex items-center gap-2">
                  <ArrowUpRight className="w-4 h-4 text-orange-400 shrink-0" />
                  <span>
                    Migrated {relativeTime(selected.migrated.migrated_at)}. GitLab is the source of truth for this item.
                  </span>
                  <a
                    href={selected.migrated.web_url}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto flex items-center gap-1 text-orange-300 hover:text-orange-200 font-mono"
                  >
                    #{selected.migrated.iid}
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  value={draft.title}
                  onChange={(e) => edit({ title: e.target.value })}
                  placeholder={draft.kind === 'task' ? 'What needs doing?' : 'Title'}
                  maxLength={200}
                  disabled={readOnly}
                  className={`flex-1 ${inputClass} text-sm font-semibold`}
                />
                <select
                  value={draft.kind}
                  onChange={(e) => edit({ kind: e.target.value as NoteKind })}
                  disabled={readOnly}
                  className={selectClass}
                  aria-label="Kind"
                >
                  <option value="note">Note</option>
                  <option value="task">Task</option>
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <label className="block">
                  <span className="block text-zinc-400 font-medium mb-1">Tags (comma separated)</span>
                  <input
                    value={draft.tags}
                    onChange={(e) => edit({ tags: e.target.value })}
                    placeholder="ci, follow-up"
                    disabled={readOnly}
                    className={`w-full ${inputClass}`}
                  />
                </label>
                <label className="block">
                  <span className="block text-zinc-400 font-medium mb-1">Project (optional)</span>
                  <select
                    value={draft.projectId ?? ''}
                    onChange={(e) => edit({ projectId: e.target.value ? Number(e.target.value) : null })}
                    disabled={readOnly}
                    className={`w-full ${inputClass}`}
                  >
                    <option value="">No project</option>
                    {draft.projectId && !projects.some((p) => p.id === draft.projectId) && (
                      <option value={draft.projectId}>{selected?.project?.name ?? `Project ${draft.projectId}`}</option>
                    )}
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name_with_namespace || p.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {readOnly ? (
                <div className="p-3 border border-zinc-800 rounded-lg bg-zinc-950/60">
                  <Markdown text={draft.body || '*No content.*'} />
                </div>
              ) : (
                <MarkdownEditor
                  value={draft.body}
                  onChange={(body) => edit({ body })}
                  placeholder="Write in markdown…"
                  minHeight="220px"
                  allowAttachments={false}
                />
              )}

              <div className="flex flex-wrap items-center gap-2">
                {!readOnly && (
                  <button
                    onClick={save}
                    disabled={saving || !draft.title.trim() || (!dirty && Boolean(draft.id))}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 disabled:opacity-60 rounded-md flex items-center gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{draft.id ? 'Save' : 'Create'}</span>
                  </button>
                )}
                {selected && selected.kind === 'task' && !readOnly && (
                  <button
                    onClick={() => toggleDone(selected)}
                    className="px-3 py-1.5 text-xs font-semibold text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-md flex items-center gap-1.5"
                  >
                    {selected.status === 'done' ? <Square className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5" />}
                    <span>{selected.status === 'done' ? 'Reopen' : 'Mark done'}</span>
                  </button>
                )}
                {selected && !readOnly && (
                  <button
                    onClick={() => (dirty ? showToast('Save the note before migrating it') : setMigrating(true))}
                    className="px-3 py-1.5 text-xs font-semibold text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-md flex items-center gap-1.5"
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    <span>Migrate to GitLab</span>
                  </button>
                )}
                {draft.id && (
                  <button
                    onClick={remove}
                    className="ml-auto px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-950/50 rounded-md flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                )}
              </div>

              {selected && (
                <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden">
                  <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
                    <MessageSquare className="w-4 h-4 text-orange-400" />
                    <h2 className="text-sm font-semibold text-white">Comments</h2>
                    <span className="text-xs font-mono text-zinc-500 tabular-nums">({selected.comments.length})</span>
                    <span className="text-[11px] text-zinc-500 ml-auto hidden md:inline">A running log of what was tried</span>
                  </header>
                  <ul className="divide-y divide-zinc-800/70">
                    {selected.comments.map((c) => (
                      <li key={c.id} className="px-4 py-3 space-y-2">
                        <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-500">
                          <span title={c.created_at}>{relativeTime(c.created_at)}</span>
                          {c.updated_at !== c.created_at && <span>(edited)</span>}
                          <div className="ml-auto flex items-center gap-1">
                            <button
                              onClick={() => setEditingComment({ id: c.id, body: c.body })}
                              className="p-1 rounded hover:bg-zinc-800 hover:text-zinc-200"
                              title="Edit comment"
                              aria-label="Edit comment"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => deleteComment(c.id)}
                              className="p-1 rounded hover:bg-zinc-800 hover:text-rose-300"
                              title="Delete comment"
                              aria-label="Delete comment"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        {editingComment?.id === c.id ? (
                          <div className="space-y-2">
                            <textarea
                              value={editingComment.body}
                              onChange={(e) => setEditingComment({ id: c.id, body: e.target.value })}
                              className={`w-full min-h-[80px] font-mono ${inputClass}`}
                            />
                            <div className="flex gap-2">
                              <button onClick={saveComment} className="px-3 py-1 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 rounded-md">
                                Save
                              </button>
                              <button onClick={() => setEditingComment(null)} className="px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800 rounded-md">
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <Markdown text={c.body} />
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="p-3 border-t border-zinc-800 space-y-2">
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Add a comment (markdown)"
                      className={`w-full min-h-[70px] font-mono ${inputClass}`}
                    />
                    <button
                      onClick={addComment}
                      disabled={!comment.trim()}
                      className="px-3 py-1.5 text-xs font-semibold text-zinc-200 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-60 rounded-md"
                    >
                      Add comment
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {migrating && selected && (
        <MigrateDialog note={selected} projects={projects} onClose={() => setMigrating(false)} onMigrate={migrate} />
      )}
    </div>
  );
};
