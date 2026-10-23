/**
 * /api/notes/* — personal notes and tasks. Mounted behind apiGuard (session required).
 * The namespace follows the GitLab client: demo mode reads and writes a separate demo list.
 */
import { Request, Response, Router } from 'express';
import { GitLabClient } from './gitlabClient.js';
import { exportFileNames, migrationDescription, Note, NoteNamespace, noteToMarkdown, parseNoteFilter } from './notes.js';
import { vault, VaultLockedError } from './vault.js';
import { createZip } from './zip.js';

export const namespaceFor = (client: GitLabClient): NoteNamespace => (client.isDemo() ? 'demo' : 'live');

export interface MigrateOptions {
  project_id: number;
  /** `mark` keeps the note with status migrated and a link; `delete` removes it once the issue exists. */
  mode: 'mark' | 'delete';
  issue_type?: 'issue' | 'task';
  /** Send the note's tags as GitLab labels; GitLab creates labels that do not exist. */
  labels_from_tags?: boolean;
}

export function parseMigrateOptions(input: unknown): MigrateOptions {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('migrate options must be an object');
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!['project_id', 'mode', 'issue_type', 'labels_from_tags'].includes(key)) throw new Error(`unknown migrate option "${key}"`);
  }
  const projectId = typeof raw.project_id === 'string' && /^\d+$/.test(raw.project_id) ? Number(raw.project_id) : raw.project_id;
  if (!Number.isSafeInteger(projectId) || (projectId as number) <= 0) throw new Error('project_id must be a positive integer');
  if (raw.mode !== 'mark' && raw.mode !== 'delete') throw new Error('mode must be mark or delete');
  if (raw.issue_type !== undefined && raw.issue_type !== 'issue' && raw.issue_type !== 'task') throw new Error('issue_type must be issue or task');
  if (raw.labels_from_tags !== undefined && typeof raw.labels_from_tags !== 'boolean') throw new Error('labels_from_tags must be a boolean');
  return {
    project_id: projectId as number,
    mode: raw.mode,
    ...(raw.issue_type ? { issue_type: raw.issue_type as 'issue' | 'task' } : {}),
    ...(raw.labels_from_tags !== undefined ? { labels_from_tags: raw.labels_from_tags as boolean } : {})
  };
}

/** The issue exists but the note could not be updated. */
export class PartialMigrationError extends Error {}
export class MigrationInProgressError extends Error {}

// Two clicks (or a UI and an agent) must not file the same note twice.
const migrating = new Set<string>();

/**
 * Creates a GitLab issue from the note, then marks the note migrated or deletes it. The issue is created
 * first: if the vault write fails afterwards, the error names the issue so the note can be cleaned up by hand.
 */
export async function migrateNote(client: GitLabClient, id: string, input: unknown) {
  const ns = namespaceFor(client);
  const options = parseMigrateOptions(input);
  const note = vault.getNote(ns, id);
  if (note.status === 'migrated') throw new Error(`Note was already migrated to ${note.migrated?.web_url ?? 'GitLab'}`);
  const key = `${ns}:${note.id}`;
  if (migrating.has(key)) throw new MigrationInProgressError('This note is already being migrated');
  migrating.add(key);
  try {
    // The demo client falls back to its first project for unknown ids; refuse instead of filing it elsewhere.
    if (client.isDemo() && !(await client.getProjects()).some((p) => p.id === options.project_id)) throw new Error('Project not found');
    const item = await client.createWorkItem(options.project_id, {
      title: note.title,
      description: migrationDescription(note),
      issue_type: options.issue_type ?? (note.kind === 'task' ? 'task' : 'issue'),
      labels: options.labels_from_tags ? note.tags : undefined
    });
    const link = { project_id: item.project_id, iid: item.iid, web_url: item.web_url };
    try {
      if (options.mode === 'delete') {
        vault.deleteNote(ns, id);
        return { work_item: link, note: null, deleted: true };
      }
      return { work_item: link, note: vault.markNoteMigrated(ns, id, link), deleted: false };
    } catch (err: any) {
      throw new PartialMigrationError(`Created ${item.web_url}, but could not update the note: ${err?.message || err}`);
    }
  } finally {
    migrating.delete(key);
  }
}

/** All notes in the namespace as a store-only ZIP of Markdown files with YAML front matter. */
export function exportNotesZip(notes: Note[]): Buffer {
  const ordered = [...notes].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const names = exportFileNames(ordered);
  return createZip(ordered.map((note, i) => ({
    name: `lazylab-notes/${names[i]}`,
    data: Buffer.from(noteToMarkdown(note), 'utf8'),
    modified: new Date(note.updated_at)
  })));
}

function fail(res: Response, err: any) {
  const message: string = err?.message || String(err);
  const status = err instanceof VaultLockedError ? 423
    : err instanceof PartialMigrationError ? 500
      : err instanceof MigrationInProgressError ? 409
        : /not found/i.test(message) ? 404 : 400;
  res.status(status).json({ success: false, error: message });
}

export function createNotesRouter(getClient: () => GitLabClient) {
  const router = Router();
  const ns = () => namespaceFor(getClient());

  router.get('/', (req: Request, res: Response) => {
    try {
      const namespace = ns();
      const all = vault.listNotes(namespace);
      const tags = [...new Set(all.flatMap((n) => n.tags))].sort();
      res.json({ success: true, namespace, tags, notes: vault.listNotes(namespace, parseNoteFilter(req.query as Record<string, unknown>)) });
    } catch (err) {
      fail(res, err);
    }
  });

  // Before /:id so "export" is not read as a note id.
  router.get('/export', (_req: Request, res: Response) => {
    try {
      const zip = exportNotesZip(vault.listNotes(ns()));
      const day = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="lazylab-notes-${day}.zip"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(zip);
    } catch (err) {
      fail(res, err);
    }
  });

  router.get('/:id', (req: Request, res: Response) => {
    try {
      res.json({ success: true, note: vault.getNote(ns(), req.params.id) });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post('/', (req: Request, res: Response) => {
    try {
      res.status(201).json({ success: true, note: vault.createNote(ns(), req.body) });
    } catch (err) {
      fail(res, err);
    }
  });

  router.patch('/:id', (req: Request, res: Response) => {
    try {
      res.json({ success: true, note: vault.updateNote(ns(), req.params.id, req.body) });
    } catch (err) {
      fail(res, err);
    }
  });

  router.delete('/:id', (req: Request, res: Response) => {
    try {
      vault.deleteNote(ns(), req.params.id);
      res.json({ success: true });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post('/:id/comments', (req: Request, res: Response) => {
    try {
      res.status(201).json({ success: true, note: vault.addNoteComment(ns(), req.params.id, req.body?.body) });
    } catch (err) {
      fail(res, err);
    }
  });

  router.patch('/:id/comments/:commentId', (req: Request, res: Response) => {
    try {
      res.json({ success: true, note: vault.updateNoteComment(ns(), req.params.id, req.params.commentId, req.body?.body) });
    } catch (err) {
      fail(res, err);
    }
  });

  router.delete('/:id/comments/:commentId', (req: Request, res: Response) => {
    try {
      res.json({ success: true, note: vault.deleteNoteComment(ns(), req.params.id, req.params.commentId) });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post('/:id/migrate', async (req: Request, res: Response) => {
    try {
      res.json({ success: true, ...(await migrateNote(getClient(), req.params.id, req.body)) });
    } catch (err) {
      fail(res, err);
    }
  });

  return router;
}
