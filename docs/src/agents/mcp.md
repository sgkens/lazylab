---
title: MCP server
abstract: lazylab serves the Model Context Protocol at /mcp so coding agents such as Claude Code and Codex can read your inbox, triage CI failures, run pipelines and file issues as tools.
---

## Connect Claude Code

1. In lazylab, open **Vault → Agent tokens** and create a token. The screen shows the commands below with the token and your URL filled in.
2. On the machine running Claude Code:

```bash
# Shell: bash, on the machine running Claude Code
claude mcp add --transport http lazylab https://desktop.tailnet.ts.net/mcp \
  --header "Authorization: Bearer llab_..."
```

Run `/mcp` inside Claude Code to check the connection.

## Connect Codex

Codex reads the token from an environment variable.

```toml
# ~/.codex/config.toml
[mcp_servers.lazylab]
url = "https://desktop.tailnet.ts.net/mcp"
bearer_token_env_var = "LAZYLAB_TOKEN"
```

```bash
# Shell: bash, shell profile on the machine running Codex
export LAZYLAB_TOKEN=llab_...
```

## Tools

Every tool that takes `project` accepts a numeric id or a full path such as `group/app`.

| Tool | Read-only | Does |
|---|---|---|
| `get_inbox` | yes | What needs the user across projects, with reasons |
| `list_projects` | yes | Member projects, most recently active first; `search` filters |
| `list_work_items` | yes | Issues in a project (`state`: opened, closed, all) |
| `get_work_item` | yes | One issue with description and comments |
| `create_work_item` | no | Create an issue, incident or task |
| `update_work_item` | no | Title, description, labels (replace, add, remove), close or reopen |
| `add_comment` | no | Comment on an issue or merge request |
| `list_merge_requests` | yes | MRs with pipeline and merge status |
| `get_merge_request` | yes | One MR with description, head pipeline and comments |
| `create_merge_request` | no | Open an MR from a pushed branch |
| `list_pipelines` | yes | Recent pipelines, optionally for one ref |
| `get_pipeline_failures` | yes | Error line, exit code, reason, retryable and log excerpt per failed job |
| `get_job_failure` | yes | The same for one job |
| `run_pipeline` | no | Start a pipeline with variables; watched by default |
| `retry_job` | no | Retry a failed job; the new job is watched |
| `watch` | no | Notify the user when a pipeline, job or MR finishes |
| `list_watches` | yes | Active watches |

Read-only tools carry `readOnlyHint`, so clients can allow them without asking each time. Results are compact JSON that keeps only the fields an agent uses.

On connect, the server sends short instructions:

- start with `get_inbox`;
- after pushing, use `watch` instead of polling;
- read `get_pipeline_failures` before any full log;
- follow the title and body formats for issues and MRs.

## A typical session

```text
you:    my pipeline on fix/eviction-deadlock failed, fix it
agent:  get_pipeline_failures(project: "infra/k8s-operator", pipeline_id: 30103)
        -> unit:concurrency, exit 1, "admission_test.go:88: fatal: deadlock detected ..."
agent:  (edits the code, commits, pushes)
agent:  run_pipeline(project: "infra/k8s-operator", ref: "fix/eviction-deadlock")
        -> pipeline 30107, watched
you:    (phone notification when it finishes)
```

## Protocol details

| Item | Value |
|---|---|
| Transport | Streamable HTTP, stateless: every request is a `POST /mcp` with one JSON-RPC message (or a batch for 2025-03-26 clients) and gets a JSON response |
| Protocol versions | 2025-06-18, 2025-03-26, 2024-11-05 |
| Auth | `Authorization: Bearer llab_…` (agent token); browser cookies are not accepted |
| Origin | A request with an `Origin` header naming another host gets `403` |
| Locked vault | `503` with a message; sign in to lazylab in a browser |
| `GET` / `DELETE /mcp` | `405`: no server-initiated stream and no sessions |
| Errors | Bad arguments and GitLab errors come back as tool results with `isError: true`, so the model can correct itself; unknown tools are JSON-RPC errors |

Test from a shell. Shell: bash, with `LAZYLAB_URL` and `LAZYLAB_TOKEN` exported.

```bash
curl -s -X POST "$LAZYLAB_URL/mcp" \
  -H "Authorization: Bearer $LAZYLAB_TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_inbox","arguments":{}}}'
```

## Certificates

Node-based clients reject self-signed certificates. See [Remote access → Agents on another machine](/remote-access/#agents-on-another-machine).
