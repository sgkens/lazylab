---
title: REST API
abstract: The agent REST API at /api/agent gives scripts and agents without MCP the same operations, authenticated with an agent token.
---

## Authentication

Every request sends `Authorization: Bearer $LAZYLAB_TOKEN`, a token from **Vault → Agent tokens**. Bodies are JSON. Responses are `{"success": true, …}` or `{"success": false, "error": "…"}` with a 4xx or 5xx status.

| Status | Meaning |
|---|---|
| `401` | Missing, invalid or revoked token |
| `423` | The vault is locked; sign in to lazylab in a browser |
| `400` | A required field is missing or invalid, for example `projectId` |
| `404` | The item does not exist on the active GitLab profile |

Every work item, merge request, pipeline and job route needs `projectId`, the numeric GitLab project id, in the query string for reads and in the body (or query string) for writes. Without it the server answers `400 projectId is required`; it does not guess a project. The inbox and watches routes are not tied to one project.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/agent/inbox` | What needs the user, with `bucket`, `reason`, `web_url` |
| GET | `/api/agent/watches` | Active watches |
| POST | `/api/agent/watches` | Watch `{kind: pipeline\|job\|merge_request, projectId, targetId}` |
| POST | `/api/agent/pipelines` | Run `{projectId, ref, variables?: [{key, value, variable_type?}], watch?: true}` |
| GET | `/api/agent/pipelines/:id/failures?projectId=` | Failure excerpt per failed job |
| GET | `/api/agent/jobs/:id/failure?projectId=` | Failure excerpt for one job |
| GET | `/api/agent/work-items?projectId=&state=` | List issues (first 50) |
| GET | `/api/agent/work-items/:iid?projectId=` | One issue with notes |
| POST | `/api/agent/work-items` | Create `{projectId, title, description?, labels?, assignee_ids?, issue_type?, weight?, milestone_id?}` |
| PUT, PATCH | `/api/agent/work-items/:iid` | Update title, description, labels, `add_labels`, `remove_labels`, assignees, milestone, `state_event` |
| GET | `/api/agent/merge-requests?projectId=&state=` | List MRs (first 50) |
| GET | `/api/agent/merge-requests/:iid?projectId=` | One MR with notes |
| POST | `/api/agent/merge-requests` | Create `{projectId, title, source_branch, target_branch?, description?, labels?}` |
| PUT, PATCH | `/api/agent/merge-requests/:iid` | Update title, description, labels, `draft`, `state_event` |
| GET | `/api/agent/docs` | Machine-readable endpoint list |
| GET | `/api/agent/skill.md` | The agent skill as Markdown |

## Examples

Shell: bash, with `LAZYLAB_URL` and `LAZYLAB_TOKEN` exported.

```bash
# What needs me?
curl -s -H "Authorization: Bearer $LAZYLAB_TOKEN" "$LAZYLAB_URL/api/agent/inbox"

# Why did pipeline 456 fail?
curl -s -H "Authorization: Bearer $LAZYLAB_TOKEN" \
  "$LAZYLAB_URL/api/agent/pipelines/456/failures?projectId=123"

# Run a pipeline and get a notification when it finishes
curl -s -X POST "$LAZYLAB_URL/api/agent/pipelines" \
  -H "Authorization: Bearer $LAZYLAB_TOKEN" -H "Content-Type: application/json" \
  -d '{"projectId": 123, "ref": "main", "variables": [{"key": "DEPLOY_ENV", "value": "staging"}]}'

# File an issue
curl -s -X POST "$LAZYLAB_URL/api/agent/work-items" \
  -H "Authorization: Bearer $LAZYLAB_TOKEN" -H "Content-Type: application/json" \
  -d '{"projectId": 123, "title": "[cache] Expire entries on TTL", "description": "### Summary\nEntries never expire.", "labels": ["backend"]}'
```

## From the browser

The same routes accept a signed-in browser session. **Agent API → Try it** in the UI sends a create request this way, against a project you choose.
