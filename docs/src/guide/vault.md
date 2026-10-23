---
title: Vault
abstract: The vault is lazylab's encrypted store for GitLab profiles, CI secrets, runner tokens, generic secrets, agent tokens, personal notes and notification settings, opened by your password at sign-in.
---

## Sections

| Section | Holds | Actions |
|---|---|---|
| GitLab profiles | Host, token and name per GitLab instance | Add (the token is checked against `/user`), edit, activate, delete. The active profile drives every view, watch and agent call |
| CI secrets | Values meant for CI/CD variables | **Push to GitLab** writes the value as a project or group variable (protected, masked, environment scope) |
| Runner tokens | Runner authentication tokens | Registering a runner from the UI saves its token here |
| Secrets | Anything else: API keys, passwords | Reveal for 30 seconds, copy |
| Agent tokens | Hashes of `llab_…` tokens | Create (shown once, with setup commands for Claude Code, Codex and REST), revoke. **Can read secrets** lets a token read variable values and vault secrets for [`lazy env` and `lazy run`](/cli/#local-environment-lazy-env-and-lazy-run) |
| Notes | Personal notes and tasks with comments | See [Notes and tasks](/guide/notes/) |
| Notifications | Push channels and rules | See [Notifications](/guide/notifications/) |
| Account | Password, signed-in devices | Change password, lock the vault |

## Revealing values

Values are never sent to the browser in lists. **Reveal** asks the server for one value, shows it for 30 seconds, and lets you copy it. Tokens on screen show only a hint, such as the first and last characters.

## Switching GitLab instances

Activating another profile:

1. rebuilds the GitLab client;
2. clears cached data from the previous instance;
3. runs only the watches that belong to the new profile.

Deleting a profile removes its watches.

## Token expiry

lazylab checks when your GitLab tokens expire when you sign in, when you switch profiles, and every 6 hours.

| Token | Read from | Shown in |
|---|---|---|
| Personal access token of each profile | `GET /personal_access_tokens/self` with that profile's token (GitLab 16.0+) | A badge on the profile row |
| Project access tokens | `GET /projects/:id/access_tokens` | **Token expiry** card |
| Deploy tokens | `GET /projects/:id/deploy_tokens` | **Token expiry** card |
| Group access tokens | `GET /groups/:id/access_tokens` for the projects' parent groups | **Token expiry** card |

Project, deploy and group tokens are read for the projects the active profile aggregates (the 15 most recently active). Listing them needs the Maintainer role; projects where you lack it are skipped without an error.

Days are counted in calendar days (UTC), as GitLab shows them. GitLab revokes a token at 00:00 UTC on its expiry date, so a token whose expiry date is today has already expired.

### Warnings

With the **Token expiry** rule on (the default), lazylab sends one notification when a token reaches 14, 7, 3 and 1 days left, and one when it has expired. Notifications at 3 days or less use the failure level, so channels set to "failures only" receive them. Which warnings were sent is stored in the vault, so a restart does not repeat them, and a rotated token starts over.

### Rotating a personal access token

**Rotate** on a profile asks for the new expiry date (90 days ahead by default) and calls `POST /personal_access_tokens/self/rotate` (GitLab 16.10+, the token needs the `api` or `self_rotate` scope).

```mermaid
sequenceDiagram
  participant B as Browser
  participant L as lazylab
  participant G as GitLab
  B->>L: POST /api/tokens/personal/:profileId/rotate {expiresAt}
  L->>G: POST /personal_access_tokens/self/rotate (old token)
  G-->>L: new token; old token revoked
  L->>L: save the new token in the profile
  L-->>B: new expiry date
```

GitLab revokes the old token at once. If saving to the vault fails after that, the response carries the new token and the profile row shows it with a copy button: store it before leaving the page.

## Backup and recovery

- Back up `<data dir>/vault.json`. It is useless without the password.
- There is no password recovery. Losing the password means starting with a new vault: delete `vault.json`, restart, and use the new setup code.
