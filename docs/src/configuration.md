---
title: Configuration
abstract: lazylab reads its network, TLS and storage settings from environment variables; GitLab tokens and every other secret live in the vault, not in the environment.
---

## Where settings come from

| Source | Holds |
|---|---|
| `.env` (Bun loads it on metal; `compose.yaml` passes it to the container) | Network, HTTPS, storage path |
| The vault (`<data dir>/vault.json`) | GitLab profiles, CI secrets, runner tokens, secrets, agent tokens, notification channels and rules, watches |
| The browser | Theme, the last run-pipeline variables per project |

Copy the template to start. Shell: bash, repository root.

```bash
cp .env.example .env
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Listen address on metal. `0.0.0.0` listens on every interface |
| `PORT` | `3000` | Listen port |
| `LAZYLAB_BIND` | `127.0.0.1` | Docker only: host address `compose.yaml` publishes the port on |
| `LAZYLAB_PORT` | `3000` | Docker only: host port |
| `LAZYLAB_DATA_DIR` | `./.data` (metal), `/data` (Docker) | Vault, cache and TLS files |
| `LAZYLAB_JOURNAL_MAX_BYTES` | `5242880` (5 MiB) | Size at which the cache journal file is rotated to `<name>.1`; one previous file is kept. `0` disables rotation |
| `LAZYLAB_JOURNAL_KEEP_ROWS` | `10000` | Newest change-journal rows kept in the cache database. `0` keeps all |
| `LAZYLAB_JOURNAL_KEEP_DAYS` | `7` | Change-journal rows older than this are pruned. `0` keeps rows of any age |
| `LAZYLAB_CACHE_STALE_HOURS` | `24` | How long expired cache rows stay available as a fallback before they are deleted |
| `LAZYLAB_CACHE_MAX_ROWS` | `5000` | Cache row cap; the least recently written rows are deleted first. `0` disables the cap |
| `LAZYLAB_CACHE_MAX_MB` | `128` | Cap on the stored cache size in MiB. `0` disables the cap |
| `LAZYLAB_CACHE_MEMORY_ENTRIES` | `256` | Parsed cache entries kept in memory; the rest are read from SQLite on demand |
| `LAZYLAB_BUGKB_URL` | unset (disabled) | Independent BugKB service base URL; adds prior findings to briefings and enables explicit KB tools. See [Shared findings](/agents/knowledge/) |
| `LAZYLAB_TLS` | `off` | `on` serves HTTPS directly. See [Remote access](/remote-access/) |
| `LAZYLAB_TLS_CERT`, `LAZYLAB_TLS_KEY` | unset | PEM certificate and key. Without them a self-signed certificate is generated |
| `LAZYLAB_TLS_SANS` | unset | Extra names and IPs for the self-signed certificate, comma-separated. Required in Docker |
| `LAZYLAB_TRUST_PROXY` | unset | Trust `X-Forwarded-*` from a reverse proxy: `loopback`, `true`, a hop count, or CIDR ranges |
| `LAZYLAB_PUBLIC_HOSTS` | unset | Hostnames the UI is reached through when a proxy rewrites the `Host` header |
| `GITLAB_HOST`, `GITLAB_TOKEN` | unset | Imported into the vault once during first-run setup, then ignored |
| `NODE_ENV` | `development` with `bun run dev` | `production` serves the built `dist/` instead of Vite middleware |

## Data directory

| Path | Contents | Encrypted |
|---|---|---|
| `vault.json` | Everything in the vault | Yes, AES-256-GCM |
| `lazylab_cache.sqlite` (plus SQLite's `-wal` and `-shm` files), `lazylab_journal.jsonl`, `lazylab_journal.jsonl.1` | Cached GitLab responses and a change journal with one rotated file. Earlier builds named them `labwi_cache.*`; they are renamed on the first start | No |
| `settings.json` | Non-secret server settings: background refresh interval, watch interval, request budget | No |
| `tls/` | Self-signed certificate and key, when generated | No (key file mode 0600) |

Download a vault backup from **Vault → Account** (or copy `vault.json`), create a recovery key, and remember the password; see [Backup and recovery](/guide/vault/#backup-and-recovery). The cache can be deleted at any time; lazylab refetches from GitLab.

### Cache retention

A sweep runs at start and every 10 minutes. It deletes:

- rows that expired more than `LAZYLAB_CACHE_STALE_HOURS` ago;
- the least recently written rows beyond `LAZYLAB_CACHE_MAX_ROWS` or `LAZYLAB_CACHE_MAX_MB`.

When the member project list is refreshed, expired rows of projects no longer in it are deleted without the grace period. Switching or removing the active GitLab profile purges the whole cache. The change journal has its own limits (`LAZYLAB_JOURNAL_*`).

## In-app settings

- **Vault → Notifications:** push channels and notification rules.
- **Settings modal (gear icon):** background refresh interval, **Refresh now**, and the active GitLab connection. Hosts and tokens are managed in **Vault → GitLab profiles**; the modal links there.
- **Vault → Account:** change password, signed-in devices.

### Background refresh

The interval is Off or 30 to 3,600 seconds; `POST /api/config/autofetch` rejects other values with 400. It is saved in `settings.json` and survives restarts. Only one refresh runs at a time: the next one is scheduled when the previous one finishes, and **Refresh now** during a running refresh waits for that refresh instead of starting a second one. `GET /api/status` reports the loop under `autoFetch` (`running`, `lastDurationMs`, `nextRunAt`, `skippedCycles`).

### Request budget

Every GitLab API call waits for a slot in one request scheduler. GitLab counts requests per user, so glab, CI tools and agents on the same account share the limit with lazylab; the presets leave about 20% of each GitLab.com plan limit for them.

| Plan setting | Per hour | Per minute |
|---|---|---|
| GitLab.com Free (default) | 4,000 | 80 |
| Premium | 12,000 | 1,000 |
| Ultimate | 20,000 | 1,600 |
| No cap (self-managed without limits) | none | none |
| Custom | your value, 0 = none | your value, 0 = none |

Change it in the Settings modal or with the API (saved in `settings.json`):

```bash
# Shell: bash; $COOKIE holds the session cookie copied from a signed-in browser (name=value)
curl -X POST http://localhost:3000/api/config/request-budget \
  -H "Cookie: $COOKIE" -H 'Content-Type: application/json' \
  -d '{"plan":"custom","perHour":6000,"perMinute":200}'
