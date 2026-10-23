---
title: Security model
abstract: lazylab has one admin account, keeps every secret in a password-encrypted vault that is locked after each restart, and authenticates browsers with sessions and agents with revocable bearer tokens.
---

## Accounts and setup

- There is one admin account, created at first run.
- Creating it needs the setup code printed to the server log, so only someone with console or `docker logs` access can claim a new instance.
- Passwords must be at least 12 characters.
- After 4 failed sign-ins from one IP, each further attempt waits 2 s, 4 s, 8 s and so on, up to 15 minutes.
- A wrong current password in **Change password** counts as a failed sign-in.
- An IP is forgotten after an hour without failures. At most 10,000 IPs are tracked; beyond that the one with the oldest failure is dropped.

## The vault

```mermaid
flowchart LR
  P[Password] -->|scrypt N=2^16, r=8, p=1| K[Key-encryption key]
  R[Recovery key, 256 bit, optional] -->|HKDF-SHA256| KR[Recovery key-encryption key]
  K -->|AES-256-GCM unwrap| D[Data key, 256 bit]
  KR -->|AES-256-GCM unwrap| D
  D -->|AES-256-GCM| S[Secrets payload]
```

- `vault.json` (file mode 0600) holds the scrypt parameters and salt, the data key wrapped with the password-derived key, optionally a second copy of the data key wrapped with the recovery key, and the payload encrypted with the data key.
- The recovery key is 256 random bits. Because it is not a human-chosen secret, it is stretched with HKDF-SHA256 (own salt) rather than scrypt. Its wrapped copy binds a separate purpose string, so it cannot be swapped with the password copy. See [Backup and recovery](/guide/vault/#backup-and-recovery).
- The payload holds:
  - GitLab profiles
  - CI secrets, runner tokens and generic secrets
  - agent token hashes
  - notification channels and rules
  - watches
- Every write uses a fresh IV, and both layers bind a purpose string as associated data.
- The data key exists only in memory, between a successful sign-in and a lock or process exit.
- After a restart the vault is locked. GitLab sync, watches and agent access stay paused until you sign in.
- **Vault → Account → Lock** wipes the key from memory and signs every device out.
- **A forgotten password with no recovery key and no backup means the vault contents are lost.** Changing the password re-wraps the data key; the secrets are not re-encrypted, and the recovery key keeps working.
- Backups are the encrypted vault file. Downloading one, creating a recovery key and restoring each ask for the current password.

## Browser sessions

- Sessions are held in memory, so a restart signs everyone out.
- Session cookies are `HttpOnly` and `SameSite=Strict`. They also get `Secure` when the request arrived over HTTPS, directly or through a trusted proxy.
- Sessions expire after 12 hours idle or 7 days in total.
- Every write must carry an `Origin` (or `Referer`) whose hostname matches the request host or `LAZYLAB_PUBLIC_HOSTS`. This blocks cross-site request forgery.
- **Vault → Account** lists signed-in devices with IP address, browser, sign-in time and last activity. **Revoke** signs one device out; it has to sign in again with the password. The vault stays unlocked and other devices are not affected. Expired sessions are not listed.

## Agent tokens

- Agent tokens (`llab_…`) are created in **Vault → Agent tokens**. They are shown once and stored only as a SHA-256 hash.
- A token authenticates `/api/agent/*` and `/mcp`. It does not open the vault or the browser UI.
- `/mcp` also rejects requests whose `Origin` header names a different host. This prevents DNS rebinding.
- Revoking a token takes effect on its next request.
- Tokens act as the GitLab profile that is active at the time, limited by the token's permissions below.

### Token permissions

Each token carries these settings, chosen at creation and changeable later with **Edit**. They apply to both `/api/agent/*` and `/mcp`.

| Setting | Values | Effect |
|---|---|---|
| Scope | **Read only** (default for new tokens) or **Read and write** | Read only may read GitLab and change lazylab's own state: watches, handoffs and notes. Read and write may also create and change issues and merge requests, comment, run pipelines, retry jobs and record BugKB findings. Denied REST calls get `403`; MCP hides the tools and refuses calls with a tool error |
| Allowed MCP tools | Every tool (default), or a list of tool names | Only listed tools appear in `tools/list` and may be called. Scope, project and secret permissions still apply. An empty list allows no tools. This setting applies to MCP; REST uses the other permissions |
| Allowed projects | Numeric project ids, or empty for every project | Calls on any other project get `403` (REST) or a tool error (MCP), whether the project is given as an id or a path. Inbox, project and watch lists leave other projects out |
| Default project | One allowed project, or none | Used by REST calls that omit `projectId`. MCP tools always name the project |
| Expiry | 7, 30 (default in the UI), 90 or 365 days, or none | After it, the token gets `401 Agent token expired at …` |
| Can read secrets | Off (default) or on | Only such tokens can call `get_env`, which returns CI/CD variable values and named vault secrets (for `lazy env pull` and `lazy run`). Give agents tokens without it. Each `get_env` call is written to the journal with the token name |

The list shows each token's scope, projects, expiry and when it was last used. The last-used time is saved at most once a minute per token, so it can lag by up to a minute, and by more after a restart.

### Tokens created before scopes

Tokens stored before these settings existed keep the access they had: **Read and write**, every project, no expiry. They show a **legacy: review** badge. Edit each one to narrow it, or revoke it and create a new one. Nothing changes for an agent until you do.

## What is not encrypted

- The GitLab response cache (`lazylab_cache.sqlite` and `lazylab_journal.jsonl`). It holds issue, merge request and pipeline data, but no tokens. Switching or removing the active GitLab profile purges it; deleted rows are overwritten on disk (SQLite `secure_delete`). Expired rows are deleted after a grace period, see [Cache retention](/configuration/#cache-retention).
- Notification history is in memory only.
- Job logs and failure excerpts are fetched on demand and not stored.

## Sharing with other people

lazylab is built for one person. Anyone you give the password or an agent token to acts with your GitLab token.

Agent token CI limits count combined pipeline runs and job retries per UTC day, persist before the GitLab request, and survive restart. New tokens default to 50 attempts, 0 denies CI, and null is unlimited. Tokens predating this setting retain unlimited access; edit them to set a budget. Failed upstream attempts count.

## Browser content policy

Production responses send a Content-Security-Policy. Scripts and API connections are restricted to the app origin; inline scripts, eval, embedded frames and objects are blocked. Inline style attributes remain allowed for React's dynamic colours and dimensions. Images allow the app origin, data URLs and HTTP/HTTPS GitLab avatars, badges and Markdown images. The Google Fonts stylesheet and font host used by the app are permitted explicitly.

The policy is omitted outside `NODE_ENV=production`, since Vite injects development scripts and uses a WebSocket connection for hot reload. The policy supplements the session and Origin guards; it does not replace them.
