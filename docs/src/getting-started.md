---
title: Getting started
abstract: Install lazylab with Bun or Docker, claim the instance with the setup code from the server log, and connect a GitLab profile.
---

## Requirements

- Bun 1.3 or later, or Docker with Compose v2.
- A GitLab personal access token with the `api` scope. Without one, lazylab runs in [demo mode](/#demo-mode).
- For notifications on a phone: the ntfy app, or a Gotify server.

## Install and run with Bun

Shell: bash, repository root.

```bash
git clone https://gitlab.com/sgkens/lazylab.git
cd lazylab
cp .env.example .env
bun install
bun run build
bun run start        # http://127.0.0.1:3000
```

For development with hot reload, run `bun run dev` instead of the last two commands.

## Install and run with Docker

Shell: bash, repository root.

```bash
cp .env.example .env
docker compose up -d --build     # http://127.0.0.1:3000
docker compose logs -f lazylab   # shows the setup code on first start
```

The vault, cache and TLS files live in the `lazylab-data` volume, mounted at `/data`.

## First-run setup

On first start, lazylab prints a one-time setup code to its log:

```text
  lazylab first-run setup
  setup code: 9F3A1C2E
  Open the UI and enter this code to create the admin account.
```

1. Open `http://127.0.0.1:3000` and enter the code. Only someone who can read the server log can claim the instance.
2. Choose a username and a password of at least 12 characters. The password unlocks the vault; **it cannot be recovered**.
3. Optionally enter a GitLab host and token now, or add them later under **Vault → GitLab profiles**.

If `GITLAB_TOKEN` (and optionally `GITLAB_HOST`) is set in the environment during setup, it is imported into the vault once. Remove it from `.env` afterwards; it is not read again.

## Connect GitLab

**Vault → GitLab profiles → Add.** lazylab checks the token against `/api/v4/user` before saving it. Add one profile per GitLab instance and switch between them with **Activate**; watches and notifications follow the active profile.

## After a restart

The vault is locked after every restart. GitLab sync, watches and agent access pause until you sign in once in a browser. Agents get `423` (REST) or `503` (MCP) with a message saying so.

## Next steps

- Reach it from a laptop: [Remote access](/remote-access/).
- Get CI results on your phone: [Notifications and watches](/guide/notifications/).
- Connect a coding agent: [MCP server](/agents/mcp/).
