---
title: Notes and tasks
abstract: Notes keep personal notes and tasks in lazylab's encrypted vault, outside any GitLab project, until you migrate one to a GitLab issue or export them all as Markdown files.
---

## What a note holds

Open **Plan → Notes** in the top bar. Each entry is a note or a task:

| Field | Values |
|---|---|
| Kind | `note` or `task`; tasks get a checkbox in the list |
| Title | 1 to 200 characters |
| Body | Markdown, up to 50,000 characters, edited with the same Write/Preview editor as work items |
| Status | `open`, `done` or `migrated` |
| Tags | Up to 20, each 1 to 40 letters, digits, `.`, `_`, `/` or `-`; stored in lower case |
| Project | Optional link to a project of the active GitLab profile; used as the default when migrating |
| Comments | Up to 100 per note, 10,000 characters each: a running log of what was tried |

The list filters by kind, status, tag and text. Text search covers titles, bodies, tags and comments. File attachments are not supported yet; the editor's attach control is hidden for notes.

## Storage and limits

Notes are part of the vault payload, encrypted with the same data key as GitLab tokens and agent handoffs (AES-256-GCM). They are readable only while the vault is unlocked, and every route requires a signed-in browser session. Older vaults gain an empty notes list on first unlock; nothing has to be migrated by hand.

Notes do not belong to a GitLab profile, so switching or deleting a profile leaves them in place. A project link records the project id and path from the profile that was active when you set it.

Notes written in demo mode (no active GitLab profile) go to a separate demo list, marked **demo list** in the view. Sample project links and demo issues therefore never mix with real ones. Activate a profile to see your other notes again.

lazylab keeps at most 1,000 notes per list, and one list's stored notes are limited to 5,000,000 characters, because the vault re-encrypts its whole payload on every write. When a limit is reached, the write is refused; export or delete notes to make room. A write that fails leaves the previous notes unchanged.

## Migrate a note to GitLab

**Migrate to GitLab** creates an issue from the note:

1. Pick the project (the linked project is preselected) and the type, issue or task.
2. Choose what happens to the note afterwards: keep it, marked `migrated` with a link to the issue, or delete it.
3. Optionally send the tags as labels. GitLab creates labels that do not exist in the project yet.

The issue title is the note's title. The description is the body, then a **Notes log** section with each comment and its timestamp, then a line saying when the note was created. Save edits before migrating; the dialog uses the saved note.

lazylab creates the issue first and updates the note second. If GitLab refuses the issue, the note is unchanged. In the rare case that the issue is created but the vault write fails, the error names the new issue's URL so that you can delete the note yourself. A note that is already migrated, or is being migrated, cannot be migrated again.

A migrated note is read-only in lazylab: GitLab is the source of truth from then on. You can still read, export or delete it.

## Export

**Export .zip** downloads `lazylab-notes-YYYY-MM-DD.zip` with every note in the current list, one Markdown file per note under `lazylab-notes/`. File names come from the title (`fix-the-cache.md`); repeated titles get `-2`, `-3` and so on. The archive is uncompressed and needs no extra software to open.

Each file starts with YAML front matter, followed by the title, the body and the comments:

```markdown
---
id: "5f0c1e2a-…"
title: "Fix the cache"
kind: task
status: migrated
tags: ["perf", "ci"]
project:
  id: 42
  name: "team/app"
migrated:
  project_id: 42
  iid: 17
  web_url: "https://gitlab.example.com/team/app/-/issues/17"
  migrated_at: "2026-10-23T09:12:00.000Z"
created_at: "2026-10-20T08:00:00.000Z"
updated_at: "2026-10-23T09:12:00.000Z"
---

# Fix the cache

Use conditional requests for pipelines.

## Comments

### 2026-10-21T10:30:00.000Z

Tried If-None-Match; GitLab returns 304.
```

The export is not encrypted. Store it as carefully as the notes themselves.

## From the terminal and agents

`lazy note` and four MCP tools use the same storage. They act on the list that matches the server's current mode.

```bash
# Shell: bash, any directory; needs `lazy login` first
lazy note add "Rotate the deploy token" --task --tag ops
lazy note add "Cache idea" --file notes.md --tag perf
lazy note list --status open
lazy note show 5f0c1e2a
lazy note done 5f0c1e2a
```

`show`, `done` and `reopen` accept the full id or a unique prefix of at least six characters; `list` prints the first eight.

| MCP tool | Does |
|---|---|
| `list_notes` | Notes with id, kind, status, title, tags and a body excerpt; filters by kind, status, tag and text |
| `get_note` | One note with its full body and comments |
| `add_note` | Jot down a note or task |
| `set_note_status` | Mark a note done or open again |

Agents cannot migrate, edit, comment on or delete notes; use the UI for those.

## REST routes

The UI uses these routes under `/api/notes`. They require a browser session, and writes need a same-origin `Origin` header; agent tokens are not accepted.

| Route | Does |
|---|---|
| `GET /api/notes?kind=&status=&tag=&q=` | List, newest change first, with all tags and the list name (`live` or `demo`) |
| `GET /api/notes/:id` | One note |
| `POST /api/notes` | Create from `kind`, `title`, `body`, `status`, `tags`, `project` |
| `PATCH /api/notes/:id` | Change any of those fields |
| `DELETE /api/notes/:id` | Delete |
| `POST /api/notes/:id/comments` | Append `{ "body": "…" }` |
| `PATCH /api/notes/:id/comments/:commentId` | Edit a comment |
| `DELETE /api/notes/:id/comments/:commentId` | Delete a comment |
| `POST /api/notes/:id/migrate` | `{ "project_id": 42, "mode": "mark" \| "delete", "issue_type": "issue" \| "task", "labels_from_tags": false }` |
| `GET /api/notes/export` | The ZIP described above |

Unknown fields are rejected. The server sets ids, timestamps, comments and the migration link; `status: "migrated"` cannot be set directly.
