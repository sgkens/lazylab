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
| `tls/` | Self-signed certificate and key, when generated | No (key file mode 0600) |

Back up `vault.json` and remember the password. The cache can be deleted at any time; lazylab refetches from GitLab.

### Cache retention

A sweep runs at start and every 10 minutes. It deletes:

- rows that expired more than `LAZYLAB_CACHE_STALE_HOURS` ago;
- the least recently written rows beyond `LAZYLAB_CACHE_MAX_ROWS` or `LAZYLAB_CACHE_MAX_MB`.

When the member project list is refreshed, expired rows of projects no longer in it are deleted without the grace period. Switching or removing the active GitLab profile purges the whole cache. The change journal has its own limits (`LAZYLAB_JOURNAL_*`).

## In-app settings

- **Vault → Notifications:** push channels and notification rules.
- **Settings modal (gear icon):** background refresh interval, **Refresh now**, and the active GitLab connection. Hosts and tokens are managed in **Vault → GitLab profiles**; the modal links there.
- **Vault → Account:** change password, signed-in devices.

## Container health

`GET /healthz` returns HTTP 200 with `{"status":"ok"}` when the server can answer requests. It works before setup and while the vault is locked, exposes no vault or session data, and makes no GitLab requests. It is a liveness probe; it does not verify GitLab connectivity or vault readiness.

The Docker image probes this route every 30 seconds, with a 5-second timeout, a 20-second startup allowance and three failed attempts before marking the container unhealthy. The probe follows `HOST`, `PORT` and built-in TLS settings, including the generated self-signed certificate. Container health alone does not restart a container.
