# lazylab scale audit: 300+ repositories (SCALE-1..3)

This report ranks the GitLab chores lazylab could automate for a solo developer with 300+ repositories, measures lazylab's API usage against current and newly announced GitLab.com rate limits, and lists the tests and safeguards needed before a release. It ends with proposed tasks and a revised roadmap.

Date of audit and of every source check: 2026-10-24. Code state: branch `feature/docs-polish` at `681ce1e` plus uncommitted docs moves. Method: static reading of `server/`, `cli/`, `src/App.tsx` and `tests/`, plus web research. The app was not started and nothing was run against GitLab.

## Summary

| #   | Finding                                                                                                                                                                                                                                                                                                     | Stage | Class            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------- |
| 1   | With default settings and only 15 aggregated projects, background sync makes about 10,000 requests per hour. GitLab.com's plan-based limits (reported as enforced for Free accounts from 2026-10-19) allow 5,000 per hour and 100 per minute burst. lazylab alone exceeds a Free account's budget today | 2     | MUST             |
| 2   | No 429 or `Retry-After` handling, no request timeout, and `RateLimit-*` headers are parsed only for the dashboard. Nothing slows down when quota runs low                                                                                                                                                | 2     | MUST             |
| 3   | `runAutoFetch` has no in-flight guard and `/api/config/autofetch` accepts any positive number (0.1 s is valid). At 300 projects one cycle takes longer than the 30 s interval, so cycles overlap and pile up                                                                                                | 2/3   | MUST             |
| 4   | Agent REST routes fall back to "the most recently active project", or to demo id 901, when `projectId` is omitted. `PUT /api/agent/merge-requests/:iid` with `state_event: close` can close an MR in the wrong project                                                                                     | 3     | MUST             |
| 5   | The cache journal grows by about 150,000 lines (about 15 MB) per day at 15 projects. The same rows go into the `wal_logs` table, and the whole sql.js database is re-exported to disk 2 s after every write batch, so write cost grows without bound                                                      | 3     | MUST (CACHE-1/3) |
| 6   | Every "all projects" view, and ENV-4 token expiry, covers only the 15 most recently active projects. Above that, credentials expiring in the other 285 projects are never checked, and the UI does not say so                                                                                         | 1/3   | SHOULD           |
| 7   | Highest-value automations not in the tracker: scheduled-pipeline health, a "broken default branch" digest across the fleet, dead-repo archiving with undo, mirror and webhook health, and local mirror backups of every repo                                                                              | 1     | P1/P2            |
| 8   | No shared bulk-action engine exists (dry run, confirmation by count, before-value journal, undo, rate budget, stop on error). Every FLEET, REG and DEPLOY write task needs one, and should not ship without it                                                                                           | 3     | MUST before FLEET writes |
| 9   | Incremental sync is possible without webhooks: one `/projects?last_activity_after=` call (throttled hourly by GitLab), `updated_after` on MR and issue lists, and one GraphQL query for the inbox. Together they cut steady-state cost by about 10× at 300 projects                                           | 2     | P1               |
| 10  | Release-readiness gaps: no tests for `session.ts` (apiGuard, throttle), vault crypto (SEC-1), any HTTP route in `apiRouter.ts`, `yamlParser`, or `metricsManager`. No vault recovery (SEC-5). Agent tokens have no read-only scope or expiry (SEC-6/AGENT-2)                                            | 3     | MUST             |

## Stage 1: usefulness to a solo developer (SCALE-1)

### What lazylab automates today (from the code)

| Area                                    | Automated today                                                                                                                                                     | Scale limit found in code                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Inbox (`server/inbox.ts`)               | My MRs (with head pipeline), review requests, assigned issues and To-Dos in one list, every 30 s                                                                     | Global endpoints, so it already covers all projects. 50 items per source; 20 single-MR reads per refresh                              |
| Watches and rules (`server/watch.ts`)   | Pipeline, job and MR watches polled every 15 s; auto-watch my MR pipelines; new review requests; new commits on reviewed MRs; runner offline; push to ntfy, Gotify or webhooks | One request per watch per 15 s; sequential poll                                                                                        |
| CI triage (`server/triage.ts`)          | Failure excerpt in the UI, in notifications and over MCP; run pipeline with declared variables                                                                       | Downloads the whole trace (tail capped at 2 MB)                                                                                         |
| Token expiry (`server/tokenExpiry.ts`)  | PAT expiry per vault profile; project, group and deploy tokens; warnings at 14/7/3/1 days; PAT rotation                                                             | Project, group and deploy tokens only for `AGGREGATE_PROJECT_LIMIT` = 15 projects (`gitlabClient.ts:3986`)                             |
| Local env (`envResolve.ts`, `cli/env.ts`) | `lazy env pull`, `lazy run` from CI variables plus vault secrets                                                                                                     | One project at a time (as intended)                                                                                                     |
| Agents (`server/mcp.ts`, briefings, handoffs, BugKB) | 26 MCP tool definitions in `mcp.ts`, briefings, handoffs                                                                                                                   | `list_projects` returns at most 50 projects (no pagination, GL-2)                                                                      |
| CLI                                     | `lazy push` (push, find and follow the pipeline), `ci watch`, `mr create`, `job log --failed`, `retry --follow`                                                     | Per checkout                                                                                                                            |
| Releases (`server/releaseNotes.ts`)     | Next semver and changelog from Conventional Commits, one project at a time                                                                                          | No cross-repo "what needs releasing" view                                                                                               |
| Aggregate views                         | Milestones, labels, pipelines, work items, MRs, packages                                                                                                            | Top 15 projects by `last_activity_at`; project list capped at 50 (`per_page=50`, no pagination)                                        |

