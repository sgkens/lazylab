---
title: Vault
abstract: The vault is lazylab's encrypted store for GitLab profiles, CI secrets, runner tokens, generic secrets, agent tokens and notification settings, opened by your password at sign-in.
---

## Sections

| Section | Holds | Actions |
|---|---|---|
| GitLab profiles | Host, token and name per GitLab instance | Add (the token is checked against `/user`), edit, activate, delete. The active profile drives every view, watch and agent call |
| CI secrets | Values meant for CI/CD variables | **Push to GitLab** writes the value as a project or group variable (protected, masked, environment scope) |
| Runner tokens | Runner authentication tokens | Registering a runner from the UI saves its token here |
| Secrets | Anything else: API keys, passwords | Reveal for 30 seconds, copy |
| Agent tokens | Hashes of `llab_…` tokens | Create (shown once, with setup commands for Claude Code, Codex and REST), revoke |
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

## Backup and recovery

- Back up `<data dir>/vault.json`. It is useless without the password.
- There is no password recovery. Losing the password means starting with a new vault: delete `vault.json`, restart, and use the new setup code.
