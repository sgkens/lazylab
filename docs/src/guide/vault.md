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
| Account | Password, signed-in devices, recovery key, backups | Change password, revoke a device, lock the vault, create a recovery key, download and restore a backup |

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

A backup and a recovery key are two independent ways back into the vault: the backup protects against a lost or damaged `vault.json`, and the recovery key protects against a forgotten password.

### Recovery key

**Vault → Account → Backup and recovery → Create recovery key** asks for the current password and shows a key once:

```text
LLRK-ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z2345-67ABC-DEFGH-IJKLM-NOPQR-STUVW
```

- Print it (**Print recovery key**) or store it in a password manager. lazylab keeps no readable copy.
- The key opens the vault without the password. Anyone holding it has the same access as the password.
- **Create** again replaces the key; the old key stops working at once. **Remove** deletes it.
- Changing the password does not change the recovery key.
- The last three characters are a checksum, so a mistyped key is reported as a typo rather than as a wrong key. Spaces, dashes, case and the letters O, I and B typed as 0, 1 and 8 do not matter.

To use it, choose **Forgot password? Use the recovery key** on the sign-in screen, enter the key and a new password. lazylab:

1. opens the data key with the recovery key;
2. wraps the data key with the new password, replacing the old password;
3. signs out every other device and signs you in.

The recovery key stays valid. Create a new one if you think the old one was seen. Failed attempts count towards the sign-in back-off.

### Download a backup

**Vault → Account → Backup and recovery → Download encrypted backup** asks for the current password and downloads `lazylab-vault-<date>.json`:

```json
{
  "format": "lazylab-vault-backup",
  "formatVersion": 1,
  "exportedAt": "2026-10-24T09:30:00.000Z",
  "vault": { "version": 1, "id": "…", "revision": 42, "kdf": { "…": "…" }, "dek": { "…": "…" }, "payload": { "…": "…" } }
}
```

The backup is the vault file as it is on disk: it stays encrypted and opens with the password **or** the recovery key that were current when it was downloaded. Store it away from the server. A copy of `vault.json` taken by hand restores the same way.

### Restore a backup

The browser accepts backup files up to 8 MiB; larger vault files can be copied into the data directory while the server is stopped.

Restoring checks the backup before anything is written: the format, the vault version, and that the given password or recovery key opens it (the AES-GCM tag of the data key and of the payload must verify). A damaged or modified backup is refused.

| Situation | Where | Needs |
|---|---|---|
| New or empty instance | Setup screen → **Restore from a backup** | The setup code from the server log, the backup file, and its password (or its recovery key and a new password) |
| Running vault | **Vault → Account → Backup and recovery → Restore backup** | Your session, the current password, the backup file and its password (or its recovery key and a new password) |

A running vault is not replaced silently by older data. Each vault has an `id` and a `revision` that increases on every write. Restore asks for confirmation when:

- the backup belongs to a different vault (`id` differs), or
- the backup's `revision` is lower than the running vault's (it is older).

After confirmation, or when the backup is the same vault at the same or a later revision, lazylab:

1. copies the current file to `vault.json.pre-restore-<time>` (mode 0600);
2. writes the backup with a revision above both, so it counts as the newest;
3. locks the vault, which signs out every device and stops GitLab sync, and reopens it with the backup's key;
4. signs you in again.

To undo a restore, restore `vault.json.pre-restore-<time>` the same way.

### Files kept next to the vault

| File | Written | Purpose |
|---|---|---|
| `vault.json` | Every change | The vault |
| `vault.json.bak` | Before every change | The previous version, in case the last write is damaged |
| `vault.json.pre-restore-<time>` | Before a restore | The vault that a restore replaced |

All three are encrypted the same way and open with the password or recovery key that was current when they were written.

### Without a recovery key or backup

A forgotten password with no recovery key and no backup means the vault contents are lost: stop lazylab, move `vault.json` out of the data directory, start it again and use the new setup code.

### Compatibility

The recovery key, `id` and `revision` are optional fields in the same vault format (version 1). A vault created before them opens unchanged and gains `id` and `revision` on its next write. An older lazylab still opens a vault that has them and keeps them when it writes.
