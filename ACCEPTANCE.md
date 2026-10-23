# Acceptance verification, 2026-10-24

The recovered feature set passed live GitLab.com and native Windows acceptance checks after being merged into `develop`.

## Scope and results

The recovery merge is `e8909e8`. Follow-up fixes are `83f3a01` (Windows mode assertions) and `08bf5dd` (agent HTTP rate-limit responses). All remote test writes were confined to a private disposable project, id `88011201`; its deletion was requested after the checks. The developer's existing projects were not changed by the acceptance workflow.

| Check | Result |
|---|---|
| Read-only agent and explicit project | Missing project rejected; disallowed project and writes denied |
| Live issues | Create, read and close through agent REST matched GitLab |
| Live merge requests | Create and close against the explicit disposable project |
| MCP | Read actual issue; tool discovery obeyed the token allowlist |
| Live CI | Pipeline created, watch recorded, successful smoke job and intentional failing job ran on GitLab.com |
| Retry and quota | MCP retried the failed job; a third CI action was rejected after one REST run and one MCP retry |
| Encrypted recovery | Backed up the live profile, restarted, reset via recovery key; scoped tokens remained usable |
| Linux/WSL, Bun 1.3.11 | Lint, 322 tests, SPA build, host CLI compile and CLI version passed |
| Native Windows, Bun 1.3.11 | Lint, 321-test full suite, SPA/CLI builds, CLI executable and production server/health/SPA/CSP passed |
| Windows follow-up | Updated 17-test agent REST suite, including rate-limit regression, passed |
| Pinned CI container | Lint, 322 tests, SPA build, CLI compile and version passed in `oven/bun:1.3.11` |

The preceding recovery checks also verified production Chromium behaviour, partial-list error reporting and the Docker image's HTTP/HTTPS health. These details remain in `RECOVERY.md`.

## Findings fixed

Windows does not expose POSIX permission bits through `stat` the way Linux does. Vault backup tests now assert mode 0600 only on POSIX, while encrypted content, restore, restart and rollback checks run on Windows too. Windows ACL isolation was not independently audited.

A real GitLab HTTP 429 caused agent REST routes to return 500; single-item readers could turn it into a false 404. The scheduler's typed rate-limit error now produces HTTP 429 with retry timing, including pipeline creation. Regression checks cover issue/MR reads, issue writes and pipeline runs. Live issue and MR updates passed after the pause.

The first hosted pipeline exposed a third issue: the quota test selected its retry job from whichever shared demo pipeline happened to come next. Another test could leave a jobless pipeline there, so filesystem-dependent suite ordering caused a failure. The regression now creates that interfering state explicitly, uses a seeded job, and restores the job status. The full suite and build commands passed in the pinned CI container after the fix. Hosted rerun status is reported with the publication result.

The shared BugKB was unreachable and no launcher was installed, so findings are retained here instead of being written to the service.

## Environment and cleanup

Windows verification used an isolated source copy and temporary official Bun 1.3.11 runtime; no global Windows runtime was installed. Local servers and test data were disposable. Authentication used the existing Windows Git credential helper; credentials are absent from this report and test output.

Tailscale was unavailable. Tailscale Serve, native macOS, real phone/chat notification delivery and a Windows ACL audit remain unverified. Hosted CI status is checked after pushing `develop`; this report does not claim hosted execution has passed. No release or tag was created.
