/** Mirrors server/notes.ts. */
export type NoteKind = 'note' | 'task';
export type NoteStatus = 'open' | 'done' | 'migrated';
export type NoteNamespace = 'live' | 'demo';

export interface NoteComment {
  id: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  namespace: NoteNamespace;
  kind: NoteKind;
  title: string;
  body: string;
  status: NoteStatus;
  tags: string[];
  project: { project_id: number; name?: string } | null;
  migrated: { project_id: number; iid: number; web_url: string; migrated_at: string } | null;
  comments: NoteComment[];
  created_at: string;
  updated_at: string;
}

export interface NoteInput {
  kind?: NoteKind;
  title?: string;
  body?: string;
  status?: 'open' | 'done';
  tags?: string[];
  project?: { project_id: number; name?: string } | null;
}

export interface NoteFilter {
  kind?: NoteKind;
  status?: NoteStatus;
  tag?: string;
  q?: string;
}

export interface NoteMigrateOptions {
  project_id: number;
  mode: 'mark' | 'delete';
  issue_type?: 'issue' | 'task';
  labels_from_tags?: boolean;
}
