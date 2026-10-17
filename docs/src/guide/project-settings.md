---
title: Project settings
abstract: The Settings section edits a project's description, topics, visibility, default branch and avatar, its CI/CD variables, its badges and its GitLab Pages options.
---

## General

- Description, topics, visibility and default branch are saved with `PUT /projects/:id`.
- The avatar uploads as a multipart file. GitLab accepts images up to 200 KB.

## CI/CD variables

**CI/CD → Variables** lists project variables and the variables of the project's parent group. Projects in a personal namespace have no group variables.

- Create, edit, clone and delete variables. Variables can be protected, masked or raw, have an environment scope, and be of type file.
- **Bulk import** reads `KEY=value` lines (comments and blank lines are skipped) and saves each one.
- **Export** downloads or copies the visible variables as a `.env` file.

Masked values are returned to the browser so they can be revealed and copied. Keep the lazylab session as private as the GitLab token.

## Badges

Project and group badges with link and image URLs. **Badges pipeline** sets up pipeline and coverage badges for `main` and `develop`, and pipeline and latest-release badges for tags. Image URLs point at the project's own GitLab instance (`<project>/badges/<ref>/pipeline.svg`, `<project>/-/badges/release.svg`). The preview shows the live badge; on a private project it only renders if this browser is signed in to GitLab.

## Pages

- Shows the Pages URL, last deployment time, HTTPS enforcement, access level and custom domains with certificate state.
- Values GitLab does not report show as "Not reported" or "Never".
- **Run Pages pipeline** starts a pipeline on the default branch and watches it. Pages deploys from that pipeline's `pages` job.
- **HTTPS only** toggles `pages_https_only`.

Reading Pages needs GitLab 16.8 or later.