Nothing in the code today runs across all 300 projects except the inbox, which uses user-scoped global endpoints. Every fleet operation in the tracker (FLEET, REG, DEPLOY, REPO) is still open.

### What people complain about at scale

- GitLab has no bulk settings editor. The forum answer to "change settings on multiple repos" is to write your own REST script, and a feature request was filed for bulk settings ([forum thread](https://forum.gitlab.com/t/how-to-changes-settings-on-multiple-repos/104327)). Group-level protected branches, which would remove one per-project chore, are Premium and Ultimate only, and cover top-level groups only ([protected branches docs](https://docs.gitlab.com/user/project/repository/branches/protected/)). A solo developer on Free whose repos sit in a personal namespace gets neither.
- Merge method cannot be set per branch or inherited ([gitlab-org/gitlab#6846](https://gitlab.com/gitlab-org/gitlab/-/issues/6846)), so it drifts across repos.
- Multi-repo tools each cover one slice. [multi-gitter](https://github.com/lindell/multi-gitter) runs a script in every repo and opens MRs, but keeps no state afterwards. [mani](https://github.com/alajmo/mani) and [gita](https://github.com/nosarthur/gita) run commands across local clones and do not talk to the GitLab API. [glab](https://gitlab.com/gitlab-org/cli) works on one repo at a time. [gh-dash](https://github.com/dlvhdr/gh-dash) is a cross-repo PR dashboard for GitHub only. [Renovate](https://docs.renovatebot.com/) opens dependency MRs but leaves merging them, across N repos, to the developer. None of them remembers fleet state, watches it, or undoes a bulk change. That gap is where lazylab fits ("aggregates and remembers", "acts on your behalf").
- Free-tier quotas turn hygiene into a chore. Each Free project on GitLab.com has 10 GiB of storage (repository and LFS) and becomes read-only above it ([storage docs](https://docs.gitlab.com/user/storage_usage_quotas)). The Free compute allowance is 400 minutes a month per namespace (third-party sources only; not confirmed on an official page in this audit). With 300 repos, artifact build-up and forgotten scheduled pipelines spend both quietly.
- From 2026-10-19 the new rate limits make the API budget something every tool on the account has to share: glab, Renovate running as the same user, CI scripts and lazylab all draw from one per-user bucket ([WorkOS analysis](https://workos.com/blog/gitlab-rate-limits-authenticated-automation)).

### Chores still manual at 300+ repositories

Existing open tasks are referenced rather than repeated. Scores: frequency (D daily, W weekly, M monthly, O occasional); minutes saved per occurrence at 300 repos; effort S/M/L; "Local" is the tracker's runs-locally test (needs the host, holds secrets, aggregates and remembers, or acts on the user's behalf).

| Rank | Chore                                                                                                                                              | Freq | Min saved | Effort | Local | Status / proposed ID                                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------- | ------ | ----- | ------------------------------------------------------------ |
| 1    | Know which of 300 default branches are red right now, without opening 300 pipeline pages; daily digest instead of one notification per event       | D    | 15–30     | M      | Aggregates, remembers | New: WATCH-12 (needs FLEET-5)                                 |
| 2    | Scheduled pipelines that fail, or became inactive when the owner token or account changed. GitLab notifies only the schedule owner, by email, and an inactive schedule notifies nobody | W    | 20–60     | S–M    | Watches | New: WATCH-11                                                 |
| 3    | Fleet registry: one cached table of every project (activity, default branch, visibility, archived, last pipeline, open MRs, mirrors, size). Every row below depends on it | D    | 10        | M      | Aggregates, remembers | New: FLEET-5                                                  |
| 4    | Credentials expiring in any of the 300 projects: project, group and deploy tokens (ENV-4 covers 15 projects), deploy keys, SSH keys, runner authentication tokens | M    | 30–120 per outage avoided | S–M | Watches | Extends ENV-4/ENV-8: new ENV-12                         |
| 5    | Back up every repo to the lazylab host (`git clone --mirror`, then incremental `git remote update`), so an account lock, a deleted project or a GitLab outage does not lose work | W    | high, rare | M     | Needs the host | New: BACKUP-1                                                 |
| 6    | Archive dead repos: no activity in N months, no open MRs, no schedules; dry run, archive in bulk, and undo (archive is reversible through the API) | M    | 60        | M      | Acts, remembers | New: FLEET-6 (needs SAFE-1)                                   |
| 7    | Merge Renovate MRs in bulk across repos                                                                                                            | W    | 30–90     | M      | Acts  | Exists: FLEET-4. Add: list repos not onboarded or with a Renovate config error |
| 8    | Settings drift beyond FLEET-2: merge method, "pipelines must succeed", delete source branch, auto-cancel redundant pipelines, CI job token inbound allowlist, artifact expiry and "keep latest artifacts", registry cleanup policy, shared runners, and accidental public visibility | M | 60–180 | M | Remembers | Extends FLEET-2: new FLEET-7 |
| 9    | Mirror and webhook health: push mirrors with `last_error`, pull mirrors behind, webhooks GitLab disabled after failures. All three fail silently   | W    | 15–30     | S      | Watches | New: FLEET-8                                                  |
| 10   | Change a file in N repos (CI include ref, LICENSE year, `.editorconfig`, Node image) and follow the MRs as one batch until merged                 | M    | 120–600   | L      | Needs the host, acts | New: FLEET-10                                                 |
| 11   | CI template and include drift: which repos pin which `include:` ref or component version, deprecated `only/except`, end-of-life images              | M    | 60        | M      | Remembers | New: FLEET-9 (read-only scan; fixes via FLEET-10)            |
| 12   | Local checkouts: fetch all, fast-forward clean branches, list unpushed commits and dirty trees (unpushed work is a data-loss risk)                 | D    | 10        | M      | Needs the host | Extends REPO-1/2: new REPO-7                                 |
| 13   | Storage and compute usage per project: top artifact, registry and repo sizes; bulk-delete old artifacts and set `expire_in`                      | M    | 30        | M      | Remembers trends | New: QUOTA-1 (writes need SAFE-1)                             |
| 14   | Merged and stale branches across repos                                                                                                            | M    | 30        | M      | Acts  | Exists: REPO-6. Add fleet scope and SAFE-1 journal           |
| 15   | What needs releasing: repos with commits on the default branch since their last tag, with the suggested bump                                     | W    | 20        | S      | Aggregates | New: REL-5 (reuses `releaseNotes.ts`)                         |
| 16   | Registry tag cleanup and cleanup policy                                                                                                           | M    | 30        | M      | Acts  | Exists: REG-1/2. Fold the "policy enabled" check into FLEET-7 |
| 17   | Stale review apps                                                                                                                                 | W    | 10        | S      | Acts  | Exists: DEPLOY-3                                              |
| 18   | Stale MRs and issues not owned by me (bots, ex-collaborators): close with a comment or nudge                                                     | M    | 20        | S      | Acts  | New: FLEET-11 (P3)                                            |
| 19   | Access review: members with Maintainer or Owner on projects, invites without expiry, ex-collaborators                                             | O    | 30        | S      | Remembers | New: FLEET-12 (P3)                                            |
| 20   | README, LICENSE, description, topics and badge consistency                                                                                        | O    | 30        | S      | Remembers | Fold into FLEET-7 (low-frequency check)                       |

Excluded because they fail the runs-locally test or are non-goals: editing wiki or snippets in bulk, group and epic management, and a bulk diff or review UI.

### Notes on the top items

- **WATCH-12 broken default branches.** A single daily digest ("4 of 300 default branches failed, 2 since yesterday") with links and excerpts is more useful than 300 watches. It needs the registry (FLEET-5) and costs about 1 request per changed project per cycle, or a few GraphQL calls (Stage 2).
- **WATCH-11 schedules.** `GET /projects/:id/pipeline_schedules` returns `active`, `next_run_at` and `owner`. The last pipeline comes from `GET /projects/:id/pipeline_schedules/:id/pipelines`. Rules: schedule inactive, last run failed, or `next_run_at` in the past. Weekly scan: about 300 calls plus one per schedule. Fold the result into the daily digest.
- **BACKUP-1.** This is the clearest "needs the host" feature in the list. Git traffic has its own budget (10,000 Git HTTPS requests per minute per user on GitLab.com), separate from the API limit. It needs a storage path setting, a schedule and a per-repo size cap.
- **FLEET-6 archive.** Archiving is reversible (`POST /projects/:id/archive` and `/unarchive`), which makes it a good first bulk write to build SAFE-1 on.

## Stage 2: performance and API budget (SCALE-2)

### Current GitLab limits (checked 2026-10-24)

GitLab.com, in effect now ([GitLab.com rate limits](https://docs.gitlab.com/user/gitlab_com/rate_limits/)):

| Scope                                   | Limit                  |
| --------------------------------------- | ---------------------- |
| Authenticated API, per user             | 2,000 / minute         |
| All traffic per IP                      | 2,000 / minute         |
| Projects list `GET /projects`           | 2,000 / 10 minutes     |
| Single project `GET /projects/:id`      | 400 / minute           |
| Group projects `GET /groups/:id/projects` | 600 / minute         |
| Groups list `GET /groups`               | 50 / minute            |
| `GET /users/:id`                        | 300 / 10 minutes       |
| List project members                    | 200 / minute           |
| Search (project, group, advanced), per user | 100 / minute       |
| Pipeline creation per project, user and commit | 25 / minute     |
| Note creation (issues and MRs)          | 60 / minute            |
| Raw endpoints per project, commit or path | 300 / minute         |
| Authenticated Git HTTPS                 | 10,000 / minute        |

GitLab.com CI/CD action limits, per user per minute ([GitLab.com settings](https://docs.gitlab.com/user/gitlab_com/)): job retry 3 per job and 320 per project; pipeline retry 5 per pipeline and 200 per project; pipeline cancel 5 per pipeline and 120 per project. Webhooks: 500 per minute per top-level namespace on Free.

GitLab.com plan-based limits (the docs page lists them as "proposed, not in effect yet"; trade coverage reports enforcement for Free and unauthenticated traffic from 2026-10-19, with Premium and Ultimate following in January 2027, after brownouts on 2026-10-07 and 2026-10-14) ([docs](https://docs.gitlab.com/user/gitlab_com/rate_limits/), [WorkOS, 2026-09-22](https://workos.com/blog/gitlab-rate-limits-authenticated-automation), [DevOps.com](https://devops.com/gitlab-tightens-rate-limits-as-coding-agents-drive-demand/)):

| Plan     | Sustained per user | Burst per user | Top-level group burst |
| -------- | ------------------ | -------------- | --------------------- |
| Free     | 5,000 / hour       | 100 / minute   | 400 / minute          |
| Premium  | 15,000 / hour      | 1,250 / minute | 5,000 / minute        |
| Ultimate | 25,000 / hour      | 2,000 / minute | 10,000 / minute       |

Requests count against the user, not the token: every PAT, glab session and Renovate run under the same account shares one bucket. Unauthenticated traffic drops to 60 per hour per IP.

GraphQL ([GraphQL docs](https://docs.gitlab.com/api/graphql/#limits)): complexity 250 per authenticated query (200 unauthenticated), 100 nodes per page, 10,000 characters per query, 30 s timeout. Each GraphQL POST counts as one API request against the limits above. Multiplexed queries are supported.

Self-managed defaults ([user and IP rate limits](https://docs.gitlab.com/administration/settings/user_and_ip_rate_limits/)): the authenticated API limit per user is disabled by default. When an admin enables it, the default is 7,200 requests per 3,600 s. `RateLimit-Limit`, `RateLimit-Name`, `RateLimit-Observed`, `RateLimit-Remaining` and `RateLimit-Reset` are sent on responses. `RateLimit-ResetTime` and `Retry-After` are sent with 429. The Projects, Groups and Users API limits omit the informational headers, so remaining quota cannot always be read from responses.

### Requests per cycle today

Derived from `server/apiRouter.ts:47` (`runAutoFetch`, 30 s default), `server/inbox.ts`, `server/watch.ts` (15 s poll) and `server/gitlabClient.ts` (`AGGREGATE_PROJECT_LIMIT` = 15, `AGGREGATE_CONCURRENCY` = 4). Assumes 2 active milestones per project and 10 open MRs of my own.

| Source per auto-fetch cycle                        | Calls at K = 15 | Calls at K = 300 (GL-17 lifted, GL-2 paging) | Notes                                                                                            |
| -------------------------------------------------- | --------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `getProjects(true)`                                | 1               | 3                                             | `per_page=50` today; 300 projects = 3 pages at 100                                               |
| Milestones (TTL 120 s, not forced)                 | about 9 amortised | about 180 amortised                         | 1 list + 1 `issues_statistics` per milestone, per project, every 5th cycle                      |
| Work items, forced                                 | 15              | 300                                           | `state=all`, 50 per project                                                                      |
| MRs, forced                                        | 30              | 600                                           | List plus `approved_by_usernames[]` list per project                                             |
| Pipelines, forced                                  | 15              | 300                                           |                                                                                                  |
| Runners, forced                                    | 1               | 1                                             |                                                                                                  |
| Inbox, forced                                      | 14              | 14                                            | 4 global lists plus up to 20 single-MR reads; `/user` cached 10 min                             |
| **Total per cycle**                                | **about 85**    | **about 1,400**                               |                                                                                                  |
| **Per hour (120 cycles)**                          | **about 10,200** | **about 168,000**                            | Free limit 5,000; Premium 15,000; current GitLab.com 120,000                                     |

Other sources:

| Source                                          | Cost                                                    |
| ----------------------------------------------- | ------------------------------------------------------- |
| Each active watch                               | 4 / minute = 240 / hour (10 watches = 2,400 / hour)      |
| Auto-watch of my MR pipelines                   | one watch per running pipeline, as above                |
| Failure notification                            | 1 jobs list + up to 5 job reads and 5 full traces        |
| Token expiry, every 6 h                         | 1 per profile + 2 per project + 1 per group (K = 15: about 35; K = 300: about 650) |
| Cold UI load or Refresh with `force=true` (`src/App.tsx:187`) | K = 15: about 130; K = 300: about 2,400   |
| Dashboard metrics poll every 8 s                | local only, no GitLab calls                             |

What this means:

- **GitLab.com Free, after 2026-10-19:** at the default settings lazylab uses about twice the hourly allowance with only 15 projects, before any watch, CLI, agent or other tool on the same account. Each cycle sends about 85 requests within a few seconds (up to 16 in flight: 4 sources × concurrency 4), so two cycles in one minute (170) also exceed the 100 per minute burst. Throttling would start within about 30 minutes of unlocking the vault.
- **Current 2,000 per minute limit:** fine at 15 projects. At 300 projects a cycle needs about 1,400 requests. With 4 in flight at about 250 ms each, that is about 90 s, three times the interval. Because `runAutoFetch` has no in-flight guard (finding 3), cycles stack and the rate exceeds 2,000 per minute.
- **Self-managed:** unlimited by default, but 1,400 requests every 30 s is real load on a small instance. With the admin default of 7,200 per hour enabled, the 15-project setup is already over the limit.

### Where the budget breaks, by code location

| Location                                          | Problem                                                                                                                                       |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiRouter.ts:47` `runAutoFetch`                  | Forces a refetch of every source every 30 s regardless of change; no single-flight guard; interval not clamped (`apiRouter.ts:201`)          |
| `gitlabClient.ts:2384` MR approval call           | Doubles MR cost for one boolean; failures (including 429) swallowed by `catch {}`                                                             |
| `gitlabClient.ts:1938` milestone statistics       | One extra call per milestone                                                                                                                  |
| `gitlabClient.ts:1836` `fetchApi`                 | No timeout (`AbortSignal`), no 429 or `Retry-After` handling, no conditional request; the ETag is stored in the cache but never sent back      |
| `metricsManager.ts:120`                           | Parses `RateLimit-*` but only for display; nothing reads it to throttle                                                                        |
| `watch.ts:277` `pollAll`                          | Fixed 15 s for every watch regardless of pipeline age; no shared budget with auto-fetch                                                        |
| `gitlabClient.ts:3306` job trace                  | Full trace download per failure notification (TRIAGE-5/9)                                                                                      |
| `gitlabClient.ts:1882` `forRecentProjects`        | Partial failures are silently dropped unless every project fails, so a throttled run shows incomplete data as if it were complete             |

### Recommendations

#### R1: a request budget in the client (GL-19)

- One `RequestScheduler` in front of `fetchApi`: a token bucket sized from the detected plan or a setting (Free default: 70 per minute and 4,000 per hour for lazylab, leaving about 20% for glab, CLI and other tools on the same account). Priority lanes: interactive (UI clicks, CLI, MCP) > watches > background sync > fleet scans. Background lanes yield when `RateLimit-Remaining` drops below 20% of `RateLimit-Limit`.
- On 429: honour `Retry-After` (or `RateLimit-Reset`), pause all background lanes until then, then resume with jittered exponential backoff. Surface "rate limited until HH:MM" in the sync bar and in `GET /api/status`.
- 15 s timeout per request through `AbortSignal.timeout`.
- Single-flight for `runAutoFetch`, a minimum interval of 30 s enforced on the server, and a skip when the previous cycle is still running.

#### R2: incremental sync instead of forced refetch (CACHE-7)

- **Change detection, 1 call per cycle:** `GET /projects?membership=true&order_by=last_activity_at&last_activity_after=<watermark>&per_page=100`. Only projects returned are refreshed. GitLab updates `last_activity_at` at most about once an hour and the interval is hard-coded ([gitlab-org/gitlab#16729](https://gitlab.com/gitlab-org/gitlab/-/issues/16729)), so this alone cannot drive "pipeline just finished". It is right for the registry and for the hourly fleet views. `updated_after` with `order_by=updated_at` (15.10+) is the alternative ([Projects API](https://docs.gitlab.com/ee/api/projects)); whether it is throttled the same way was not confirmed.
- **Lists by update time:** `/merge_requests` and `/issues` (global with `scope=…`, or `/groups/:id/…` where projects sit in groups) with `updated_after=<watermark>`. Merge into cached rows by id. One call per source per cycle instead of one per project.
- **Pipelines:** for "is the default branch red", use `GET /projects/:id/pipelines/latest` only for projects whose activity changed, plus watches for the pipelines that matter now. Do not list 30 pipelines per project every 30 s.
- **Milestones and labels:** refresh hourly or on view open; they rarely change. Drop `issues_statistics` from the background cycle and fetch it only when the Milestones view is open.
- **Approval flag:** fetch only for MRs where I am a reviewer (the inbox already knows them), or read it from GraphQL `approvedBy`.

#### R3: GraphQL where it replaces many calls

- **Inbox in one query:** `currentUser { authoredMergeRequests(state: opened) { … headPipeline { status } detailedMergeStatus conflicts } reviewRequestedMergeRequests(state: opened) { … } todos(state: pending) { … } }`. That replaces 4 lists plus up to 20 single-MR reads (about 24 calls down to 1–2). Field availability varies by GitLab version (as noted for `ciConfigVariables`), so keep REST as the fallback.
- **Fleet status in batches:** aliased `project(fullPath:)` blocks asking for `lastActivityAt`, `archived`, `repository { rootRef }` and the latest default-branch pipeline status. If 25 projects fit under complexity 250, 300 projects take 12 calls instead of 300. That figure is an estimate: measure it with the `queryComplexity { score limit }` field before relying on it.
- GraphQL saves request count, not cost on GitLab's side, and a 250-complexity query can take seconds. Use it for the background lanes, not for single-item reads, where REST is cheaper.

#### R4: conditional requests

- Send `If-None-Match` with the cached ETag. A 304 skips the body transfer and the parse, but it is still a request and counts against the limit. Whether REST v4 list endpoints return 304 was not verified against a live instance. This is a bandwidth and CPU saving, not a quota fix; low priority after R1 and R2.

#### R5: webhooks (WATCH-5) and events

- Project webhooks are available on Free, but in a personal namespace they must be installed per project: 300 `POST /projects/:id/hooks` calls once, which is itself a fleet chore and should use SAFE-1. Group webhooks are Premium. With webhooks, pipeline, MR and push events need no polling at all; polling can drop to a 10-minute reconciliation sweep.
- Webhook delivery needs GitLab to reach lazylab (Tailscale Funnel, LAN). Without that, R2 is the fallback. Note that GitLab disables failing webhooks automatically, which FLEET-8 would detect.
- The Events API (`/events`, `/users/:id/events`) lists the current user's own actions and has no pipeline-finished events. It is useful for INBOX-6 (standup) and for detecting "I pushed to repo X", not as a general change feed.

#### R6: pagination

- `per_page=100` everywhere (lists use 30 or 50 today). Follow `Link` / `x-next-page` (GL-2). At 300 projects offset pagination is fine (3 pages). Keyset pagination (`pagination=keyset&order_by=id`) matters only for very large result sets; use it for the registry's full sweep so it stays correct while projects are added.

#### R7: what the cache must store (CACHE-7, CACHE-8)

| Data                                                                                                                      | Freshness target                                          | Source                                          |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| Project registry: id, path, default branch, visibility, archived, `last_activity_at`, settings hash, size statistics     | hourly; full keyset sweep daily                           | `/projects?…last_activity_after`, GraphQL batch |
| Latest default-branch pipeline per project (status, id, finished_at, failing job name)                                    | on activity change; 10 min reconciliation                 | `/pipelines/latest`, GraphQL                    |
| Open MRs and issues I care about, merged by id                                                                            | 60 s (inbox); watermark per source                         | global lists with `updated_after`               |
| Sync watermarks per source and per project; ETags                                                                         | persisted across restarts                                  | local                                           |
| Rate-limit state: last `RateLimit-*` values, pause-until                                                                  | live; persisted so a restart does not burst               | response headers                                |
| Fleet scan results: schedules, mirrors, webhooks, tokens and keys, settings baseline results                              | daily or weekly                                            | per-project scans, spread over the hour         |

Retention: cap the journal (CACHE-3), evict rows for projects that are no longer members, and purge or encrypt on lock (SEC-8). Move to `bun:sqlite` (CACHE-1) so writes are per row instead of whole-file exports.

### Target budget at 300 projects

| Lane                                     | Design                                                                | Requests per hour |
| ---------------------------------------- | --------------------------------------------------------------------- | ----------------- |
| Inbox                                    | GraphQL every 60 s                                                    | 60–120            |
| Change detection                         | `/projects?last_activity_after` every 60 s                            | 60                |
| Refresh changed projects                 | about 20 active projects per hour × 3 calls                            | 60                |
| Watches                                  | 10 watches, backoff 15 s → 60 s as pipelines age                      | 600–2,400         |
| Default-branch reconciliation            | GraphQL batches every 10 min (12 calls)                               | 72                |
| Fleet scans (schedules, mirrors, tokens) | 300 projects × 3 endpoints spread over 24 h                            | about 40          |
| **Background total**                     |                                                                       | **about 900–2,750** |

This fits under the Free 5,000 per hour with room for interactive use. With WATCH-5 webhooks, the watch lane drops to near zero.

## Stage 3: release readiness (SCALE-3)

### Test coverage against modules

| Module                                  | Tests                                     | Gap                                                                                                                                   | Class  |
| --------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `server/session.ts`                     | none                                      | apiGuard (cookie, bearer only on `/agent/`, 401/423), Origin check, throttle backoff, idle and absolute expiry, `Secure` flag         | MUST   |
| `server/vault.ts` crypto                | indirect (via watch, agent, env)          | wrong password, tamper detection (GCM tag), password change re-wrap, atomic write (SEC-1)                                              | MUST   |
| `server/apiRouter.ts` (1,619 lines, 47 mutating routes) | none                       | agent REST routes and `resolveAgentProjectId`, variables redaction over HTTP, merge, delete, autofetch config validation              | MUST   |
| `server/vaultRouter.ts`, `notifyRouter.ts` | none                                   | reveal paths, channel CRUD, test send                                                                                                 | SHOULD |
| `server/gitlabClient.ts` request layer  | normalisers partly                        | 429 and `Retry-After`, timeout, pagination, partial failure reporting (once R1 lands)                                                 | MUST with GL-19 |
| `server/yamlParser.ts`                  | none                                      | BUILD-3 lists it                                                                                                                      | SHOULD |
| `server/metricsManager.ts`              | none                                      | header parsing (epoch vs delta reset)                                                                                                  | NICE   |
| `server/tls.ts`                         | none                                      | cert generation and SANs                                                                                                              | NICE   |
| `cli/commands.ts`                       | parsing only; end to end done by hand     | a scripted fake-GitLab run in CI                                                                                                      | SHOULD |
| `server/cacheDb.ts`                     | TTL only                                  | journal bound, eviction, restart load time with a large DB                                                                            | SHOULD (with CACHE-1/3) |

### Safeguards

| ID       | Issue (evidence)                                                                                                                                                                                                                                       | Class                       | Fix                                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1       | Agent REST default project: `resolveAgentProjectId` returns `projects[0]` (most recently active) or demo id 901 in live mode (`apiRouter.ts:1218`). Used by create issue, create MR and update MR (`state_event`) routes                                | MUST                        | Require `projectId` (400 without it), or a default project explicitly configured per token. Never return a demo id in live mode. Test it                                  |
| S2       | No rate-limit handling (Stage 2)                                                                                                                                                                                                                       | MUST                        | GL-19                                                                                                                                                                       |
| S3       | Auto-fetch overlap and unclamped interval (`apiRouter.ts:47`, `:201`)                                                                                                                                                                                  | MUST                        | Single-flight, minimum 30 s, skip when busy; persist the setting                                                                                                            |
| S4       | Cache growth: journal line plus `wal_logs` row per `set()`; about 51 sets per cycle = about 147,000 lines (about 15 MB) per day at K = 15, about 20× that at 300 projects; full sql.js export after each batch; expired rows never evicted; all rows loaded into memory at start | MUST                        | CACHE-1, CACHE-3, eviction (CACHE-8)                                                                                                                                         |
| S5       | Bulk and destructive actions: no shared engine. Today single deletes (variables, badges, runners) have no confirmation on the server and keep no before-value (deleting a variable loses its value)                                                    | MUST before any FLEET, REG, DEPLOY or REPO-6 write ships | SAFE-1: plan → dry-run diff → confirm with the exact count → execute under the request budget → journal before and after values → undo where the API allows → stop after N errors |
| S6       | Agent writes: tokens have no read-only scope, no expiry, no per-project allowlist. Agents can create and close issues and MRs, comment, run pipelines (spends compute minutes) and retry jobs. No approval queue                                       | MUST (read-only scope, expiry); SHOULD (approval queue) | SEC-6/AGENT-2 before release; AGENT-3 before adding any merge, delete or variable-push tool; per-token daily cap on `run_pipeline` (AGENT-16)                                |
| S7       | Vault is the only copy of profiles, CI secrets, handoffs and (soon) notes. A forgotten password or a corrupt file loses everything                                                                                                                     | MUST                        | SEC-5 (encrypted export and recovery key); keep the previous vault file as `.bak` on each write                                                                             |
| S8       | Partial data shown as complete: `forRecentProjects` drops failed projects silently; the MR approval flag swallows errors                                                                                                                               | SHOULD                      | Return `errors[]` as the inbox does; show "12 of 15 projects loaded"                                                                                                        |
| S9       | Coverage presented as complete: aggregate views and ENV-4 cover 15 of N projects without saying so                                                                                                                                                     | SHOULD                      | Show "top 15 of 300 projects" in the UI; ENV-12 for full credential coverage                                                                                                 |
| S10      | Watches deleted on any error matching `/\b404\b|not found/` (`watch.ts:229`). Lost access, a moved project or a proxy error page deletes the watch silently except for one info notification                                                          | SHOULD                      | Remove only on a 404 from the GitLab API for that resource, after two consecutive checks                                                                                    |
| S11      | Notification floods: a first fleet scan or a bulk action can produce hundreds of push messages                                                                                                                                                          | SHOULD                      | Per-channel rate limit and digest mode (with WATCH-7)                                                                                                                       |
| S12      | Cache at rest holds private issue and MR content unencrypted and is not purged on lock                                                                                                                                                                | SHOULD (MUST on a shared host) | SEC-8                                                                                                                                                                     |
| S13      | Demo mode: mutations against demo data succeed and look real; no banner on every view                                                                                                                                                                  | SHOULD                      | UI-4 now; DEMO-1 later                                                                                                                                                      |
| S14      | PAT rotation revokes the old token, which other tools (glab, CI variables) may use                                                                                                                                                                     | NICE                        | Before rotating, list vault CI secrets with the same value and warn                                                                                                         |
| S15      | No request timeout: a hung TCP connection stalls a cycle indefinitely                                                                                                                                                                                  | SHOULD                      | Part of GL-19                                                                                                                                                               |
| S16      | CSP, login-failure map growth, step-up auth                                                                                                                                                                                                           | SHOULD / NICE               | SEC-9 (SHOULD), SEC-10 (NICE), SEC-2 (SHOULD before bulk writes)                                                                                                            |

### Release gate

Before a tagged release: S1–S4, S6 (read-only scope and expiry), S7, and the MUST test rows. Before the first FLEET write feature: S5 (SAFE-1), SEC-2 step-up for bulk runs, and S11.

## Proposed tasks

| ID        | Description                                                                                                                                          | Stage | Priority | Effort | Depends on            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------- | ------ | --------------------- |
| GL-19     | Request scheduler: token bucket per plan, priority lanes, `RateLimit-*` aware slowdown, 429 / `Retry-After` pause, 15 s timeout, status in sync bar | 2     | P1       | M      | none                  |
| GL-20     | Auto-fetch single-flight, server-side minimum interval (30 s), persisted interval setting                                                           | 2/3   | P1       | S      | none                  |
| GL-21     | Agent REST requires `projectId` (or a per-token default); remove the `projects[0]` and 901 fallback                                                 | 3     | P1       | S      | none                  |
| GL-22     | `forRecentProjects` and other fan-outs return `errors[]`; UI shows "n of m projects loaded" and the 15-project scope                               | 3     | P2       | S      | GL-15                 |
| CACHE-7   | Incremental sync: `last_activity_after` change detection, `updated_after` watermarks, refresh only changed projects, hourly milestones and labels   | 2     | P1       | M      | GL-2, GL-19, CACHE-1  |
| CACHE-8   | Cache retention: evict non-member and expired rows, cap memory, purge on profile removal                                                            | 3     | P2       | S      | CACHE-1               |
| CACHE-9   | Conditional requests with `If-None-Match` (verify 304 support first)                                                                               | 2     | P3       | S      | GL-19                 |
| INBOX-8   | Inbox from one GraphQL query with REST fallback                                                                                                     | 2     | P2       | M      | none                  |
| FLEET-5   | Fleet registry: every member project cached with activity, visibility, archived, default branch, latest default-branch pipeline, size; keyset sweep daily | 1/2 | P1    | M      | GL-2, CACHE-7         |
| SAFE-1    | Bulk-action engine: plan, dry-run diff, confirm by count, budgeted execution, before/after journal, undo, stop on error threshold                  | 3     | P1       | M      | GL-19, CACHE-3        |
| WATCH-11  | Scheduled-pipeline health: inactive schedules, failed last run, missed `next_run_at`; weekly scan into digest                                      | 1     | P1       | S      | FLEET-5               |
| WATCH-12  | Daily fleet digest: red default branches (new since yesterday first), with failure excerpt                                                         | 1     | P1       | M      | FLEET-5, TRIAGE-1     |
| WATCH-13  | Per-channel push rate limit and digest mode                                                                                                         | 3     | P2       | S      | WATCH-7               |
| WATCH-14  | Watch removal only on a confirmed API 404 (two checks); adaptive poll interval by pipeline age                                                     | 2/3   | P2       | S      | WATCH-10              |
| ENV-12    | Credential expiry across all projects: project, group and deploy tokens, deploy keys, SSH keys, runner auth tokens; scan spread over 24 h         | 1     | P1       | S      | FLEET-5, GL-19        |
| FLEET-6   | Dead-repo archive: candidates by inactivity, no open MRs or schedules; bulk archive with undo                                                      | 1     | P2       | M      | FLEET-5, SAFE-1       |
| FLEET-7   | Settings baseline v2: merge method, pipelines-must-succeed, delete source branch, auto-cancel, job token allowlist, artifact expiry, cleanup policy, shared runners, visibility, LICENSE/README | 1 | P2 | M | FLEET-2, SAFE-1 |
| FLEET-8   | Mirror and webhook health: push mirror errors, pull mirror lag, auto-disabled webhooks                                                             | 1     | P2       | S      | FLEET-5               |
| FLEET-9   | CI include and image drift scan (read-only) across repos                                                                                           | 1     | P3       | M      | FLEET-5               |
| FLEET-10  | Batch change campaigns: run a script or file template in N repos (local clones or commits API), open MRs, follow and merge as one batch            | 1     | P2       | L      | SAFE-1, REPO-1, FLEET-4 |
| FLEET-11  | Stale MR and issue sweep for items not owned by me (close with comment or nudge)                                                                   | 1     | P3       | S      | SAFE-1                |
| FLEET-12  | Access review: elevated members and invites without expiry across projects                                                                         | 1     | P3       | S      | FLEET-5               |
| BACKUP-1  | Local mirror backups of every repo on a schedule, incremental, with size caps and a restore guide                                                   | 1     | P2       | M      | FLEET-5               |
| QUOTA-1   | Storage and compute usage per project with trends; bulk artifact cleanup and `expire_in` advice                                                    | 1     | P3       | M      | FLEET-5, SAFE-1       |
| REPO-7    | `lazy sync`: fetch all local clones, fast-forward clean branches, report unpushed commits and dirty trees                                          | 1     | P2       | M      | REPO-1                |
| REL-5     | "What needs releasing": repos with commits since their last tag and the suggested bump                                                             | 1     | P3       | S      | FLEET-5, REL-1        |
| AGENT-16  | Per-token daily cap on `run_pipeline` and `retry_job`                                                                                             | 3     | P2       | S      | AGENT-2               |
| BUILD-9   | Tests: `session.ts` apiGuard and throttle, agent REST routes, autofetch config validation, request scheduler                                      | 3     | P1       | M      | GL-19, GL-21          |

Existing tasks raised to release blockers by this audit: SEC-1, SEC-5, SEC-6/AGENT-2 (read-only scope and expiry), CACHE-1, CACHE-3. Raised to P2: SEC-8, UI-4, WATCH-10 (superseded by GL-19 and WATCH-14). GL-17 (make the 15-project limit a setting) should be dropped in favour of FLEET-5 plus CACHE-7: raising the limit without incremental sync multiplies the request cost.

## Revised roadmap

1. **Release blockers:** GL-21, GL-20, GL-19, CACHE-1, CACHE-3, SEC-1, SEC-5, SEC-6/AGENT-2 (read-only scope and expiry), BUILD-9. Reason: the API budget breaks on GitLab.com Free today, and the wrong-project agent write is a data-integrity bug.
2. **Scale foundation:** GL-2, CACHE-7, FLEET-5, INBOX-8, GL-22, CACHE-8, WATCH-14. Every fleet view reads the registry instead of fanning out.
3. **Fleet visibility, read-only (most value for least risk):** WATCH-12, WATCH-11, ENV-12, FLEET-8, REL-5, then WATCH-5 webhooks for hosts GitLab can reach.
4. **Safe fleet writes:** SAFE-1 and SEC-2 first, then FLEET-6, FLEET-7/FLEET-2, FLEET-1, FLEET-4, REPO-6, DEPLOY-3, REG-2, WATCH-13.
5. **Host-side automation:** BACKUP-1, REPO-1/2, REPO-7, FLEET-10, FLEET-9.
6. **Then the remaining epics:** NOTES, AGENT-3 (required before any new destructive agent tool), QUOTA-1, FLEET-11/12, PAL, CLI-3.

## Not verified

- Whether GitLab.com is enforcing the plan-based limits as of this audit: the docs still say "proposed", while WorkOS and DevOps.com report 2026-10-19 for Free. The DevOps.com page returned 403 to the fetcher, so its figures are taken from search snippets and the WorkOS article. The top-level group sustained limit is unpublished.
- Whether REST v4 list endpoints honour `If-None-Match` with 304.
- GraphQL complexity of the proposed fleet and inbox queries; field availability per GitLab version.
- Whether `updated_after` on `/projects` is throttled like `last_activity_at`.
- The Free compute-minute figure (400 per month) on an official GitLab page.
- Request counts assume 2 milestones per project and 10 open authored MRs; real counts vary. No measurement against a live instance was made.
