# lazylab

A self-hosted web UI and agent API for GitLab, run on your own machine and usable from other machines on your network. It covers work items, merge requests, pipelines, runners, CI variables and releases, with an encrypted vault for GitLab tokens and other secrets.

## Security model

- **One admin account**, created on first run with a setup code printed to the server log.
- **Vault:** GitLab tokens, CI secrets, runner tokens and generic secrets are stored in `<data dir>/vault.json`, encrypted with AES-256-GCM.
  - The data key is wrapped with a key derived from your password (scrypt, N=2^16).
  - After a restart the vault is **locked**: GitLab sync is paused until you sign in.
  - **Forgetting the password means losing the vault contents.**
- **Sessions** are held in memory (HttpOnly, SameSite=Strict cookies, 12 h idle / 7 days max). Restarting the server or locking the vault signs every device out.
- **Writes** from the browser must come from lazylab's own origin. Login is throttled after 5 failures per IP.
- **Agents** use bearer tokens issued in Vault → Agent tokens; only their SHA-256 hash is stored.
- The **GitLab data cache** (`<data dir>/labwi_cache.*`) is not encrypted.

## Requirements

- Bun 1.3+ (metal), or Docker with Compose v2.
- A GitLab personal access token with `api` scope, added during setup or later in the Vault. Without one, lazylab runs in demo mode on seeded sample data.

## Configuration

Shell: bash, repo root.

```bash
cp .env.example .env
```

Every option is documented in `.env.example`. GitLab tokens are not configured in `.env`; add them in the setup screen or the Vault. A `GITLAB_TOKEN` present at first-run setup is imported once.

## First run

1. Start lazylab (below) and read the setup code from the log: `docker compose logs lazylab`, or the terminal on metal.
2. Open the UI, enter the code, choose a username and a password of 12+ characters, and optionally a GitLab host + token.
3. For agents: Vault → Agent tokens → Create, then `export LAZYLAB_URL=... LAZYLAB_TOKEN=llab_...` on the machine running the agent.

## Run on metal (Bun)

Shell: bash, repo root.

```bash
bun install
bun run dev                 # Vite middleware + API with watch, http://127.0.0.1:3000
bun run build && bun run start   # production: serves dist/ + API
```

## Run in Docker

Shell: bash, repo root.

```bash
docker compose up -d --build   # http://127.0.0.1:3000
docker compose logs -f lazylab
docker compose down
```

The vault, cache and TLS files live in the `lazylab-data` volume at `/data`.

## Access from another machine

lazylab listens on loopback only by default. To use it from a laptop on your LAN or tailnet, expose it **and** use HTTPS; otherwise your password and session cookie travel in plain text (lazylab logs a warning at startup when this is the case).

### Option A: Tailscale Serve or Caddy (recommended)

Keep lazylab on loopback and let the proxy terminate HTTPS. Shell: bash, on the desktop.

```bash
# .env
LAZYLAB_TRUST_PROXY=loopback          # metal; for Docker use the bridge range, e.g. 172.16.0.0/12

# Tailscale: serves https://<desktop>.<tailnet>.ts.net -> http://127.0.0.1:3000
tailscale serve --bg 3000
```

If saves fail with `Cross-origin request rejected`, the proxy is rewriting the Host header. Set `LAZYLAB_PUBLIC_HOSTS=<desktop>.<tailnet>.ts.net`.

### Option B: built-in HTTPS

```bash
# .env
LAZYLAB_TLS=on
LAZYLAB_TLS_SANS=192.168.1.50,desktop.lan   # names/IPs the laptop will use
HOST=0.0.0.0                                # metal
LAZYLAB_BIND=0.0.0.0                        # Docker
```

