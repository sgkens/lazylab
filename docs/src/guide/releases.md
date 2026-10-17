---
title: Releases and tags
abstract: lazylab creates tags and releases, generates release notes from the Conventional Commits since the previous tag, and suggests the next semantic version.
---

## Release notes from commits

In **Packages & Releases → Releases → New Release**, **Generate from commits** reads the commits between the newest tag and the release's tag (or the ref it will be created from). It groups them by type:

| Commit header | Section |
|---|---|
| `feat(scope)!: …` or a `BREAKING CHANGE:` footer | Breaking changes |
| `feat:` | Features |
| `fix:` | Fixes |
| `perf:` | Performance |
| `refactor:` | Refactoring |
| `docs:` | Documentation |
| `build:`, `ci:` | Build and CI |
| `test:` | Tests |
| `chore:`, `style:` | Chores |
| anything else | Other changes |

Merge commits are left out. Each line keeps the scope and short sha, for example `- **cache:** expire entries on TTL (7a9c8f1)`.

### Suggested version

| Commits contain | Bump | `v1.4.2` becomes |
|---|---|---|
| a breaking change | major | `v2.0.0` (before 1.0: `v0.5.0`) |
| a `feat` | minor | `v1.5.0` |
| anything else | patch | `v1.4.3` |

If the tag field is empty it is filled with the suggestion. If the tag does not exist yet, **Create the tag from** names the branch or sha GitLab creates it from (the default branch when empty).

## Compare tags

**Compare Tags** shows the commits between two tags in the same grouped form, with the bump they imply. It uses GitLab's `repository/compare` API.

## Tags

**New Tag** creates a lightweight or annotated tag (with a message) from a branch or sha.

## For agents and scripts

Shell: bash, with a signed-in session cookie, or from the MCP or REST clients described in [Agents](/agents/mcp/).

```bash
curl -s -b cookies.txt "$LAZYLAB_URL/api/projects/42/release-notes?to=main"
curl -s -b cookies.txt "$LAZYLAB_URL/api/projects/42/release-notes?from=v1.4.0&to=v1.5.0"
```

The response carries `markdown`, `bump`, `nextVersion` and `commitCount`.
