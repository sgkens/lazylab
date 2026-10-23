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
| `docs/eleventy.config.js` | HTML transforms, Pagefind indexing, Mermaid fences and navigation filters |
| `docs/scripts/navigation.mjs` | Heading IDs, section links, table of contents, reading time and code toolbars generated at build time |
| `docs/scripts/build-assets.mjs` | Bun bundles the browser modules and CSS into ignored `.generated/` output |
| `docs/src/_data/nav.js` | Sidebar order; new pages must be added here |
| `docs/src/_data/site.js` | Title, repository and edit links, `DOCS_SITE_URL` for link previews |
| `docs/src/_includes/layouts/base.njk` | Page layout |
| `docs/src/_includes/layouts/home.njk` | Landing page: hero and "choose your path" cards from the page's `paths` front matter |
| `docs/src/assets/brand/` | Logo, favicon and link preview, copied from `brand/` by the brandkit build |
| `docs/src/assets/style.css` | Shared layout, spacing and colour tokens; light/dark styles, responsive rails and reduced-motion rules |
| `docs/src/assets/docs.js`, `search.js` | Navigation, scroll tracking, copy controls and lazy-loaded Hawk search |
| `docs/src/**/*.md` | Pages; front matter sets `title` and `abstract` |

Markdown is not processed by Nunjucks, so `{{ }}` in code samples stays literal. Set `DOCS_PATH_PREFIX=/lazylab/` when publishing under a sub-path, for example on GitLab Pages, and `DOCS_SITE_URL` to the published base URL to emit `og:image` and `og:url`; the `pages` CI job sets both from `CI_PAGES_URL`.

### Interface and search

The header and page share a 1,360 px maximum width and the same sidebar/article/contents grid. The contents panel highlights the current section and scrolls its own rail to keep the active link visible. Below 1,200 px it becomes a native disclosure; the main navigation becomes a keyboard-accessible drawer below 820 px. Heading anchors and contents links are generated into HTML and work without JavaScript.

The docs commands explicitly run Eleventy under Bun to use its asset bundler. Each build, including watch rebuilds, generates a Pagefind index over article content only. A missing index or bundling failure fails the build. Hawk and its TypeFlow animation driver are loaded on the first search request; those assets are served locally. Logcad reports load failures to the console without enabling persistent debug capture. Mermaid keeps its existing pinned CDN renderer, with readable source as its fallback.

| Interface setting | Source/default | Behaviour |
|---|---|---|
| Search | Hawk 0.43.7 + Pagefind 1.5.2 | Header button, Ctrl/Cmd+K or `/`; Escape closes and restores focus |
| Motion | TypeFlow 0.34.1 and CSS | Intro/preview word fades, section arrivals and supported browser view transitions; disabled for reduced motion |
| Theme | `lazylab-docs-theme` in localStorage | Explicit light/dark preference; system colour scheme used initially |
| Layout and colour tokens | `:root` in `style.css` | Shared by the page, navigation, search modal and thin scrollbars |
| Edit link | `site.editBase` plus encoded source path | Links to the Markdown source for the current page |
| Search index path | Relative to the bundled search module | Works at the site root and with `DOCS_PATH_PREFIX` |

## Brand assets

The logo, icons and colour tokens in `brand/` are generated by [brandkit](https://gitlab.com/sgkens/brandkit) from `brand/source/*.svg` and `brand/brand.config.json`. Edit those, never the outputs. See the [Brand](/reference/brand/) page.

```bash
# Shell: bash, repository root, with brandkit installed (see its README)
brandkit build --config brand/brand.config.json   # also refreshes src/assets/brand/ and docs/src/assets/brand/
```

Before opening a merge request, read [CONTRIBUTING.md](https://gitlab.com/sgkens/lazylab/-/blob/main/CONTRIBUTING.md).

### Publishing

`.gitlab-ci.yml` checks the app before its documentation stage:

| Job | Runs when | Does |
|---|---|---|
| `app:check` | Branch, tag and merge request pipelines | Frozen install, TypeScript, tests, app build, CLI compilation and binary version check; retains `dist/` for one week |
| `docs:build` | A merge request changes `docs/` or `.gitlab-ci.yml` | Builds the site; a broken page fails the MR |
| `pages` | `docs/` or `.gitlab-ci.yml` changes on the default branch | Builds the site and publishes `public/` with GitLab Pages |

When a branch has an open MR, pushes use the MR pipeline instead of creating a duplicate branch pipeline. App checks use temporary test storage and no live GitLab or BugKB credentials. Docker image builds and cross-platform binary releases remain follow-ups. See [Testing the pre-1.0 build](/testing/) for the live acceptance workflow.

The path prefix comes from `CI_PAGES_URL`: `https://sgkens.gitlab.io/lazylab` gives `/lazylab/`, and a unique Pages domain gives `/`. To check the job's script locally, run it with the variable set:

```bash
# Shell: bash, repository root
export CI_PROJECT_DIR="$PWD" CI_PAGES_URL=https://sgkens.gitlab.io/lazylab
export DOCS_PATH_PREFIX="$(echo "$CI_PAGES_URL" | sed -E 's#^https?://[^/]+##; s#/*$#/#')"
(cd docs && bun install --frozen-lockfile && bun run build) && rm -rf public && mv docs/_site public
```

## License

lazylab is released under the [MIT License](https://gitlab.com/sgkens/lazylab/-/blob/main/LICENSE).

## App bundles

The production build separates React and icons into vendor chunks. The dashboard and pipeline editor are imported when opened; the workspace shows a loading indicator while their chunks download. `vite.config.ts` uses the Vite 8 Rolldown `codeSplitting` configuration. Run `bun run build` from the repository root to inspect chunk sizes.