- With no `LAZYLAB_TLS_CERT`/`LAZYLAB_TLS_KEY`, a self-signed certificate is generated into `<data dir>/tls/` on first start, and its SHA-256 fingerprint is logged. Compare that fingerprint with the browser's certificate viewer the first time you connect from the laptop.
- In Docker, `LAZYLAB_TLS_SANS` is required: the container's own hostname is meaningless to the laptop.
- To avoid browser warnings, issue a cert with [mkcert](https://github.com/FiloSottile/mkcert) for the desktop's names, trust mkcert's root CA on the laptop, and point `LAZYLAB_TLS_CERT`/`LAZYLAB_TLS_KEY` at the files. Delete `<data dir>/tls/` to regenerate the self-signed cert after changing SANs.

## Notifications

lazylab polls watched pipelines, jobs and merge requests every 15 seconds while the vault is unlocked, and notifies you when they finish or change.

- **Watch:** the bell button on a running pipeline or job, or on a merge request in the Inbox. Agents and scripts use `POST /api/agent/watches` with `{"kind":"pipeline","projectId":1,"targetId":2}`.
- **Rules** (Vault → Notifications): auto-watch the running pipelines of your own MRs, new review requests, new commits on MRs you review, runner offline.
- **Delivery:** the bell menu, a desktop notification when the tab is in the background (needs HTTPS or localhost), and every enabled push channel.

Push channels are stored encrypted in the vault:

| Type | Fields | Notes |
|---|---|---|
| ntfy | server URL, topic, optional access token | Subscribe to the topic in the ntfy phone app. A public `ntfy.sh` topic is readable by anyone who guesses its name; use a long random topic or a token-protected server |
| Gotify | server URL, application token | Self-hosted |
| Webhook | URL, format `json` / `slack` / `discord` | Slack and Discord incoming webhooks, or any JSON endpoint |

Each channel can take all events or failures only. Use **Test** to check it.

## CI failure triage

A failed job opens on a **Failure** view instead of the full log. It shows the failure reason, the exit code, the error line, and the last lines of the section that failed (40 at most). Runner output after the script is left out: artifact upload, cache archive and cleanup.

- **CI/CD:** a failed pipeline lists the error line of each failed job under "Why it failed". Jobs allowed to fail are left out.
- **Notifications:** a failure notification includes the failing job's error line, and "Why it failed" opens the excerpt. A desktop failure notification also opens it when clicked.
- **Retry:** retrying a failed job creates a new job and watches it. Failure reasons that usually pass on retry (runner system failure, stuck or timeout, scheduler, API) are marked "likely passes on retry".
- **Copy excerpt:** copies the excerpt as plain text, ready for a ticket or an agent prompt.

### Run pipeline

**Run pipeline** in CI/CD starts a pipeline for a branch or tag. The form fills in the variables declared under `variables:` in `.gitlab-ci.yml` for that ref, with their descriptions and option lists. It reads these through GitLab GraphQL `ciConfigVariables`. If the query fails, you add the variables by hand. Variables left at their declared default are not sent. The last ref and variables used in each project are remembered in the browser. By default lazylab watches the new pipeline and notifies you when it finishes.

```bash
# Shell: bash, with LAZYLAB_URL and LAZYLAB_TOKEN (an agent token) exported
curl -s -H "Authorization: Bearer $LAZYLAB_TOKEN" -H "Content-Type: application/json" \
  -X POST "$LAZYLAB_URL/api/agent/pipelines" \
  -d '{"projectId": 42, "ref": "main", "variables": [{"key": "DEPLOY_ENV", "value": "staging"}]}'
```

## Agent skills

`skills/` contains a `lazylab-agent` skill for Claude Code, Codex and Antigravity. See [skills/README.md](skills/README.md).

## Project tracking

Open epics, tasks and the wired/stub audit are in [devtracker-pending.md](devtracker-pending.md).

## Layout

| Path | Contents |
|---|---|
| `server.ts` | Express entry point; Vite middleware in dev, static `dist/` in prod |
| `server/apiRouter.ts` | REST routes, SSE `/api/events`, `/api/agent/*` |
| `server/session.ts` | Setup, login, sessions, origin check, agent bearer auth (`/api/session/*`) |
| `server/vault.ts` | Encrypted vault file: profiles, entries, agent tokens |
| `server/vaultRouter.ts` | `/api/vault/*` routes, CI secret push to GitLab |
| `server/tls.ts` | Built-in HTTPS, self-signed cert generation |
| `server/inbox.ts` | Cross-project inbox (`/api/inbox`, `/api/agent/inbox`) |
| `server/watch.ts` | Watch poller, notification rules, history |
| `server/notify.ts` | Push delivery: ntfy, Gotify, webhook |
| `server/notifyRouter.ts` | `/api/notify/*` routes |
| `server/triage.ts` | Job trace failure excerpt, run-pipeline input validation |
| `server/gitlabClient.ts` | GitLab REST v4 client plus demo-mode dataset |
| `server/cacheDb.ts` | sql.js cache snapshot + append-only journal in `.data/` |
| `server/metricsManager.ts` | API/cache hit counters and rate-limit tracking |
| `server/yamlParser.ts` | Minimal `.gitlab-ci.yml` parser for the editor |
| `src/` | React 19 + Tailwind 4 SPA |