```

How the scheduler spends the budget:

- **Lanes:** clicks, CLI and MCP calls go first, then watch polls, then background refresh and token scans. Watches leave 10% and background leaves 20% of the bucket for the lanes above them.
- **GitLab's own headers:** when `RateLimit-Remaining` falls below 20% of `RateLimit-Limit`, background refresh waits for `RateLimit-Reset`; below 5%, watches wait too.
- **429:** every lane pauses until `Retry-After` (or `RateLimit-Reset`, or 60 s), with growing backoff on repeated 429s. A read that hit the 429 is retried once after the pause. A request that cannot start within its wait limit (30 s for clicks, 2 min for watches, 5 min for background) fails with a rate-limit error instead of hanging.
- **Timeout:** 15 s per request, including the response body; job logs and uploads get 60 s.
- **Status:** the sync bar shows "GitLab rate limit: paused until HH:MM" or "GitLab quota low" while requests are held back. `GET /api/status` has the full state under `scheduler` (budget, tokens, queue per lane, last `RateLimit-*` values, counts of 429s and timeouts).

### Watch polling

Settings → **Watch check interval** sets the base interval from 10 to 300 whole seconds (default 15).
`POST /api/config/watch-poll` accepts `{ "intervalSec": 30 }`, rejects invalid values with 400, and saves `watchPollSec` in `settings.json`. `GET /api/status` reports `watchPollSec`; watch views include `nextCheckAt`.

Pipeline creation time and job start time determine backoff: under 10 minutes uses the base interval, 10–30 minutes doubles it, 30 minutes–2 hours quadruples it, and older runs use eight times the base, capped at 10 minutes. Merge requests use time since their last observed change. Failures retry at the base interval and also obey the shared request scheduler's quota limits.

Only two consecutive `GitLabApiError` responses with HTTP status 404 remove a missing watch. A successful check or another error resets that count. Permission failures, timeouts, rate limits and error messages containing “not found” retain the watch.

## Container health

`GET /healthz` returns HTTP 200 with `{"status":"ok"}` when the server can answer requests. It works before setup and while the vault is locked, exposes no vault or session data, and makes no GitLab requests. It is a liveness probe; it does not verify GitLab connectivity or vault readiness.

The Docker image probes this route every 30 seconds, with a 5-second timeout, a 20-second startup allowance and three failed attempts before marking the container unhealthy. The probe follows `HOST`, `PORT` and built-in TLS settings, including the generated self-signed certificate. Container health alone does not restart a container.
