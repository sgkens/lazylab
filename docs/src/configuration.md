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
| `labwi_cache.sqlite`, `labwi_cache.wal` | Cached GitLab responses and a change journal | No |
| `settings.json` | Non-secret server settings: background refresh interval, request budget | No |
| `tls/` | Self-signed certificate and key, when generated | No (key file mode 0600) |

Back up `vault.json` and remember the password. The cache can be deleted at any time; lazylab refetches from GitLab.

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
