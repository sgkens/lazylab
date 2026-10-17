---
title: Development
abstract: How to run lazylab from source, run the tests, follow the commit and branch conventions, and build this documentation site.
---

## Run from source

Shell: bash, repository root.

```bash
bun install
bun run dev        # API + Vite middleware with reload, http://127.0.0.1:3000
```

| Script | Does |
|---|---|
| `bun run dev` | Server with `--watch`, Vite in middleware mode |
| `bun run build` | Builds the SPA into `dist/` |
| `bun run start` | Production server: API + `dist/` |
| `bun run lint` | `tsc --noEmit` over server and client |
| `bun test` | Unit tests |
| `bun run docker:build`, `docker:up`, `docker:down` | Container image and Compose stack |

Without a GitLab profile the server runs on demo data, which is enough for most UI work.

## Tests

`bunfig.toml` preloads `tests/setup.ts`, which points `LAZYLAB_DATA_DIR` at a temporary directory so tests never touch `.data/`.

```bash
# Shell: bash, repository root
bun test
bun test tests/triage.test.ts   # one file
```

Keep logic that decides things pure and tested. Examples:

| Function | Decides |
|---|---|
| `evaluateWatch` | When a watch notifies or ends |
| `classifyAuthoredMr` | The inbox reason for an MR |
| `extractFailure` | The failure excerpt |
| `buildChannelRequest` | The request sent to each push channel |
| `handleMessage` | The MCP JSON-RPC response |
| `buildReleaseNotes` | Release notes from commits |

## Conventions

- **Commits:** Conventional Commits, `type(scope): summary`. Use `feat`, `fix`, `refactor`, `docs`, `test` or `chore`. Add `build: major|minor|patch` in the body when the change affects the version. No co-author trailers.
- **Branches:** `main` is stable. `develop` collects finished work. New work goes on `feature/<name>` branches merged into `develop` with `--no-ff`.
- **Staging:** stage files by name, never `git add -A`.
- **Docs:**
  - start every page with a one-sentence abstract, and keep a strict H2/H3 hierarchy;
  - code blocks are runnable and state where they run;
  - use Mermaid for non-trivial flows;
  - no marketing words or emojis.

## Documentation site

The site is built with [Eleventy](https://www.11ty.dev/) and Nunjucks. It lives in `docs/` with its own dependencies.

```bash
# Shell: bash, repository root
cd docs
bun install
bun run dev      # http://localhost:8090 with reload
bun run build    # static output in docs/_site
```

| Path | Purpose |
|---|---|
| `docs/eleventy.config.js` | Plugins, Mermaid fences, the pager filter |
| `docs/src/_data/nav.js` | Sidebar order; new pages must be added here |
| `docs/src/_data/site.js` | Title, repository and edit links |
| `docs/src/_includes/layouts/base.njk` | Page layout |
| `docs/src/assets/style.css` | Styles, light and dark |
| `docs/src/**/*.md` | Pages; front matter sets `title` and `abstract` |

Markdown is not processed by Nunjucks, so `{{ }}` in code samples stays literal. Set `DOCS_PATH_PREFIX=/lazylab/` when publishing under a sub-path, for example on GitLab Pages.

### Publishing

`.gitlab-ci.yml` has two jobs that share one build:

| Job | Runs when | Does |
|---|---|---|
| `docs:build` | A merge request changes `docs/` | Builds the site; a broken page fails the MR |
| `pages` | `docs/` or `.gitlab-ci.yml` changes on the default branch | Builds the site and publishes `public/` with GitLab Pages |

The path prefix comes from `CI_PAGES_URL`: `https://sgkens.gitlab.io/lazylab` gives `/lazylab/`, and a unique Pages domain gives `/`. To check the job's script locally, run it with the variable set:

```bash
# Shell: bash, repository root
export CI_PROJECT_DIR="$PWD" CI_PAGES_URL=https://sgkens.gitlab.io/lazylab
export DOCS_PATH_PREFIX="$(echo "$CI_PAGES_URL" | sed -E 's#^https?://[^/]+##; s#/*$#/#')"
(cd docs && bun install --frozen-lockfile && bun run build) && rm -rf public && mv docs/_site public
```

## License

lazylab is released under the [MIT License](https://gitlab.com/sgkens/lazylab/-/blob/main/LICENSE).
