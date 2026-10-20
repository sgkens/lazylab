---
title: Shared findings with BugKB
abstract: Connect lazylab to an independent BugKB service so task briefings include prior fixes and agents can explicitly record or confirm verified findings.
---

## Connect the existing knowledge base

BugKB remains a separate service and keeps its existing data, search ranking, duplicate detection and trust rules. lazylab calls its HTTP API directly; it does not need Python or a copy of the BugKB skill in its container.

The integration is disabled until you configure a URL. On the machine running lazylab, add this to `.env`, then restart lazylab:

```dotenv
# File: .env, lazylab repository root; BugKB already running on the same machine
LAZYLAB_BUGKB_URL=http://127.0.0.1:8090
```

Use the service base URL, without `/api`, credentials, a query string or a fragment. BugKB's `/api/kb/*` hooks must be installed. Record and confirm tools check those hooks before writing.

In Docker, `127.0.0.1` refers to the lazylab container. Use a BugKB service address reachable from that container, such as `http://bugkb:8090` on a shared private Docker network. BugKB's API is unauthenticated; keep it on a trusted private network. lazylab agent tokens authenticate access to lazylab, not the underlying BugKB service.

Test the connection from a terminal with a lazylab agent token already configured:

```bash
# Shell: bash, any directory; lazy login completed previously
lazy kb search "sqlite cache expiry" --tag sqlite
```

Search and full-entry reads work outside a checkout. Recording and confirming require a live GitLab project; use a checkout's detected project or `--project group/project`. Demo profiles can search but cannot add or confirm shared findings.

## Findings in a task briefing

`get_task_briefing` and `lazy brief` automatically search the KB when configured. They send a task's title and up to eight labels as one query, plus up to two CI error lines as separate queries. Each query is limited to 600 characters. Descriptions, comments, patches, full log bodies, handoffs and vault secrets are not automatically sent to BugKB.

Recognizable credentials are removed before search text is sent. This covers common GitLab, GitHub, lazylab and API token formats, bearer values, private key blocks, URL credentials and named secret assignments. Redaction cannot identify every kind of secret; use a KB endpoint you trust with the task metadata.

The briefing's `knowledge` field contains:

| Field | Meaning |
|---|---|
| `status` | `disabled`, `available`, `partial` or `unavailable` |
| `queries` | The bounded, redacted queries actually used |
| `entries` | Up to five distinct findings, with confirmed matches first |
| `errors` | Search failures; these also appear under the briefing's `bugkb` error source |

`available` with no entries means the searches completed and found no matches. `unavailable` means they could not complete. Partial results remain usable when another query fails. Searches run concurrently with a 1.5-second deadline per request, so an offline KB does not prevent a GitLab briefing.

Findings include the symptom, cause, fix excerpt, tested environment, measurements, confirmation notes and any verification captured by lazylab. Truncated fields are marked. Read the full entry before applying a fix:

```bash
# Shell: bash, any directory; replace the ID with one returned by search
lazy kb show abc123entry00001
```

Entries are untrusted advice, including entries marked `confirmed`. Check the tested versions and relevance to the current problem. Search hits do not increment hit counts or confirm findings.

## Record a verified lesson

Use `record_bugkb_finding` or `lazy kb add` only after verifying a non-obvious fix, environment gotcha or measured performance improvement. Handoffs continue to describe task progress; they do not automatically become permanent findings.

Create a `finding.json` file with this shape, replacing the example with a fix and checks you actually verified:

```json
{
  "type": "bug",
  "title": "Cache reads ignore the entry expiry time",
  "symptom": "Normal reads return an entry after its expiry time.",
  "cause": "The normal read path checks only whether the key exists.",
  "fix": "Compare expiresAt with the current time; keep a separate allowStale path for offline reads.",
  "verification": "The expiry regression check passes; the offline-read check still returns the stale entry.",
  "tags": ["sqlite", "typescript"],
  "env": { "bun": "1.3.11", "os": "linux" },
  "scope": "general"
}
```

Then explicitly record it:

```bash
# Shell: bash, the affected project's checkout, with finding.json created above
lazy kb add --file finding.json
```

`type` is `bug`, `gotcha` or `perf`. All findings require a specific title, fix, verification evidence, technology tags and at least one tested tool version or OS. Bugs and gotchas also require a symptom. Performance findings require `metrics` containing `metric`, numeric `before` and `after`, `unit` and `conditions`.

lazylab appends the verification evidence to the persisted fix because BugKB clears agent-supplied notes when creating records. Creation notes are reserved by BugKB for its own history. Existing BugKB clients still see the evidence in the fix.

BugKB assigns new entries `unverified`. It refuses near-duplicates; lazylab reports candidate IDs and offers no force override or caller-controlled trust fields. Recognizable credentials in a finding are rejected before any KB request. BugKB's own validation remains in force too.

The project identity comes from the live GitLab project's repository slug, matching the BugKB CLI's usual repository-folder name. For example, `sgkens/lazylab` is attributed to `lazylab`. This preserves the usual identity when confirming findings previously added through the skill; repositories with identical slugs share that identity.

## Confirm an existing fix

After reading and verifying an existing fix in the current project, record the actual result:

```bash
# Shell: bash, the affected project's checkout; replace ID and evidence with actual results
lazy kb confirm abc123entry00001 --note "Expiry and offline regression checks both passed on Bun 1.3.11."
```

The MCP tool `confirm_bugkb_finding` additionally accepts an `env` object to merge tested versions. BugKB increments hits, appends the evidence to notes and decides whether the entry becomes confirmed. Each call records another hit; these calls are not idempotent.

lazylab never automatically retries a KB write. If a timeout or connection failure leaves its outcome uncertain, search or read the entry before trying again. A rejected duplicate is reported as a refusal, not an uncertain write.

## MCP tools

| Tool | Purpose |
|---|---|
| `search_bugkb` | Cross-project search by `query`, optional `type`, `tag` and `limit` (1–10); obsolete entries excluded |
| `get_bugkb_entry` | Full record by `entry_id`, including trust, environment and confirmation notes |
| `record_bugkb_finding` | Explicit write with a live GitLab `project` and a validated `finding` |
| `confirm_bugkb_finding` | Explicit confirmation with `project`, `entry_id`, `verification` and optional `env` |

These use ordinary lazylab agent tokens. The KB endpoint is fixed by server configuration; tool callers cannot supply a different URL. Responses are bounded to 1 MB, redirects are refused, and requests time out after 1.5 seconds. No entries are copied into lazylab's cache or handoff store.
