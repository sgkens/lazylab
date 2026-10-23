---
title: Feature status
abstract: This page records which features are fully wired to GitLab, which have known limits, and which have only been verified against demo data, as of the October 2026 UI audit.
---

## How features are checked

- **Unit tests** (`bun test`) cover the pure logic: trace parsing, inbox classification, watch evaluation, notification wire formats, MCP dispatch, release notes and input validation.
- **End-to-end runs** start the server in demo mode and drive it with curl, the official MCP client, and headless Chromium.
- **Live GitLab** checks are recorded per feature below. "Demo only" means the GitLab calls follow the API documentation but have not yet run against a real instance.

## UI audit, October 2026

Every button, menu and form in the UI was traced to a server route and a GitLab call. The audit fixed these problems:

| Area | Was | Now |
|---|---|---|
| Agent API modal | Never rendered; its three entry points were hidden | Opens from the top bar, Settings, Dashboard and search |
| Agent "Live simulator" | Created a real issue in the first project and reported success on failure | **Try it** names the project, warns that it creates a real item, reports the actual result |
| Dashboard | "Simulate API/Cache hit" wrote fake metrics; counters started at made-up totals | Simulator removed; counters start at zero |
| Merge request drawer | Labels, close and reopen had handlers but no buttons; drawer went stale after changes | Labels, approve, draft, close and reopen in the drawer; drawer follows the list |
| Work item drawer | Labels could be removed but not added | Add-label picker |
| Attachments | Files inlined as base64 in the comment body | Uploaded to the project; GitLab's Markdown link inserted |
| CI editor | "Trigger pipeline" retried demo pipeline 30101; a read error loaded sample YAML that a save would commit | Unchecked adds `[skip ci]`; errors are shown; GitLab lint on pause |
| Pages | "Re-deploy" retried pipeline 30101; size, date and status were made up | Runs a watched pipeline; values are real or marked unknown |
| Releases | "Auto-generate notes" inserted canned text; tag compare showed a fixed sentence | Both read commits through the compare API |
| Badge preset | Images on gitlab.com and fixed shields.io values | Badges from the project's own instance |
| Group variables and badges | Hardcoded demo group 101 | The project's namespace |
| MR draft (live) | Ignored | Uses the `Draft:` title prefix |
| MR approval state (live) | Always false | Marks MRs you approved |
| Avatar upload (live) | Changed demo data only | Uploads to GitLab |
| Errors | Most failed actions only logged to the console | A toast names the failed action |
| Sync bar | A timer drove a fake percentage | Indeterminate bar with elapsed time |
| Failed list reads | The server returned `[]`, so a GitLab outage looked like an empty project | The request fails; the toast names each source that failed and the other lists still load |
| Masked variables | Values were sent to the browser in the list and the live update stream | Left out; fetched one at a time on Reveal, Copy or Clone |
| Subtask toggle | The drawer kept the old description; a failed save left the checkbox changed | The drawer shows GitLab's updated item; a failure undoes the checkbox |
| Settings modal | A second form for GitLab host and token, next to Vault → GitLab profiles | Sync settings only, with a link to the vault |

## Status by feature

| Feature | Status | Notes |
|---|---|---|
| Sign-in, vault, sessions, TLS | Verified locally | Tests plus end-to-end runs |
| Agent token permissions and CI budgets | Verified locally | REST/MCP deny-path tests cover scopes, project and tool restrictions, expiry, shared persisted daily CI cap; live GitLab not yet checked |
| Encrypted backup and recovery | Verified locally | Wrong keys, tamper, concurrent restore, rollback, session revocation and token/quota preservation; browser recovery and print checks |
| Request scheduling and refresh | Verified locally | Single-flight sync, saved settings, lane budgets, 429 deadlines and queue expiry covered by tests |
| Aggregate list coverage | Verified locally | Partial failures and recent-15 scope shown in the UI; first 50 member projects only until pagination lands |
| Cache and container health | Verified locally | Bun SQLite WAL, bounded cache and journal, legacy migration and HTTP/HTTPS liveness probes |
| Inbox | Demo only | User-scoped endpoints; not yet run against a live instance |
| Watches, rules, push channels | Verified with a capture server | ntfy and webhook bodies checked; no real phone or Slack yet |
| Failure excerpt | Unit tested on runner-shaped traces | Real runner section markers not yet checked |
| Run pipeline, declared variables | Demo only | GraphQL `ciConfigVariables` availability varies by GitLab version |
| MCP server | Verified with the official MCP client | Claude Code and Codex end to end not yet run |
| Task briefings and persistent handoffs | Verified locally | Demo MCP/CLI runs, fake GitLab reads, encrypted restart persistence and profile isolation; not yet checked against live GitLab |
| BugKB integration | Verified with real BugKB hooks in disposable storage | Authenticated MCP/CLI checks for search, explicit writes, duplicates, evidence, trust and offline fallback; GitLab attribution tested with a fake GitLab; shared deployment not yet checked |
| Notes and tasks | Verified locally | Encrypted persistence across lock and restart, demo/live separation, migrate (both modes) against demo data and a fake GitLab, ZIP export checked with an independent reader, `unzip -t` and Python `zipfile`; not yet migrated against a live instance |
| Work items, MRs, milestones, labels | Wired | List calls return the first 50 per project |
| CI editor, lint | Wired | GitLab lint on request; local parser for the graph |
| Variables, badges, Pages | Wired | Masked values are read one at a time on Reveal; Pages needs GitLab 16.8+ |
| `lazy` CLI | Verified against a fake GitLab | push, follow, failures, retry, MR create, exit codes; not yet run against a live instance |
| `lazy env`, `env pull`, `run` | Verified in demo mode | Variable precedence and scopes, file variables, vault fallback for hidden values; group inheritance (`/projects/:id/groups`) and hidden variables not yet checked against a live instance |
| Token expiry, PAT rotation | Verified against a fake GitLab | Needs GitLab 16.0+ to read a PAT, 16.10+ to rotate; not yet run against a live instance |
| Packages | Wired, read-only | |
| Releases, tags, release notes | Demo only | Compare API |
| Runners | Wired | `/runners` lists only runners you own, not the admin view |

The full list of open work is in `devtracker-pending.md` in the repository.
