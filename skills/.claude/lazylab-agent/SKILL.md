---
name: lazylab-agent
description: Create, read and update GitLab work items (issues) and merge requests through a lazylab instance's /api/agent REST API, authenticated with a bearer agent token. Use when asked to file, update, close or reopen a GitLab issue or merge request, or to read their details and comments, and lazylab is running.
---

# lazylab agent API

Calls the lazylab REST API to manage GitLab work items and merge requests. lazylab holds the GitLab token in its encrypted vault; agents authenticate to lazylab with their own bearer token.

## MCP or REST

If the `lazylab` MCP server is connected (tools such as `get_inbox`, `get_pipeline_failures`, `run_pipeline`), use those tools and skip the curl calls below. The writing rules still apply. Use this REST API from scripts or when MCP is not configured.

## Preconditions

- Two environment variables:
  - `LAZYLAB_URL`: base URL, e.g. `https://desktop.tailnet.ts.net` or `http://localhost:3000`.
  - `LAZYLAB_TOKEN`: an agent token (`llab_…`) created in lazylab under Vault → Agent tokens. If it is missing, ask the user to create one. Never print it.
- Every request sends `Authorization: Bearer $LAZYLAB_TOKEN`.
- Status codes:
  - `401` means the token is invalid or revoked.
  - `423` means the vault is locked (server restarted and nobody has signed in yet). Ask the user to sign in to lazylab in a browser; do not retry in a loop.
- Always pass `projectId` explicitly. When omitted, the server falls back to the first project in the list, which is rarely the one intended. List work items for a known project, or ask the user for the ID.
- If the response's work items look like sample data (project `gitlab-orchestrator`, user `alex.dev`), lazylab is in demo mode: writes go to in-memory data and are lost on restart. Tell the user before writing.

## Writing rules

- Plain technical English. No filler or marketing words.
- Titles are imperative and scoped, e.g. `[cache] Expire entries on TTL`.
- Work item body sections, in order:
  1. `### Summary` one or two sentences stating the problem or goal.
  2. `### What changed` bullet list (omit when filing a new problem).
  3. `### Acceptance criteria` `- [ ]` checklist. lazylab renders these lines as subtasks.
- Merge request body sections: `### Overview`, `### Changes`, `### Verification`.

## Endpoints

Base URL: `$LAZYLAB_URL/api/agent`. All bodies are `application/json`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/watches` | Active watches for the current GitLab profile |
| POST | `/watches` | Watch a `pipeline`, `job` or `merge_request`. Body: `kind`, `projectId`, `targetId` (pipeline id, job id or MR iid). The user is notified when it finishes; use this after pushing instead of polling |
| POST | `/pipelines` | Run a pipeline. Required: `ref`. Optional: `projectId`, `variables[]` (`key`, `value`, `variable_type`: `env_var`\|`file`), `watch` (default `true`, so the user is notified when it finishes) |
| GET | `/pipelines/:pipelineId/failures?projectId=` | Why a pipeline failed: for each failed job (allowed failures excluded), `excerpt` with `errorLine`, `exitCode`, `failureReason`, `retryable` and the failing log `lines[]`. Read this before opening a full job log |
| GET | `/jobs/:jobId/failure?projectId=` | The same excerpt for one job |
| GET | `/inbox` | What needs the user across projects: `items[]` with `bucket` (`action`\|`waiting`\|`assigned`), `reason`, `kind`, `web_url`; plus `counts` and `errors[]`. Start here when asked what to work on |
| GET | `/work-items?projectId=&state=opened\|closed\|all` | List work items (first 50) |
| GET | `/work-items/:iid?projectId=` | One work item plus notes |
| POST | `/work-items` | Create. Required: `title`. Optional: `projectId`, `description`, `labels[]`, `assignee_ids[]`, `issue_type`, `weight`, `milestone_id` |
| PUT/PATCH | `/work-items/:iid` | Update. Optional: `projectId`, `title`, `description`, `labels[]`, `add_labels[]`, `remove_labels[]`, `assignee_ids[]`, `milestone_id`, `state_event` (`close`\|`reopen`) |
| GET | `/merge-requests?projectId=&state=opened\|closed\|merged\|all` | List merge requests (first 50) |
| GET | `/merge-requests/:iid?projectId=` | One merge request plus notes |
| POST | `/merge-requests` | Create. Required: `title`, `source_branch`. Optional: `projectId`, `target_branch` (default `main`), `description`, `labels[]`, `assignee_ids[]` |
| PUT/PATCH | `/merge-requests/:iid` | Update. Optional: `projectId`, `title`, `description`, `labels[]`, `state_event` |

Responses are `{ "success": true, ... }` or `{ "success": false, "error": "..." }` with a 4xx/5xx status.

Known limits (see `devtracker-pending.md` in the lazylab repo):
- `GET /:iid` only finds items within the first 50 returned by the list call.
- `draft` on merge request update is ignored against a real GitLab instance; prefix the title with `Draft: ` instead.

## Examples

Shell: bash, with `LAZYLAB_URL` and `LAZYLAB_TOKEN` exported. Add `-k` to curl only if the user confirms lazylab uses its self-signed certificate.

```bash
# Create a work item
curl -s -X POST "$LAZYLAB_URL/api/agent/work-items" \
  -H "Authorization: Bearer $LAZYLAB_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "projectId": 123,
    "title": "[cache] Expire entries on TTL",
    "description": "### Summary\nCache entries never expire; stale data is served until a forced refresh.\n\n### Acceptance criteria\n- [ ] get() ignores entries past expiresAt\n- [ ] Expired entries are purged on checkpoint",
    "labels": ["backend", "cache"]
  }'

# Close it
curl -s -X PATCH "$LAZYLAB_URL/api/agent/work-items/42" \
  -H "Authorization: Bearer $LAZYLAB_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{ "projectId": 123, "state_event": "close" }'

# Open a merge request
curl -s -X POST "$LAZYLAB_URL/api/agent/merge-requests" \
  -H "Authorization: Bearer $LAZYLAB_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "projectId": 123,
    "title": "[cache] Expire entries on TTL",
    "description": "### Overview\nHonour expiresAt in cacheDb.get().\n\n### Changes\n- Check expiry before returning cached data\n\n### Verification\n- bun run lint",
    "source_branch": "fix/cache-ttl",
    "target_branch": "develop"
  }'
```
