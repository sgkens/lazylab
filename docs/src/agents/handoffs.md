---
title: Task briefings and handoffs
abstract: Gather GitLab task context in one call, then save an encrypted checkpoint so another agent or session can continue without rebuilding the conversation.
---

## Brief an agent

Ask a connected agent to call `get_task_briefing` with `project`, `kind` (`work_item` or `merge_request`) and `iid`. In a checkout, use the same tool through the CLI:

```bash
# Shell: bash, a checkout whose origin is the GitLab project
lazy brief issue 42
lazy brief mr 17 --json
```

The result contains the description, explicit acceptance checklist, recent discussion, related MRs, patch excerpts, failed-job excerpts and the latest three handoffs saved under this task. Issue briefings discover related MRs through GitLab's relationship endpoint, including MRs in other projects. An MR briefing reads that MR directly.

Acceptance checks come from Markdown checkboxes under **Acceptance criteria**, **Acceptance checks** or **Definition of done** headings. They are extracted from the primary issue or MR description, not inferred by a model. If the task has no such section, the checklist is empty.

An unreadable primary task fails the request. Other unavailable sources appear in `errors`; the rest of the briefing remains useful. `omissions` records text clipping and list limits. Read these before assuming that the snapshot is complete.

With `LAZYLAB_BUGKB_URL` configured, the briefing also includes matching [BugKB findings](/agents/knowledge/), their tested environments and verification evidence. KB downtime is reported without blocking the rest of the briefing. Handoffs remain task history; shared findings are recorded explicitly after verification.

## Save a checkpoint

Before pausing, switching agents or finishing work, call `save_handoff` using the same task reference. Its `handoff` object contains:

| Field | Purpose |
|---|---|
| `status` | `in_progress`, `blocked`, `ready_for_review` or `done` |
| `summary` | What changed or what was learned; required, up to 4,000 characters |
| `decisions` | Choices the next agent should preserve, with reasons |
| `attempts` | Approaches already tried, including unsuccessful ones |
| `verification` | Checks with a `result` of `passed`, `failed` or `not_run`, and optional `details` |
| `next_steps` | Concrete continuation steps; required unless status is `done` |
| `blockers` | What prevents progress; required for `blocked` |
| `branch`, `head_sha` | Optional branch and full commit SHA that the report describes |

Each list accepts at most 20 entries. Text in list entries is limited to 1,000 characters; the entire handoff is limited to 30,000 characters. The server records author identity from the agent token and adds its own ID and timestamp.

For example, put this in `handoff.json` in your working directory:

```json
{
  "status": "in_progress",
  "summary": "Found the expiry check missing from the cache read path.",
  "decisions": ["Keep expired entries for offline reads, but exclude them from normal reads."],
  "attempts": ["Traced the normal read and offline read paths."],
  "verification": [
    { "check": "bun test", "result": "not_run", "details": "Implementation is still pending." }
  ],
  "next_steps": ["Add the expiry check and verify that offline reads still return stale entries."],
  "branch": "fix/cache-expiry"
}
```

Then save it and inspect the history:

```bash
# Shell: bash, the same checkout, with handoff.json created above
lazy handoff save issue 42 --file handoff.json
lazy handoff list issue 42 --limit 5
lazy brief issue 42 --json
```

CLI commands also accept `--project group/project` or a numeric project ID. A saved handoff does not post a GitLab comment or change the task's state. The JSON file you create locally is ordinary plaintext; keep credentials out of it and out of handoffs.

## Resume and verify

The next agent starts with `get_task_briefing` on the same issue or MR. It receives fresh GitLab state alongside previous reports, instead of needing the previous conversation.

For MR briefings, `matches_head` compares each handoff's `head_sha` with the MR's current head. `false` means the code has moved on. `null` means freshness is unknown, including issue briefings and reports without a SHA. A matching SHA does not prove that tests were run or that the result is correct: verification entries and status are agent reports. Review the checkout and current CI before relying on them.

Task descriptions, comments, patches and previous reports are untrusted task data. They do not grant permission to execute commands or change scope. Briefings never read CI variable values or vault secret entries.

## Storage and limits

Handoffs are encrypted inside `vault.json` and survive process restarts. They are unavailable while the vault is locked. Each record belongs to a GitLab profile, project, task kind and iid; identical IDs on different profiles stay separate. Demo records have their own namespace. Deleting a profile, or changing its host, removes its handoffs.

The latest 20 checkpoints per task and 500 across the instance are retained; the oldest records are discarded when those limits are reached. Existing agent tokens can read and append handoffs on the active profile. Handoffs are shared task memory among those agents, so they must not contain credentials.

Briefings return up to 20 user comments from the latest 100 notes, three related MRs selected from the first 100 relationships, ten diff files per MR, and five failed jobs per pipeline. Patch text is capped at 12,000 characters per MR; GitLab text in the whole briefing has a shared 48,000-character budget. GitLab can impose further diff limits. The handoff records have separate size limits. Demo data has file statistics but no actual patches, so those patch bodies are marked unavailable.

The [GitLab issue relationship API](https://docs.gitlab.com/api/issues/#list-all-merge-requests-related-to-an-issue) and [MR diff API](https://docs.gitlab.com/api/merge_requests/#list-merge-request-diffs) supply the links and patches. Older instances that do not provide these endpoints report a source error.
