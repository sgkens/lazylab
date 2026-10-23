# Recovered parallel work

Claude's four interrupted lanes were combined on a verified review branch, then merged into `develop` as `e8909e8`; follow-up live and Windows acceptance results are in `ACCEPTANCE.md`.

## Checkout

Review branch: `feature/recovered-review`. Its worktree is `.claude/worktrees/recovered-review` beneath the original lazylab checkout. Base: `a765dc3` on `feature/notes`. The primary checkout now follows `develop` with the updated tracker. All four feature branches remain available independently.

Task checkboxes in the review checkout describe the combined branch.

## Completed work

| Branch | Tasks | Feature tip |
|---|---|---|
| `feature/api-budget` | GL-19/20/22, WATCH-10/14: single-flight refresh, budgets, rate limits, adaptive polling, partial coverage/errors | `61014d8` |
| `feature/agent-safety` | GL-21, AGENT-2/7/16, SEC-6, ENV-11: project selection, scopes/expiry, project/tool restrictions, persisted daily CI budgets | `6086bb3` |
| `feature/security-hardening` | SEC-1/3/5/9/10: crypto/session tests and fixes, device revocation, throttling, encrypted backups/recovery, production CSP | `4465b23` |
| `feature/cache-build` | CACHE-1/3/6/8, BUILD-2/5: SQLite WAL, retention, bounded journal, legacy migration, lazy chunks, container health | `8b23383` |

BUILD-9 is covered by the combined session, agent REST, auto-fetch route-validation and scheduler tests: 23 task IDs completed overall. Integration also tests that recovery preserves token restrictions and spent CI quota, and isolates watch tests from session-triggered background sync.

## Verification on the combined branch

| Check | Result |
|---|---|
| `bun run lint` | Pass |
| `bun test` | 321 pass, 0 fail across 27 files |
| `bun run build` | Pass; entry JavaScript about 394 kB, every JavaScript chunk below 500 kB |
| `bun run build` from `docs/` | Pass; 25 pages and local search indexed |
| `bun run cli:build` | Pass for this host |
| Docker build | Pass; local tag `lazylab:recovered-review` |
| Docker health | Healthy over HTTP and built-in self-signed HTTPS |
| Production Chromium | Lazy dashboard/editor, partial coverage/errors, recovery-key printing, fresh-instance restore and authentication pass; no page errors |
| Browser policy | No unexpected CSP violations; injected inline script blocked |

Checks used disposable data directories and containers, which were removed afterwards. The developer's real vault and GitLab account were not used.

## Review fixes

- Restricted briefings fetched related data outside the project allowlist before filtering. Checks now precede requests and derived context.
- Inherited request-budget names such as `toString` bypassed plan validation.
- Long server retry deadlines were shortened; explicit deadlines now remain authoritative.
- Expired queued requests could receive a newly freed slot; expiry now precedes allocation.
- SQLite text length counted characters; byte-cap eviction now measures UTF-8 bytes.

The shared BugKB was offline with no launcher, so no external entry was written. Findings are retained here, including bundle reduction from about 660 kB to about 394 kB after all integrated features.

## Remaining work

Optional GL-2 pagination and SEC-12 Host-header allowlist remain open. Aggregate views disclose the first 50 member projects and recent-15 fan-out scope. Browser backup uploads accept files up to 8 MiB.

This recovery checkpoint initially lacked live GitLab and native Windows evidence; those checks are now recorded in `ACCEPTANCE.md`. Hosted CI results are reported after publication. Real notification delivery, Tailscale Serve and macOS remain unverified. No release was published.
