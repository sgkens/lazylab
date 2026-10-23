# Changelog

Notable changes to lazylab, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/) once 1.0 is released. Commit-level detail is in the git history (Conventional Commits).

## [Unreleased]

Version in `package.json`: 0.1.0. No release has been tagged yet.

### Added

- **Container health:** unauthenticated `/healthz` liveness route and a Docker health check that supports HTTP and built-in HTTPS without contacting GitLab.

- **Watch polling** (WATCH-10, WATCH-14): saved 10–300 second base interval in Settings; older pipelines and unchanged merge requests back off to at most 10 minutes. A watch is removed only after two consecutive typed GitLab API 404 responses; network, permission and rate-limit failures retain it.

- **Request scheduler** (GL-19): every GitLab API call goes through one budget with per-plan presets (GitLab.com Free default: 4,000/h, 80/min, leaving room for other tools on the account), custom values, priority lanes (clicks, then watches, then background refresh), a slowdown when `RateLimit-Remaining` runs low, a pause on 429 that honours `Retry-After`, and a 15 s request timeout. The sync bar shows when requests are held back; `GET /api/status` reports the state under `scheduler`.
- **Auto-fetch single-flight** (GL-20): only one background refresh runs at a time and the next one starts an interval after the previous one finished. The server enforces a 30 s minimum (Off or 30 to 3,600 s), saves the interval in `settings.json` across restarts, and reports the loop state under `autoFetch` in `GET /api/status`. The 15 s option is gone; a 5 min option was added.
