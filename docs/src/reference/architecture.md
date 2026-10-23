---
title: Architecture
abstract: lazylab is one Bun process running Express, serving a React single-page app and an API that talks to GitLab with the token of the active vault profile.
---

## Components

```mermaid
flowchart TB
  subgraph Browser
    SPA[React 19 SPA<br/>src/]
  end
  subgraph Agents
    MCPC[MCP client]
    REST[curl / scripts]
  end
  subgraph Server["server.ts (Express on Bun)"]
    SES[session.ts<br/>login, cookies, origin check, agent auth]
    API[apiRouter.ts<br/>/api/*, SSE /api/events, /api/agent/*]
    VR[vaultRouter.ts<br/>/api/vault/*]
    NR[notifyRouter.ts<br/>/api/notify/*]
    MCP[mcp.ts<br/>/mcp]
    GC[gitlabClient.ts<br/>REST v4 + GraphQL, demo data]
    INB[inbox.ts]
    W[watch.ts<br/>poller + rules]
    N[notify.ts<br/>ntfy, Gotify, webhook]
    TRI[triage.ts<br/>failure excerpt]
    RN[releaseNotes.ts]
    V[vault.ts]
    C[cacheDb.ts]
  end
  SPA --> SES --> API & VR & NR
  MCPC --> MCP
  REST --> SES
  API --> GC & INB & TRI & RN
  MCP --> GC & INB & W
  INB --> GC
  W --> GC & N
  GC --> C
  VR & NR & W --> V
  GC -->|HTTPS| GL[(GitLab)]
  N -->|HTTPS| PUSH[(push services)]
```

## Request path

```mermaid
sequenceDiagram
  participant B as Browser
  participant S as session.ts
  participant A as apiRouter.ts
  participant G as GitLabClient
  participant C as cacheDb
  participant L as GitLab
  B->>S: GET /api/work_items (cookie)
  S->>S: session valid, vault unlocked
  S->>A: next()
  A->>G: getWorkItems(projectId)
  G->>C: get("work_items:42")
  alt fresh in cache
    C-->>G: cached rows
  else missing or expired
    G->>L: GET /projects/42/issues
    L-->>G: issues + RateLimit headers
    G->>C: set(..., ttl)
  end
  G-->>A: mapped items
  A-->>B: JSON
```

- **Cache:** `bun:sqlite` in WAL mode at `lazylab_cache.sqlite`; each write is one row, and only recently used entries are held in memory. An append-only journal (`lazylab_journal.jsonl`) records changes. Entries have a TTL. Expired entries can still be read with `allowStale`. A database written by earlier versions (sql.js) opens as is; an unreadable file is moved aside and the cache starts empty.
- **All projects:** GitLab has no instance-wide list for pipelines, milestones, labels or packages. lazylab fans out over the 15 most recently active member projects, 4 requests at a time.
- **Live updates:** an auto-fetch timer (30 s by default) refreshes data. It pushes Server-Sent Events (`sync_completed`, `inbox_updated`, `notification`, `watches_changed`) to open browsers.

## Watch loop

```mermaid
sequenceDiagram
  participant T as 15 s timer
  participant W as watchManager
  participant G as GitLabClient
  participant N as notify
  T->>W: pollAll()
  loop each watch of the active profile
    W->>G: getPipeline / getJob / getMergeRequest
    W->>W: evaluateWatch(prev, cur)
    opt failure
      W->>G: getPipelineFailures (error line)
    end
    W->>N: notify()
    N-->>N: SSE to browsers, POST to channels
  end
```

`evaluateWatch` is a pure function, so the state machine is unit tested without GitLab.

## Lifecycle

| Event | Effect |
|---|---|
| Server start | Vault locked; GitLab client in demo mode; setup code printed if no vault exists |
| Sign-in | Vault unlocks; client rebuilt from the active profile; watch poller starts; auto-fetch runs |
| Profile switch | Client rebuilt; cache cleared; rule baselines reset |
| Lock or restart | Data key wiped; sessions cleared; poller stops; notification history cleared |

## Source layout

| Path | Contents |
|---|---|
| `server.ts` | Express setup, TLS, Vite middleware in development, static `dist/` in production |
| `server/` | Everything listed in the component diagram, plus `tls.ts`, `metricsManager.ts`, `yamlParser.ts`, `concurrency.ts` |
| `src/` | React 19 + Tailwind 4 SPA; `services/api.ts` is the only module that calls the server |
| `tests/` | `bun test` suites |
| `skills/` | Agent skills |
| `docs/` | This site (Eleventy) |
