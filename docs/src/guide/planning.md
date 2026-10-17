---
title: Work items and merge requests
abstract: The Plan section covers work items, merge requests, milestones and labels across projects, with drawers for comments, labels, subtasks and merge actions.
---

## Projects and search

- The project bar filters every view to one project, or shows **All Projects**. "All projects" fans out over your 15 most recently active member projects, 4 requests at a time.
- The filter box narrows the current list by title, label or number.
- **Ctrl+K** opens global search over loaded work items, merge requests, pipelines, runners, packages and settings pages. Choosing a work item or MR opens its drawer.

## Work items

The list shows issues grouped by parent (tree view) or flat, with type and label filters. The drawer has:

- **State:** close or reopen.
- **Milestone:** assign or clear.
- **Subtasks:** checkbox lines (`- [ ] …`) in the description. Toggling or adding one edits the description on GitLab, and the drawer shows the description GitLab returns. If the save fails, the checkbox goes back to its previous state.
- **Labels:** remove with ×, add with **+ label**.
- **Discussion:** comments in Markdown with preview. Drop a file or use the paperclip to upload it to the project (`POST /projects/:id/uploads`, 10 MB maximum); GitLab's Markdown link is inserted.

**New Work Item** creates an issue, incident or task with labels, weight and milestone.

## Merge requests

The list groups open MRs by target branch, with pipeline status, approval, labels and quick actions:

| Action | GitLab call |
|---|---|
| Approve / Revoke approval | `POST …/approve`, `POST …/unapprove` |
| Draft / Ready | Updates the title prefix `Draft:`, which is how GitLab marks drafts |
| Merge | `PUT …/merge` with squash, delete source branch and commit message options |
| Close / Reopen | `state_event` on update |
| Labels | Add or remove in the drawer |
| Comment | Markdown with attachments |

The **Approved** state shows whether **you** have approved the MR (from `approved_by_usernames[]`).

## Milestones and labels

- **Milestones** lists active milestones with progress from `issues_statistics`. Counts that GitLab cannot provide show as "n/a". You can create milestones here.
- **Labels** lists labels with open counts, de-duplicated by name across projects. You can create labels here.
