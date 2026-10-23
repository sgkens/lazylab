---
title: FAQ and troubleshooting
abstract: Answers to common questions and fixes for the messages you are most likely to see, grouped by where they appear.
---

## Setup and sign-in

### Where is the setup code?

In the server log, printed once on first start:

```bash
# Shell: bash, repository root
bun run start                       # printed to the terminal
docker compose logs -f lazylab      # Docker
```

The code is only needed until the admin account exists. Only someone who can read the log can claim the instance.

### I forgot the password

The password derives the key that encrypts the vault, so it cannot be reset or recovered. To start over, stop lazylab, move `vault.json` out of the [data directory](/configuration/#data-directory), and start it again: a new setup code is printed. GitLab profiles, secrets and agent tokens from the old vault are lost; the GitLab tokens themselves still work and can be added again.

### "Too many attempts. Retry in N s"

After 4 failed sign-ins from one address, each further failure doubles the wait, up to 15 minutes. Wait, then sign in with the right password. Restarting the server clears the counter.

### Everything stopped after a restart

The vault is locked after every restart, by design: its key exists only in memory. Sign in once in a browser. GitLab sync, watches, notifications and agent access resume.

## The UI

### The header says `demo-mode`

No GitLab profile is active, so lazylab shows sample data. Add one under **Vault → GitLab profiles** and click **Activate**. Changes made in demo mode are not kept.

### "Cross-origin request rejected" when saving

The request's `Origin` does not match the host it arrived on, which happens when a reverse proxy rewrites the `Host` header. Set `LAZYLAB_PUBLIC_HOSTS` to the name you open lazylab with. See [Remote access](/remote-access/#cross-origin-request-rejected).

### A list is empty, or shows "Could not read …"

lazylab reports failed GitLab reads instead of showing an empty list. The message names the project or endpoint. Common causes: the token lacks the `api` scope, you are not a maintainer of the project (needed for variables and access tokens), or the token has expired (**Vault → GitLab profiles** shows its expiry).

### The sync bar says "GitLab rate limit" or "GitLab quota low"

GitLab answered 429, or its `RateLimit-Remaining` header ran low. lazylab pauses background refresh until the time shown; clicks still go through when GitLab allows them. Other tools on the same GitLab account use the same limit. If this happens often, raise the background refresh interval or pick the right plan under **Settings → GitLab request budget**.

### Desktop notifications do not appear

Browsers allow them only over HTTPS or on `localhost`. Use [Remote access](/remote-access/) to serve lazylab over HTTPS, then click **Enable desktop notifications** in the bell menu.

### Notifications do not reach my phone

Open **Vault → Notifications**, find the channel and press **Test**. The channel shows its last delivery or error. For ntfy, check that the phone is subscribed to the same server and topic. Channels set to **failures only** skip successful pipelines.

## Remote access

### The server warns about plain HTTP at startup

```text
WARNING: listening on a non-loopback address over plain HTTP. Passwords and session cookies are sent unencrypted.
```

lazylab is listening on a network address without TLS. Either set `LAZYLAB_TLS=on`, or keep it on `127.0.0.1` behind Tailscale Serve or Caddy and set `LAZYLAB_TRUST_PROXY=loopback`. See [Remote access](/remote-access/).

### The browser warns about the certificate

With `LAZYLAB_TLS=on` and no certificate of your own, lazylab generates a self-signed one. Trust it on each device, or use Tailscale Serve, which provides a trusted certificate. In Docker, set `LAZYLAB_TLS_SANS` to the names and addresses you connect with.

## Agents and the command line

### The agent gets 503 (MCP) or 423 (REST)

lazylab is locked. Sign in once in a browser; agent tokens work again without being re-created.

### "Invalid agent token" or 401

The token was revoked, mistyped, or belongs to another lazylab instance. Create a new one in **Vault → Agent tokens**. Tokens are shown only once.

### `lazy: Not connected. Run: lazy login <lazylab-url>`

`lazy` has no URL and token. Run `lazy login https://<your-host>` and paste an agent token, or set `LAZYLAB_URL` and `LAZYLAB_TOKEN`.

### `lazy` cannot find the project

It reads the project from the `origin` remote. For a checkout whose remote is not GitLab, set it once:

```bash
# Shell: bash, inside the checkout
git config lazylab.project group/project
```

### `lazy env` says the token needs secret access

`lazy env`, `lazy env pull` and `lazy run` read CI/CD variable values, so they need a token created with **Can read secrets**. Create one for the CLI and keep tokens without it for agents. See [Local environment](/cli/#local-environment-lazy-env-and-lazy-run).

### `lazy env pull` refuses to write `.env`

Two guards protect the file. If `.env` is not ignored by git, add it (and `.env.d/` when the project has file variables) to `.gitignore`. If `.env` exists and was not written by `lazy`, move it or pass `--force`.

### A variable shows "hidden in GitLab and not stored in the lazylab vault"

GitLab never returns the value of a variable that is masked and hidden. Store the value as a CI secret in **Vault → CI secrets** and push it to that project, key and environment scope from there; `lazy` then uses the vault copy.

## Data and upgrades

### Can I delete the cache?

Yes. `lazylab_cache.sqlite` (with its `-wal` and `-shm` files) and `lazylab_journal.jsonl` hold cached GitLab responses and the change journal. Older installs used `labwi_cache.*`; lazylab renames them on start. lazylab refetches from GitLab. Keep `vault.json`.

### What should I back up?

`vault.json` and your password. Everything else can be rebuilt. The file stays encrypted when copied.

### Still stuck?

Search or open an issue at [gitlab.com/sgkens/lazylab/-/issues](https://gitlab.com/sgkens/lazylab/-/issues). Include the lazylab version from `package.json`, how you run it (Bun or Docker) and the message you see. Never paste tokens, the password or `vault.json`.
